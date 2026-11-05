"""Atomic per-job R2 operation budget shared by worker subprocesses."""
from __future__ import annotations

from dataclasses import dataclass
import atexit
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
import threading


DEFAULT_R2_CLASS_A_LIMIT = 100_000
DEFAULT_R2_CLASS_B_LIMIT = 100_000
R2_BUDGET_PATH_ENV = "KARTISERET_R2_BUDGET_PATH"
R2_CLASS_A_LIMIT_ENV = "KARTISERET_R2_CLASS_A_LIMIT"
R2_CLASS_B_LIMIT_ENV = "KARTISERET_R2_CLASS_B_LIMIT"
_init_lock = threading.Lock()


class R2BudgetExceeded(RuntimeError):
    """Raised before an R2 HTTP attempt would exceed this job's budget."""


class R2BudgetError(RuntimeError):
    """Raised when the shared budget cannot be read or updated safely."""


def _positive_limit(name: str, default: int) -> int:
    raw = os.environ.get(name)
    try:
        value = default if raw is None else int(raw)
    except (TypeError, ValueError) as error:
        raise R2BudgetError(f"{name} must be a positive integer") from error
    if value <= 0:
        raise R2BudgetError(f"{name} must be a positive integer")
    return value


@dataclass(frozen=True)
class R2Budget:
    path: Path
    class_a_limit: int
    class_b_limit: int

    @classmethod
    def from_environment(cls) -> "R2Budget | None":
        raw_path = os.environ.get(R2_BUDGET_PATH_ENV)
        if not raw_path:
            return None
        return cls(
            path=Path(raw_path),
            class_a_limit=_positive_limit(R2_CLASS_A_LIMIT_ENV, DEFAULT_R2_CLASS_A_LIMIT),
            class_b_limit=_positive_limit(R2_CLASS_B_LIMIT_ENV, DEFAULT_R2_CLASS_B_LIMIT),
        )

    @classmethod
    def create_job_budget(cls, directory: str | Path | None = None) -> "R2Budget":
        """Create and initialize one private ledger for the current logical job."""
        class_a = _positive_limit(R2_CLASS_A_LIMIT_ENV, DEFAULT_R2_CLASS_A_LIMIT)
        class_b = _positive_limit(R2_CLASS_B_LIMIT_ENV, DEFAULT_R2_CLASS_B_LIMIT)
        try:
            root = Path(directory) if directory else Path(tempfile.mkdtemp(prefix="kartiseret-r2-budget-"))
            if directory is None:
                atexit.register(shutil.rmtree, root, ignore_errors=True)
            root.mkdir(parents=True, exist_ok=True)
            path = root / "r2-budget.sqlite3"
            budget = cls(path, class_a, class_b)
            with _init_lock:
                with budget._connect() as connection:
                    connection.execute("CREATE TABLE IF NOT EXISTS counters (kind TEXT PRIMARY KEY, count INTEGER NOT NULL)")
                    connection.executemany(
                        "INSERT OR IGNORE INTO counters(kind, count) VALUES (?, 0)",
                        (("class_a",), ("class_b",)),
                    )
                    connection.execute("CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id = 1), tripped TEXT)")
                    connection.execute("INSERT OR IGNORE INTO state(id, tripped) VALUES (1, NULL)")
            os.environ[R2_BUDGET_PATH_ENV] = str(path)
            return budget
        except R2BudgetError:
            raise
        except Exception as error:
            raise R2BudgetError("Could not initialize the shared R2 operation budget") from error

    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=30, isolation_level="IMMEDIATE")
        connection.execute("PRAGMA busy_timeout = 30000")
        return connection

    def reserve(self, operation: str) -> None:
        """Atomically reserve an HTTP attempt; unknown operations count as Class A."""
        lowered = operation.lower()
        if lowered.startswith(("delete", "abortmultipart")):
            return
        if lowered in {"getobject", "headobject", "selectobjectcontent"}:
            kind, limit = "class_b", self.class_b_limit
        else:
            kind, limit = "class_a", self.class_a_limit
        try:
            with self._connect() as connection:
                result = connection.execute(
                    "UPDATE counters SET count = count + 1 WHERE kind = ? AND count < ?",
                    (kind, limit),
                )
                if result.rowcount == 0:
                    row = connection.execute("SELECT count FROM counters WHERE kind = ?", (kind,)).fetchone()
                    if row is None:
                        raise R2BudgetError("R2 budget counters are missing")
                    current = int(row[0])
                    if current < limit:
                        raise R2BudgetError("R2 budget reservation could not be confirmed")
                    connection.execute("UPDATE state SET tripped = COALESCE(tripped, ?) WHERE id = 1", (kind,))
                    connection.commit()
                    raise R2BudgetExceeded(
                        f"R2 {kind.replace('_', ' ')} operation budget reached ({limit}); this job stopped before the next R2 request."
                    )
                elif result.rowcount != 1:
                    raise R2BudgetError("R2 budget counters are missing")
        except (R2BudgetExceeded, R2BudgetError):
            raise
        except Exception as error:
            raise R2BudgetError("Could not reserve an R2 operation; request blocked") from error

    def snapshot(self) -> dict[str, int | str | None]:
        try:
            with self._connect() as connection:
                rows = dict(connection.execute("SELECT kind, count FROM counters").fetchall())
                tripped = connection.execute("SELECT tripped FROM state WHERE id = 1").fetchone()
            return {"class_a": int(rows["class_a"]), "class_b": int(rows["class_b"]), "tripped": tripped[0] if tripped else None}
        except Exception as error:
            raise R2BudgetError("Could not read the R2 operation budget summary") from error


def initialize_job_budget(directory: str | Path | None = None) -> R2Budget:
    """Use an inherited ledger when present; otherwise create a standalone one."""
    budget = R2Budget.from_environment()
    return budget if budget is not None else R2Budget.create_job_budget(directory)


def install_budget(client) -> None:
    """Count at the Botocore before-send boundary, once for every HTTP attempt."""
    budget = R2Budget.from_environment()
    if budget is None:
        # R2 clients must never silently operate without the fail-closed guard.
        raise R2BudgetError("R2 budget was not initialized for this job")

    def before_send(request, event_name=None, **_kwargs):
        operation = str(event_name or "").rsplit(".", 1)[-1]
        budget.reserve(operation)

    try:
        client.meta.events.register_first("before-send.s3.*", before_send)
    except Exception as error:
        raise R2BudgetError("Could not attach the R2 request budget guard") from error

