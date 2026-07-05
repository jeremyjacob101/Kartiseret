from __future__ import annotations

import re
import sys
from pathlib import Path


def get_dotenv_value(key: str, env_path: Path = Path(".env")) -> str:
    if not env_path.exists():
        return ""

    try:
        from dotenv import dotenv_values
    except Exception:
        dotenv_values = None

    if dotenv_values is not None:
        value = dotenv_values(env_path).get(key)
        return value or ""

    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        if "=" not in line:
            continue

        name, value = line.split("=", 1)
        if name.strip() != key:
            continue

        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            return value[1:-1]
        return re.split(r"\s+#", value, maxsplit=1)[0].strip()

    return ""


def main() -> int:
    if len(sys.argv) not in {2, 3}:
        print("Usage: dotenv_value.py KEY [ENV_PATH]", file=sys.stderr)
        return 2

    env_path = Path(sys.argv[2]) if len(sys.argv) == 3 else Path(".env")
    value = get_dotenv_value(sys.argv[1], env_path)
    if value:
        print(value)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
