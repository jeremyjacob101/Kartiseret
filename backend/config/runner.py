from __future__ import annotations

from dotenv import load_dotenv

load_dotenv()  # Load .env before selecting a local or scheduled plan.

import json
import os
from pathlib import Path
import sys

from backend.config.job_supervisor import job_seconds, run_managed_process, termination_grace_seconds


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _serialize_plan(plan: list[tuple]) -> str:
    entries = []
    for entry in plan:
        kind, key = entry[:2]
        classes = entry[2] if len(entry) > 2 else None
        entries.append({
            "kind": kind,
            "key": key,
            "classes": None if classes is None else [
                {"module": cls.__module__, "qualname": cls.__qualname__} for cls in classes
            ],
        })
    return json.dumps(entries, separators=(",", ":"))


def _select_plan():
    if (
        os.environ.get("GITHUB_ACTIONS") == "true"
        or os.environ.get("JJ_INTEL_MAC_DAILY_RUN") == "true"
        or os.environ.get("JJ_INTEL_MAC_WEEKLY_RUN") == "true"
    ):
        return None, None
    from backend.utils.console.inputMenu import choose_run_plan

    return choose_run_plan()


def main() -> int:
    try:
        plan, header = _select_plan()
        environment = {"KARTISERET_RUN_SHOW_PLAN_HEADER": "true" if header is not None else "false"}
        if plan is None:
            environment["KARTISERET_RUN_PLAN_JSON"] = ""
        else:
            environment["KARTISERET_RUN_PLAN_JSON"] = _serialize_plan(plan)
        outcome = run_managed_process(
            [sys.executable, "-m", "backend.config.runner_worker"],
            seconds=job_seconds(),
            grace_seconds=termination_grace_seconds(),
            env=environment,
            cwd=str(PROJECT_ROOT),
        )
        return outcome.exit_code
    except KeyboardInterrupt:
        print("Pipeline plan selection interrupted.", file=sys.stderr, flush=True)
        return 130
    except ValueError as error:
        print(f"Invalid pipeline execution configuration: {error}", file=sys.stderr, flush=True)
        return 125


if __name__ == "__main__":
    raise SystemExit(main())
