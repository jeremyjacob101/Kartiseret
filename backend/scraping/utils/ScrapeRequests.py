"""Bounded retries for read-only scraper requests."""

import base64
import gzip
import hashlib
import json
import os
import re
from pathlib import Path

from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


def validate_scrape_response(response, *args, **kwargs):
    """Reject observable denials before a collector can mistake them for data."""
    response.raise_for_status()
    if response.headers.get('cf-mitigated', '').lower() == 'challenge':
        raise ValueError(f'Scrape response is a Cloudflare challenge: {response.url}')
    if 'html' in response.headers.get('Content-Type', '').lower():
        # Do not reject ordinary pages merely for including CAPTCHA widgets or
        # the word "Cloudflare" in their scripts/footer.
        title = re.search(r'<title[^>]*>(.*?)</title>', response.text, re.I | re.S)
        title = re.sub(r'\s+', ' ', title.group(1)).strip().lower() if title else ''
        if title in {
            'just a moment...', 'just a moment…', '403 forbidden',
            'access denied', 'attention required! | cloudflare',
        }:
            raise ValueError(f'Scrape response is an access-denial page: {response.url}')
    return response


def validate_scrape_coverage(coverage):
    """Check discovery/completion counts without consulting another transport.

    Cinema City's feature/presentation totals have source-specific accounting
    (including filtered and duplicate records), checked inside its collectors.
    """
    if not isinstance(coverage, dict) or not any(key.endswith('_expected') for key in coverage):
        raise ValueError('Requests collection has no discovery coverage evidence')
    aliases = {
        'calendar_dates': 'dates_completed',
        'date_tokens': 'date_tokens_found',
        'locations': 'locations_validated',
    }
    for key, expected in coverage.items():
        if not key.endswith('_expected'):
            continue
        prefix = key[:-len('_expected')]
        if prefix in {'features', 'features_upcoming', 'presentations'}:
            continue
        completed_key = aliases.get(prefix, prefix + '_completed')
        if prefix == 'cards' and 'cards_parsed' in coverage:
            completed_key = 'cards_parsed'
        completed = coverage.get(completed_key)
        if type(expected) is not int or type(completed) is not int or expected < 0 or completed != expected:
            raise ValueError(f'Incomplete scrape coverage: {key}={expected}, {completed_key}={completed}')


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


def configure_scrape_session(session, *, stats=None, retry_methods=("GET",), capture=True):
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
    adapter = session.adapters.get('https://')
    if isinstance(adapter, CountingAdapter):
        # Wix enables POST retries after its token bootstrap. Keep that
        # attempt's connection pool owned by the session instead of replacing
        # an adapter whose live connections would escape Session.close().
        adapter.max_retries = retry
        adapter.stats = stats
    else:
        adapter = CountingAdapter(max_retries=retry, stats=stats)
        session.mount('http://', adapter)
        session.mount('https://', adapter)
    hooks = session.hooks.setdefault('response', [])
    if isinstance(hooks, list) and validate_scrape_response in hooks:
        hooks.remove(validate_scrape_response)
    capture_dir = os.environ.get("SCRAPER_SOURCE_CAPTURE_DIR") if capture else None
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
    # Capture failed responses too, before the validation hook raises.
    hooks.append(validate_scrape_response)
    return session
