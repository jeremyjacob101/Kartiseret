from __future__ import annotations

import json
import os
import argparse
from pathlib import Path
import sys
import subprocess

from backend.config.target_environment import (
    TargetConfigurationError,
    is_scheduled,
    resolve_target_environment,
    validate_target,
)


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _install_requirements() -> int:
    print("Checking Python dependencies from requirements.txt...", flush=True)
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "--prefer-binary",
             "--disable-pip-version-check", "--no-input", "--quiet",
             "-r", str(PROJECT_ROOT / "requirements.txt")],
            cwd=PROJECT_ROOT,
            stdin=subprocess.DEVNULL,
            timeout=600,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        print(f"Dependency installation failed: {error}", file=sys.stderr, flush=True)
        return 1
    if result.returncode:
        print("Dependency installation failed; pipeline was not started.", file=sys.stderr, flush=True)
    return result.returncode


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


def _select_target(cli_target: str | None = None) -> tuple[str, dict[str, str]]:
    environment_target = os.environ.get("KARTISERET_TARGET", "").strip() or None
    if cli_target:
        target = validate_target(cli_target)
    elif environment_target:
        target = validate_target(environment_target)
    elif is_scheduled(os.environ):
        target = "production"
    else:
        from backend.utils.console.inputMenu import choose_environment_target

        target = validate_target(choose_environment_target())
    return target, resolve_target_environment(target, os.environ)


def _select_plan():
    if (
        os.environ.get("JJ_INTEL_MAC_DAILY_RUN") == "true"
        or os.environ.get("JJ_INTEL_MAC_WEEKLY_RUN") == "true"
    ):
        return None, None
    from backend.utils.console.inputMenu import choose_run_plan

    return choose_run_plan()


def main(argv: list[str] | None = None) -> int:
    try:
        parser = argparse.ArgumentParser(add_help=True)
        parser.add_argument("--target", choices=("development", "production"))
        args, _unknown = parser.parse_known_args(argv)
        dependency_status = _install_requirements()
        if dependency_status:
            return dependency_status

        # Bootstrap before importing packages that may not be installed yet.
        from dotenv import load_dotenv
        from backend.config.job_supervisor import job_seconds, run_managed_process, termination_grace_seconds

        load_dotenv(PROJECT_ROOT / ".env")
        target, selected_environment = _select_target(args.target)
        plan, header = _select_plan()
        environment = {
            **selected_environment,
            "KARTISERET_RUN_SHOW_PLAN_HEADER": "true" if header is not None else "false",
        }
        if plan is None:
            environment["KARTISERET_RUN_PLAN_JSON"] = ""
        else:
            environment["KARTISERET_RUN_PLAN_JSON"] = _serialize_plan(plan)
        print(f"Running scraper target: {target}", flush=True)
        outcome = run_managed_process(
            [sys.executable, "-m", "backend.config.runner_worker"],
            seconds=job_seconds(),
            grace_seconds=termination_grace_seconds(),
            env=environment,
            cwd=str(PROJECT_ROOT),
        )
        run_id_file = os.environ.get("KARTISER_RUN_ID_FILE", "").strip()
        if run_id_file and outcome.run_id is not None:
            destination = Path(run_id_file).expanduser()
            destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            temporary = destination.with_suffix(destination.suffix + ".tmp")
            temporary.write_text(f"{outcome.run_id}\n", encoding="utf-8")
            try:
                temporary.chmod(0o600)
            except OSError:
                pass
            os.replace(temporary, destination)
        return outcome.exit_code
    except KeyboardInterrupt:
        print("Pipeline plan selection interrupted.", file=sys.stderr, flush=True)
        return 130
    except (TargetConfigurationError, ValueError) as error:
        print(f"Invalid pipeline execution configuration: {error}", file=sys.stderr, flush=True)
        return 125


if __name__ == "__main__":
    raise SystemExit(main())
