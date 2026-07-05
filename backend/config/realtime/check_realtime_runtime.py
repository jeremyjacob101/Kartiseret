from __future__ import annotations

import importlib
import importlib.util
import sys


REQUIRED_PACKAGES = (
    ("dotenv", "python-dotenv"),
    ("supabase", "supabase"),
)


def main() -> int:
    missing = [
        package_name
        for module_name, package_name in REQUIRED_PACKAGES
        if importlib.util.find_spec(module_name) is None
    ]

    if missing:
        print("Missing Python packages: " + ", ".join(missing), file=sys.stderr)
        print(f"Install them with: {sys.executable} -m pip install -r requirements.txt", file=sys.stderr)
        return 1

    try:
        importlib.import_module("backend.config.realtime.realtime_watcher")
    except Exception as exc:
        print(f"Realtime watcher import failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
