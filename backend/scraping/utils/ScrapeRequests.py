"""Bounded retries for read-only scraper requests."""

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


def configure_scrape_session(session, *, stats=None):
    retry = BoundedRetry(
        total=2,
        connect=2,
        read=2,
        status=2,
        allowed_methods=frozenset({'GET'}),
        status_forcelist=(429, 500, 502, 503, 504),
        backoff_factor=0.5,
        respect_retry_after_header=True,
        raise_on_status=False,
    )
    adapter = CountingAdapter(max_retries=retry, stats=stats)
    session.mount('http://', adapter)
    session.mount('https://', adapter)
    return session
