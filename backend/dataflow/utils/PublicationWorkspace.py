"""Private category preparation using the existing flows' small table-query API.

Network/provider code is unchanged. Only allowlisted table operations are evaluated
against copies; publication uploads a bounded diff and commits it with one RPC.
Unsupported operations fail closed rather than touching a live publication.
"""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
from threading import RLock
from types import SimpleNamespace
import uuid

from supabase import create_client as live_client

CATEGORY_TABLES = {
    "nowplayings": ("allShowtimes", "finalMovies", "finalShowtimes"),
    "comingsoons": ("allSoons", "finalSoons"),
    "cinematheques": ("allTheques", "finalThequeMovies", "finalTheques"),
}
CATEGORY_KEYS = {"nowPlayingData": "nowplayings", "comingSoonsData": "comingsoons", "cinemathequeData": "cinematheques"}
KEYS = {"finalMovies": ("tmdb_id",), "finalThequeMovies": ("tmdb_id",), "movieCodes": ("tmdb_id",), "tableSkips": ("name_or_tmdb_id",), "pipeline_scrape_snapshots": ("snapshot_id",), "pipeline_publication_checkpoints": ("category", "snapshot_id")}
PHASES = ["in_progress", "prepared", "screenings_written", "movies_written", "stale_rows_deleted", "published"]
_active: ContextVar[PublicationWorkspace | None] = ContextVar("publication_workspace", default=None)


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def key_for(table, row):
    return tuple(row.get(column) for column in KEYS.get(table, ("id",)))


@contextmanager
def publication_scope(workspace):
    token = _active.set(workspace)
    try:
        yield workspace
    finally:
        _active.reset(token)


def create_client(url, key, *args, **kwargs):
    return _active.get() or live_client(url, key, *args, **kwargs)


def workspace_for(flow):
    category = next((category for category, tables in CATEGORY_TABLES.items() if flow.MAIN_TABLE_NAME in tables), None)
    if category is None:
        raise ValueError("Dataflow has no publication category")
    active = _active.get()
    if active is not None:
        if active.category != category:
            raise ValueError("Cannot mix category preparation")
        return active, False
    context = getattr(flow, "_shared_request_context", None)
    if context is not None:
        with context.lock:
            if not hasattr(context, "publications"):
                context.publications = {}
            if not hasattr(context, "reserved_movie_codes"):
                context.reserved_movie_codes = set()
            if category not in context.publications:
                context.publications[category] = PublicationWorkspace(category, flow.run_id, reserved_movie_codes=context.reserved_movie_codes)
            return context.publications[category], False
    return PublicationWorkspace(category, flow.run_id), True


class PublicationWorkspace:
    def __init__(self, category, run_id=0, client=None, reserved_movie_codes=None):
        self.category, self.run_id = category, int(run_id)
        self.client = client or live_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
        self.reserved_movie_codes = reserved_movie_codes if reserved_movie_codes is not None else set()
        self.publication_id = str(uuid.uuid4())
        self.tables, self.baseline, self.claims = {}, {}, {}
        self.lock = RLock()
        self.allowed = set(CATEGORY_TABLES[category]) | {"movieCodes", "tableFixes", "tableSkips", "pipeline_scrape_snapshots", "pipeline_publication_checkpoints"}
        self._parts = None
        self._result = None

    def savepoint(self):
        with self.lock:
            return deepcopy((self.tables, self.claims))

    def restore(self, state):
        with self.lock:
            self.tables, self.claims = deepcopy(state)
            # Reads first loaded during the failed stage must remain available
            # from their unchanged baseline when that stage is retried.
            for table, rows in self.baseline.items():
                self.tables.setdefault(table, deepcopy(rows))

    def _load(self, table):
        with self.lock:
            if table not in self.tables:
                rows, start = [], 0
                while True:
                    query = self.client.table(table).select("*")
                    for column in KEYS.get(table, ("id",)):
                        query = query.order(column)
                    page = query.range(start, start + 499).execute().data or []
                    rows.extend(page)
                    if len(page) < 500:
                        break
                    start += 500
                self.baseline[table] = deepcopy(rows)
                self.tables[table] = deepcopy(rows)
            return self.tables[table]

    def table(self, name):
        if name == "utilAvgTime":
            return self.client.table(name)  # Independent operational timing only.
        if name not in self.allowed:
            raise ValueError(f"Table outside {self.category} publication: {name}")
        return WorkspaceQuery(self, name)

    def rpc(self, name, params):
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=self._checkpoint(name, params)))

    def _checkpoint(self, name, p):
        with self.lock:
            if self._parts is not None:
                raise RuntimeError("Publication is frozen for commit")
            if p["p_category"] != self.category:
                raise ValueError("Checkpoint category mismatch")
            manifests = [r for r in self._load("pipeline_scrape_snapshots") if r.get("table_name") == CATEGORY_TABLES[self.category][0] and r.get("cinema") == p["p_cinema"]]
            latest = max(manifests, key=lambda r: (r.get("run_id") or -1, r.get("attempt") or 0, r.get("started_at") or ""), default={})
            eligible = latest.get("snapshot_id") == p["p_snapshot_id"] and latest.get("status") == "complete"
            if not eligible:
                return {"claimed": False, "state": "superseded"} if name == "claim_pipeline_publication_checkpoint" else False
            checkpoints = self._load("pipeline_publication_checkpoints")
            current = next((r for r in checkpoints if r["category"] == self.category and r["snapshot_id"] == p["p_snapshot_id"]), None)
            if name == "claim_pipeline_publication_checkpoint":
                if current and current["phase"] == "published" and current["input_fingerprint"] == p["p_input_fingerprint"] and not current["has_unresolved"]:
                    return {"claimed": False, "state": "published", "phase": "published"}
                phase = "in_progress"
                if current and current["input_fingerprint"] == p["p_input_fingerprint"] and not current["has_unresolved"] and current["phase"] in PHASES[1:-1]:
                    phase = current["phase"]
                if current is None:
                    current = {"category": self.category, "snapshot_id": p["p_snapshot_id"]}
                    checkpoints.append(current)
                current.update(input_fingerprint=p["p_input_fingerprint"], phase=phase, has_unresolved=False)
                self.claims[p["p_snapshot_id"]] = {"snapshot_id": p["p_snapshot_id"], "cinema": p["p_cinema"]}
                return {"claimed": True, "state": "in_progress", "phase": phase}
            if name != "advance_pipeline_publication_checkpoint":
                raise ValueError("Unsupported preparation RPC")
            if not current or current["input_fingerprint"] != p["p_input_fingerprint"]:
                return False
            phase = p["p_phase"]
            if phase not in PHASES[1:] or PHASES.index(phase) < PHASES.index(current["phase"]):
                return False
            current.update(phase=phase, has_unresolved=current.get("has_unresolved", False) or p.get("p_has_unresolved", False))
            return True

    def _owned_rows(self, table, rows):
        if table == "pipeline_scrape_snapshots":
            return [r for r in rows if r.get("table_name") == CATEGORY_TABLES[self.category][0]]
        if table == "pipeline_publication_checkpoints":
            return [r for r in rows if r.get("category") == self.category]
        return rows

    def parts(self):
        if self._parts is not None:
            return self._parts
        parts, changes = [], []
        for table in sorted(self.tables):
            before = {key_for(table, r): r for r in self._owned_rows(table, self.baseline[table])}
            after = {key_for(table, r): r for r in self._owned_rows(table, self.tables[table])}
            if table != "movieCodes":
                rows = sorted(before.values(), key=lambda r: tuple(str(v) for v in key_for(table, r)))
                # Guard every read input, including absence/new rows, rather
                # than only rows that happen to be updated by this preparation.
                parts.append({"kind": "guard", "table": table, "rows": rows})
            if table in {"tableFixes", "tableSkips"}:
                if before != after:
                    raise ValueError("Matching evidence is read-only during preparation")
                continue
            for key in sorted(before.keys() | after.keys(), key=str):
                old, new = before.get(key), after.get(key)
                if old != new:
                    changes.append({"table": table, "before": old, "after": new})
        # Split guards as well as mutations; no request carries a whole cinema
        # or a full catalog. Empty guards still prove the table was empty.
        chunks = []
        for part in parts:
            for start in range(0, max(1, len(part["rows"])), 200):
                chunks.append({**part, "rows": part["rows"][start:start + 200]})
        chunks += [{"kind": "changes", "rows": changes[start:start + 200]} for start in range(0, len(changes), 200)]
        chunks.append({"kind": "claims", "rows": list(self.claims.values())})
        bounded = []
        for part in chunks:
            batch, size = [], 0
            for row in part["rows"]:
                length = len(canonical(row).encode("utf-8")) + 1
                if length > 750_000:
                    raise ValueError("A publication row exceeds the staging limit")
                if batch and size + length > 750_000:
                    bounded.append({**part, "rows": batch})
                    batch, size = [], 0
                batch.append(row)
                size += length
            if batch or not part["rows"]:
                bounded.append({**part, "rows": batch})
        self._parts = [canonical(part) for part in bounded]
        return self._parts

    def commit(self):
        if self._result is not None:
            return self._result
        if not self.claims and all(self.tables[table] == rows for table, rows in self.baseline.items()):
            self._result = {"status": "unchanged"}
            return self._result
        parts = self.parts()
        digests = [hashlib.sha256(part.encode()).hexdigest() for part in parts]
        fingerprint = hashlib.sha256("\n".join(f"{i}:{digest}" for i, digest in enumerate(digests)).encode()).hexdigest()
        identity = {"publication_id": self.publication_id, "category": self.category, "run_id": self.run_id, "fingerprint": fingerprint, "part_count": len(parts)}
        directory = Path("backend/utils/log/logger_artifacts") / str(self.run_id)
        directory.mkdir(parents=True, exist_ok=True)
        (directory / f"publication_{self.category}.json").write_text(canonical(identity))
        existing = self.client.table("pipeline_publications").select("status,fingerprint,revision").eq("publication_id", self.publication_id).execute().data
        if existing:
            if existing[0]["fingerprint"] != fingerprint:
                raise RuntimeError("Publication identity reused with different content")
            if existing[0]["status"] == "applied":
                self._result = existing[0]
                return self._result
        else:
            self.client.table("pipeline_publications").insert(identity).execute()
        for index, part in enumerate(parts):
            self.client.table("pipeline_publication_parts").upsert({"publication_id": self.publication_id, "part": index, "payload": part}).execute()
        try:
            result = self.client.rpc("commit_category_publication", {"p_publication_id": self.publication_id, "p_fingerprint": fingerprint}).execute().data
        except Exception:
            # A network error is not evidence that Postgres rolled back.
            receipt = self.client.table("pipeline_publications").select("status,fingerprint,revision").eq("publication_id", self.publication_id).execute().data
            if not receipt or receipt[0]["status"] != "applied" or receipt[0]["fingerprint"] != fingerprint:
                raise
            result = receipt[0]
        self._result = result
        return result


class WorkspaceQuery:
    def __init__(self, workspace, table):
        self.workspace, self.name = workspace, table
        self.operation, self.payload, self.columns = "select", None, "*"
        self.predicates, self.orders, self.bounds, self.maximum = [], [], None, None

    def select(self, columns="*", **kwargs):
        if kwargs:
            raise ValueError("Unsupported preparation select options")
        self.columns = columns
        return self

    def order(self, column, desc=False):
        self.orders.append((column, desc))
        return self

    def range(self, start, end):
        self.bounds = (start, end)
        return self

    def limit(self, maximum):
        self.maximum = maximum
        return self

    def eq(self, column, value):
        self.predicates.append(lambda r: r.get(column) == value)
        return self

    def in_(self, column, values):
        allowed = set(values)
        self.predicates.append(lambda r: r.get(column) in allowed)
        return self

    def lte(self, column, value):
        self.predicates.append(lambda r: r.get(column) is not None and r[column] <= value)
        return self

    def gt(self, column, value):
        self.predicates.append(lambda r: r.get(column) is not None and r[column] > value)
        return self

    def filter(self, column, operation, value):
        if operation != "not.is" or value != "null":
            raise ValueError("Unsupported preparation filter")
        self.predicates.append(lambda r: r.get(column) is not None)
        return self

    def _mutation(self, operation, payload=None):
        if self.name in {"tableFixes", "tableSkips"}:
            raise ValueError("Cannot mutate matching evidence during publication")
        self.operation, self.payload = operation, deepcopy(payload)
        return self

    def insert(self, payload):
        return self._mutation("insert", payload)

    def upsert(self, payload):
        return self._mutation("upsert", payload)

    def update(self, payload):
        return self._mutation("update", payload)

    def delete(self):
        return self._mutation("delete")

    def execute(self):
        with self.workspace.lock:
            if self.operation != "select" and self.workspace._parts is not None:
                raise RuntimeError("Publication is frozen for commit")
            rows = self.workspace._load(self.name)
            selected = [r for r in rows if all(p(r) for p in self.predicates)]
            for column, desc in reversed(self.orders):
                selected.sort(key=lambda r: (r.get(column) is None, r.get(column) if r.get(column) is not None else ""), reverse=desc)
            if self.bounds is not None:
                selected = selected[self.bounds[0]:self.bounds[1] + 1]
            if self.maximum is not None:
                selected = selected[:self.maximum]
            if self.operation == "update":
                for row in selected:
                    row.update(deepcopy(self.payload))
            elif self.operation == "delete":
                selected_ids = {id(r) for r in selected}
                self.workspace.tables[self.name] = [r for r in rows if id(r) not in selected_ids]
            elif self.operation in {"insert", "upsert"}:
                selected = []
                # Index once per batch, preserving the first match if keys
                # repeat. Rebuilding here also respects deletes and restores.
                rows_by_key = {}
                for existing_row in rows:
                    rows_by_key.setdefault(key_for(self.name, existing_row), existing_row)
                for payload in self.payload if isinstance(self.payload, list) else [self.payload]:
                    row = deepcopy(payload)
                    if KEYS.get(self.name, ("id",)) == ("id",):
                        row.setdefault("id", str(uuid.uuid4()))
                    row_key = key_for(self.name, row)
                    existing = rows_by_key.get(row_key)
                    if existing is not None:
                        if self.operation == "insert":
                            raise ValueError("Duplicate preparation key")
                        existing.update(row)
                        row = existing
                    else:
                        row.setdefault("created_at", datetime.now(timezone.utc).isoformat())
                        rows.append(row)
                        rows_by_key[row_key] = row
                    selected.append(row)
            result = deepcopy(selected)
            if self.columns != "*":
                columns = self.columns.split(",")
                result = [{column: row.get(column) for column in columns} for row in result]
            return SimpleNamespace(data=result)


@contextmanager
def maintenance_publication(category):
    active = _active.get()
    if active is not None:
        if active.category != category:
            raise ValueError("Maintenance crosses publication categories")
        yield active
        return
    workspace = PublicationWorkspace(category)
    with publication_scope(workspace):
        yield workspace
    workspace.commit()


def atomic_maintenance(category):
    from functools import wraps
    def decorate(function):
        @wraps(function)
        def run(*args, **kwargs):
            with maintenance_publication(category):
                return function(*args, **kwargs)
        return run
    return decorate
