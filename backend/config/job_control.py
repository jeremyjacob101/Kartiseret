"""Small control channel between a supervised worker and its parent."""

from __future__ import annotations

import json
import os


CONTROL_FD_ENV = "KARTISERET_JOB_CONTROL_FD"


def report_event(event: str, **values) -> None:
    raw_fd = os.environ.get(CONTROL_FD_ENV)
    if raw_fd is None:
        return
    try:
        fd = int(raw_fd)
        payload = json.dumps({"event": event, **values}, separators=(",", ":")).encode("utf-8") + b"\n"
        os.write(fd, payload)
    except (OSError, TypeError, ValueError):
        # The control channel is diagnostic. Losing it must not block the job.
        return
