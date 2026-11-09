"""Rolling duration history scoped by runner machine, weekday and transport."""

from datetime import datetime
from math import isfinite
from zoneinfo import ZoneInfo


JERUSALEM_TIMEZONE = ZoneInfo("Asia/Jerusalem")
WEEKDAY_ORDER = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
WEEKDAYS = frozenset(WEEKDAY_ORDER)
HISTORY_TABLE = "utilAvgTimeHistory"
APPEND_RPC = "append_util_avg_time_history"
TRANSPORT_APPEND_RPC = "append_util_avg_time_transport_history"
TIMING_TRANSPORTS = frozenset({'legacy', 'requests', 'selenium', 'requests_selenium_fallback'})
HISTORY_LIMIT = 5


def current_weekday() -> str:
    """Return today's weekday in the application's Jerusalem timezone."""
    return weekday_at(datetime.now(JERUSALEM_TIMEZONE))


def weekday_at(instant: datetime) -> str:
    """Return the Jerusalem weekday for an aware start timestamp."""
    if instant.tzinfo is None:
        raise ValueError("instant must include a timezone")
    return WEEKDAY_ORDER[instant.astimezone(JERUSALEM_TIMEZONE).weekday()]


def average_recent_times(values: object) -> float | None:
    """Average up to the five newest valid durations from a database array."""
    if not isinstance(values, (list, tuple)) or not values:
        return None

    parsed = []
    for value in values[-HISTORY_LIMIT:]:
        if isinstance(value, bool):
            continue
        try:
            duration = float(value)
        except (TypeError, ValueError, OverflowError):
            continue
        if isfinite(duration) and duration > 0:
            parsed.append(duration)

    return sum(parsed) / len(parsed) if parsed else None


def load_recent_averages(
    supabase,
    names: list[str],
    runner_machine: str | None,
    weekday: str,
    *,
    transport: str = 'legacy',
) -> dict[str, float]:
    """Load one machine/weekday/transport; missing buckets stay missing."""
    if transport not in TIMING_TRANSPORTS:
        raise ValueError('Unknown timing transport')
    if not names or not runner_machine or weekday not in WEEKDAYS:
        return {}

    response = (
        supabase.table(HISTORY_TABLE)
        .select("name,recent_times")
        .eq("runner_machine", runner_machine)
        .eq("weekday", weekday)
        .eq('transport', transport)
        .in_("name", names)
        .execute()
    )

    averages = {}
    for row in response.data or []:
        name = row.get("name")
        average = average_recent_times(row.get("recent_times"))
        if name and average is not None:
            averages[name] = average
    return averages


def append_recent_duration(
    supabase,
    name: str,
    runner_machine: str,
    weekday: str,
    duration_seconds: float,
    *,
    transport: str = 'legacy',
) -> None:
    """Append a successful duration through Postgres' atomic rolling update."""
    if transport not in TIMING_TRANSPORTS:
        raise ValueError('Unknown timing transport')
    try:
        duration = float(duration_seconds)
    except (TypeError, ValueError, OverflowError) as error:
        raise ValueError("duration_seconds must be a finite positive number") from error
    if not isfinite(duration) or duration <= 0:
        raise ValueError("duration_seconds must be a finite positive number")
    if not name or not name.strip() or not runner_machine or not runner_machine.strip() or weekday not in WEEKDAYS:
        raise ValueError("runner name, machine, and a lowercase weekday are required")

    params = {
        "p_name": name,
        "p_runner_machine": runner_machine,
        "p_weekday": weekday,
        "p_duration": duration,
    }
    if transport != 'legacy':
        params['p_transport'] = transport
    supabase.rpc(APPEND_RPC if transport == 'legacy' else TRANSPORT_APPEND_RPC, params).execute()
