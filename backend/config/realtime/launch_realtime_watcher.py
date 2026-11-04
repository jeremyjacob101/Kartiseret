"""Resolve one complete local environment before starting the realtime watcher."""

from __future__ import annotations

import argparse
import os
import sys

from dotenv import load_dotenv

from backend.config.target_environment import resolve_target_environment


def selected_environment(target: str | None = None, environ: dict[str, str] | None = None) -> tuple[str, dict[str, str]]:
    source = dict(os.environ if environ is None else environ)
    target = (target or source.get("KARTISERET_TARGET") or "production").strip()
    return target, resolve_target_environment(target, source)


def main(argv: list[str] | None = None) -> int:
    load_dotenv()
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=("development", "production"))
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--exec", action="store_true", dest="exec_watcher")
    args = parser.parse_args(argv)
    try:
        target, resolved = selected_environment(args.target)
    except ValueError as error:
        print(f"Invalid realtime watcher configuration: {error}", file=sys.stderr)
        return 125
    if args.validate_only:
        print(f"Realtime watcher configuration is valid for {target}.")
        return 0
    if not args.exec_watcher:
        parser.error("use --validate-only or --exec")
    environment = {**os.environ, **resolved}
    os.execvpe(
        sys.executable,
        [sys.executable, "-m", "backend.config.realtime.realtime_watcher"],
        environment,
    )
    return 127


if __name__ == "__main__":
    raise SystemExit(main())
