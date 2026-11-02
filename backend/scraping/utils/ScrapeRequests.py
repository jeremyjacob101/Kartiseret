"""Bounded retries for read-only scraper requests."""

import base64
import gzip
import hashlib
import json
import os
from pathlib import Path

from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


class BoundedRetry(Retry):
    def get_retry_after(self, response):
        delay = super().get_retry_after(response)
        return min(delay, 10) if delay is not None else None


class CountingAdapter(HTTPAdapter):
    def __init__(self, *args, stats=None, **kwargs):
        self.stats = stats
        super().__init__(*args, **kwargs)

    def send(self, request, **kwargs):
        if self.stats is not None:
            self.stats['requests'] += 1
        response = super().send(request, **kwargs)
        if self.stats is not None:
            retries = getattr(getattr(response.raw, 'retries', None), 'history', ())
            self.stats['observed_retries'] += len(retries)
        return response


def configure_scrape_session(session, *, stats=None, retry_methods=("GET",)):
    retry = BoundedRetry(
        total=2,
        connect=2,
        read=2,
        status=2,
        allowed_methods=frozenset(method.upper() for method in retry_methods),
        status_forcelist=(429, 500, 502, 503, 504),
        backoff_factor=0.5,
        respect_retry_after_header=True,
        raise_on_status=False,
    )
    adapter = CountingAdapter(max_retries=retry, stats=stats)
    session.mount('http://', adapter)
    session.mount('https://', adapter)
    capture_dir = os.environ.get("SCRAPER_SOURCE_CAPTURE_DIR")
    if capture_dir:
        capture_path = Path(capture_dir) / "source-responses.jsonl.gz"
        capture_path.parent.mkdir(parents=True, exist_ok=True)
        counters = {"responses": 0}

        def capture_response(response, *args, **kwargs):
            counters["responses"] += 1
            try:
                body = response.content
                request_body = getattr(response.request, "body", None)
                if isinstance(request_body, bytes):
                    request_body = request_body.decode("utf-8", errors="replace")
                record = {
                    "sequence": counters["responses"],
                    "method": response.request.method,
                    "url": response.url,
                    "request_body": request_body,
                    "status": response.status_code,
                    "content_type": response.headers.get("Content-Type"),
                    "sha256": hashlib.sha256(body).hexdigest(),
                    "body_base64": base64.b64encode(body).decode("ascii"),
                }
                # Append mode creates a valid concatenation of gzip members;
                # readers transparently stream all captured responses.
                with gzip.open(capture_path, "at", encoding="utf-8") as stream:
                    stream.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
                if stats is not None:
                    stats["captured_responses"] = stats.get("captured_responses", 0) + 1
            except Exception:
                if stats is not None:
                    stats["capture_errors"] = stats.get("capture_errors", 0) + 1
            return response

        session.hooks.setdefault("response", []).append(capture_response)
    return session
