"""Progress and timing helpers for blocking pipeline stages."""
from __future__ import annotations

import logging
import os
import time
from typing import Any, Callable

from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, ProgressColumn
from rich.progress_bar import ProgressBar
from rich.table import Table
from rich.text import Text

from backend.utils.util_avg_time_history import (
    append_recent_duration,
    current_weekday,
    load_recent_averages,
)

LOGGER = logging.getLogger(__name__)
FALLBACK_SECONDS = 60.0


def load_stage_estimate(name: str) -> float:
    """Load a historical estimate, falling back without blocking pipeline work."""
    machine = os.environ.get("RUNNER_MACHINE", "").strip()
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not machine or not url or not key:
        return FALLBACK_SECONDS
    try:
        from backend.utils.log.job_lease import create_client

        values = load_recent_averages(
            create_client(url, key), [name], machine, current_weekday()
        )
        return float(values.get(name) or FALLBACK_SECONDS)
    except Exception:
        LOGGER.debug("Could not load historical estimate for %s", name, exc_info=True)
        return FALLBACK_SECONDS


def record_stage_duration(name: str, duration: float, weekday: str | None = None) -> None:
    """Append a successful stage duration; history is best-effort."""
    if os.environ.get("GITHUB_ACTIONS") == "true" or os.environ.get("SOLO_UPDATE_ONLY", "").strip().lower() in {"1", "true", "yes", "on"}:
        return
    machine = os.environ.get("RUNNER_MACHINE", "").strip()
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not machine or not url or not key or duration <= 0:
        return
    try:
        from backend.utils.log.job_lease import create_client

        append_recent_duration(
            create_client(url, key), name, machine, weekday or current_weekday(), duration
        )
    except Exception:
        LOGGER.warning("Could not save timing history for %s", name, exc_info=True)


def _hms(seconds: float) -> str:
    value = max(0, int(seconds))
    hours, remainder = divmod(value, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours}:{minutes:02d}:{seconds:02d}"


class _ElapsedColumn(ProgressColumn):
    def render(self, task) -> Text:
        return Text(_hms(task.elapsed or 0.0), style="bold #9c27f5")


class _EstimateColumn(ProgressColumn):
    def render(self, task) -> Text:
        if task.fields.get("state", "running") != "running":
            return Text("Done" if task.fields["state"] == "success" else "Stopped", style="dim")
        estimate = float(task.fields.get("estimate", FALLBACK_SECONDS))
        elapsed = float(task.elapsed or 0.0)
        if elapsed >= estimate:
            return Text("Taking longer than estimated", style="bold yellow")
        return Text(f"ETA est. ~{_hms(estimate - elapsed)} left", style="orange1")


class _StageBarColumn(ProgressColumn):
    def render(self, task) -> ProgressBar:
        estimate = max(float(task.fields.get("estimate", FALLBACK_SECONDS)), 0.1)
        elapsed = float(task.elapsed or 0.0)
        state = task.fields.get("state", "running")
        if state == "success":
            complete, color = 100.0, "green"
        elif state == "failed":
            complete, color = min(100.0, max(0.0, elapsed / estimate * 100)), "red"
        else:
            complete = max(
                float(task.completed or 0.0),
                min(94.0, max(0.0, elapsed / estimate * 100)),
            )
            color = "#f266e0"
        return ProgressBar(
            total=100,
            completed=complete,
            width=24,
            pulse=False,
            style="grey23",
            complete_style=color,
            finished_style=color,
            pulse_style=color,
        )


class TimedStageProgress:
    """Render a timed progress bar around a synchronous operation."""

    def __init__(
        self,
        name: str,
        label: str,
        console: Console,
        *,
        estimate_seconds: float | None = None,
    ) -> None:
        self.name = name
        self.label = label
        self.console = console
        self.estimate = max(float(estimate_seconds or load_stage_estimate(name)), 0.1)
        self.weekday = current_weekday()
        self.started_at = 0.0
        self.state = "running"
        self.outcome = "Running"
        self.progress = Progress(
            _ElapsedColumn(),
            _StageBarColumn(),
            _EstimateColumn(),
            "{task.description}",
            console=console,
            refresh_per_second=5,
        )
        self.task_id = self.progress.add_task(
            f"[bold #66d6f2]{label}[/bold #66d6f2]",
            total=100,
            estimate=self.estimate,
            state=self.state,
        )
        scheduled = any(
            os.environ.get(name) == "true"
            for name in ("GITHUB_ACTIONS", "JJ_INTEL_MAC_DAILY_RUN", "JJ_INTEL_MAC_WEEKLY_RUN")
        )
        self.interactive = bool(console.is_terminal and not scheduled)

    def __enter__(self) -> "TimedStageProgress":
        self.started_at = time.monotonic()
        if self.interactive:
            self.progress.start()
        else:
            self.console.print(
                Panel.fit(
                    Text(f"{self.label} · running · estimate ~{_hms(self.estimate)}", style="cyan"),
                    border_style="grey37",
                )
            )
        return self

    def finish(self, outcome: str = "Complete", *, successful: bool = True) -> float:
        elapsed = max(0.0, time.monotonic() - self.started_at)
        self.outcome = outcome
        self.state = "success" if successful else "failed"
        self.progress.update(
            self.task_id,
            description=f"[{('green' if successful else 'red')}]{self.label}: {outcome}[/{('green' if successful else 'red')}]",
            completed=100 if successful else min(94, elapsed / self.estimate * 100),
            state=self.state,
        )
        self.progress.stop_task(self.task_id)
        return elapsed

    def advance(self, fraction: float, label: str) -> None:
        """Mark a confirmed finalization phase while preserving its time estimate."""
        self.progress.update(
            self.task_id,
            description=f"[bold #66d6f2]{label}[/bold #66d6f2]",
            completed=min(94.0, max(0.0, float(fraction) * 100)),
        )

    def close(self) -> None:
        if self.interactive:
            self.progress.stop()
        else:
            color = "green" if self.state == "success" else "red"
            self.console.print(
                Panel.fit(Text(f"{self.label} · {self.outcome}", style=color), border_style=color)
            )


def run_timed_stage(
    name: str,
    label: str,
    operation: Callable[[], Any],
    console: Console,
    *,
    record_when: Callable[[Any], bool] | None = None,
    outcome_for: Callable[[Any], str] | None = None,
) -> Any:
    """Run an operation with history-based progress and return its value."""
    progress = TimedStageProgress(name, label, console)
    successful = False
    value: Any = None
    elapsed = 0.0
    try:
        progress.__enter__()
        value = operation()
        should_record = record_when(value) if record_when else True
        outcome = outcome_for(value) if outcome_for else "Complete"
        elapsed = progress.finish(outcome, successful=True)
        successful = should_record
        return value
    except BaseException:
        if progress.state == "running":
            elapsed = progress.finish("Failed", successful=False)
        raise
    finally:
        progress.close()
        if successful:
            record_stage_duration(name, elapsed, progress.weekday)


def render_key_value_table(
    title: str,
    rows: list[tuple[str, Any]],
    console: Console,
    *,
    status: str | None = None,
) -> Table:
    table = Table(title=title, show_header=True, header_style="bold #66d6f2", expand=True)
    table.add_column("Item", style="bold", no_wrap=False)
    table.add_column("Result", overflow="fold")
    for key, value in rows:
        table.add_row(str(key), str(value))
    if status == "failed":
        table.title_style = "bold red"
    console.print(table)
    return table


def format_bytes(value: Any) -> str:
    try:
        amount = float(value)
    except (TypeError, ValueError, OverflowError):
        return "—"
    if amount < 0:
        return "—"
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if amount < 1000 or unit == "TB":
            return f"{amount:.1f} {unit}" if unit != "B" else f"{int(amount)} B"
        amount /= 1000
    return f"{amount:.1f} TB"
