"""Initialize the selected environment's D1 run-artifact schema."""

from __future__ import annotations

import argparse
import os
import sys

from dotenv import load_dotenv

from backend.config.target_environment import resolve_target_environment
from backend.utils.log.run_storage import RunArtifactStore


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("development", "production"), required=True)
    args = parser.parse_args(argv)

    load_dotenv()
    try:
        resolved = resolve_target_environment(args.target, os.environ)
    except ValueError as error:
        print(f"Invalid {args.target} run-storage configuration: {error}", file=sys.stderr)
        return 2

    # Do not pass the other environment's secrets into the storage client.
    for name in list(os.environ):
        if name.startswith(("DEV_", "PROD_")):
            os.environ[name] = ""
    os.environ.update(resolved)
    try:
        RunArtifactStore().ensure_schema()
    except Exception as error:
        print(f"Could not initialize {args.target} run storage ({type(error).__name__}).", file=sys.stderr)
        return 1
    print(f"Initialized the D1 run-artifact schema for {args.target}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
