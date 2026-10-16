"""Run the selected pipeline plan inside its supervisor-owned process group."""

from __future__ import annotations

import importlib
import json
import os
from typing import Any

from dotenv import load_dotenv

from backend.config.job_control import report_event


def _resolve_class(module_name: str, qualname: str):
    value: Any = importlib.import_module(module_name)
    for component in qualname.split("."):
        value = getattr(value, component)
    if not isinstance(value, type):
        raise TypeError(f"pipeline plan entry is not a class: {module_name}.{qualname}")
    return value


def _decode_plan(raw: str | None) -> list[tuple]:
    if not raw:
        from backend.config.runners import DEFAULT_PLAN

        return list(DEFAULT_PLAN)

    entries = json.loads(raw)
    if not isinstance(entries, list):
        raise ValueError("supervised plan must be a JSON list")
    plan = []
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("kind"), str) or not isinstance(entry.get("key"), str):
            raise ValueError("invalid supervised plan entry")
        kind, key = entry["kind"], entry["key"]
        if kind not in {"cinema", "dataflow"}:
            raise ValueError(f"unsupported supervised plan kind: {kind}")
        classes = entry.get("classes")
        if classes is None:
            plan.append((kind, key))
            continue
        if not isinstance(classes, list):
            raise ValueError("supervised plan classes must be a JSON list")
        plan.append((kind, key, [_resolve_class(row["module"], row["qualname"]) for row in classes]))
    return plan


def main() -> int:
    load_dotenv()
    from backend.config.runners import runPlan
    from backend.utils.log import artifact_logging
    from backend.utils.log.run_logging import RunLogSession

    artifact_logging.setup_logging()
    plan = _decode_plan(os.environ.get("KARTISERET_RUN_PLAN_JSON"))
    with RunLogSession(on_allocated=lambda run_id: report_event("run_id", run_id=int(run_id))) as run:
        run.set_plan(plan)
        if os.environ.get("KARTISERET_RUN_SHOW_PLAN_HEADER") == "true":
            from backend.utils.console.inputMenu import _plan_header

            header = _plan_header(plan)
        else:
            header = None
        successful = runPlan(run.run_id, plan, header_renderable=header)
        run.set_successful(successful)

    # Send completion only after RunLogSession has finished its own finalization.
    report_event("run_complete", successful=bool(successful))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
