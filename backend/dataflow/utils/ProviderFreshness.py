"""Compact provenance for published values; no attempt history or retry policy."""
from copy import deepcopy
from datetime import datetime, timezone
from math import isfinite
from gzip import BadGzipFile

FIELDS = {
    "tmdb": ("english_title", "runtime", "popularity", "imdb_id", "en_poster", "backdrop", "release_year", "tmdbRating", "tmdbVotes", "en_trailer", "genres"),
    "imdb": ("imdbRating", "imdbVotes"),
    "rotten_tomatoes": ("rtCriticRating", "rtCriticVotes", "rtAudienceRating", "rtAudienceVotes"),
    "letterboxd": ("lbRating", "lbVotes"),
}


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def failure(error):
    status = getattr(error, "status", None)
    if status == 429:
        return "rate_limited", "http_429"
    if status in (401, 403):
        return "blocked", f"http_{status}"
    if status == 404:
        return "no_listing", "http_404"
    if status == 200 or isinstance(error, (ValueError, EOFError, BadGzipFile)):
        return "parse_error", "invalid_data"
    if isinstance(error, OSError):
        return "failed", "storage_or_transport_error"
    return "failed", "request_failed"


def observation(outcome, reason, source=None, started=None):
    return {"outcome": outcome, "reason": reason, "source": source or {}, "attempted_at": started or utc_now(), "checked_at": utc_now()}


class ProviderFreshness:
    def startProviderFreshness(self, original, target):
        target["provider_freshness"] = deepcopy(original.get("provider_freshness") or {})
        providers = ("tmdb",) if self.MAIN_TABLE_NAME in ("finalSoons", "allSoons") else tuple(FIELDS)
        for provider in providers:
            state = target["provider_freshness"].setdefault(provider, {"outcome": "not_attempted"})
            fields = state.setdefault("fields", {})
            for field in FIELDS[provider]:
                if field not in target:
                    continue
                previous = fields.get(field, {})
                if target[field] is None or target[field] == "" or target[field] == []:
                    fields[field] = {"state": "cleared" if getattr(self, "solo_update_only", False) else "missing"}
                else:
                    fields[field] = {**previous, "state": "retained" if previous.get("observed_at") else "unverified"}

    def recordProviderFreshness(self, target, provider, event, refreshed=()):
        if "provider_freshness" not in target:
            self.startProviderFreshness(target, target)
        state = target["provider_freshness"].setdefault(provider, {})
        state.update({key: deepcopy(value) for key, value in event.items()})
        if event["outcome"] in ("success", "no_score", "no_data", "no_listing") and event.get("checked_at"):
            state["last_checked_at"] = event["checked_at"]
        refreshed = [field for field in refreshed if field in FIELDS[provider]]
        if refreshed:
            state["last_success_at"] = event["checked_at"]
            state["last_success_source"] = deepcopy(event.get("source", {}))
        fields = state.setdefault("fields", {})
        for field in refreshed:
            fields[field] = {"state": "refreshed", "observed_at": event["checked_at"], "source": deepcopy(event.get("source", {}))}
        # Existing artifact summaries remain diagnostics, never a run status.
        if getattr(self, "summaryEnabled", False):
            with self._request_lock:
                counts = getattr(self, "providerOutcomeCounts", None)
                if counts is None:
                    counts = self.providerOutcomeCounts = {}
                key = f"{provider}:{event['outcome']}:{event['reason']}"
                counts[key] = counts.get(key, 0) + 1
                examples = getattr(self, "providerOutcomeExamples", None)
                if examples is None:
                    examples = self.providerOutcomeExamples = {}
                sample = examples.setdefault(key, [])
                if len(sample) < 5 and target.get("tmdb_id") not in sample:
                    sample.append(target.get("tmdb_id"))

    def recordTmdbFreshness(self, target, data, tmdb_id, *, original=None, mapping=False):
        if original is not None:
            self.startProviderFreshness(original, target)
        key = (f"movie/{tmdb_id}", (("append_to_response", "external_ids,videos"),))
        with self._request_lock:
            event = deepcopy(getattr(self._request_context, "tmdb_observations", {}).get(key))
        if event is None:
            # No network observation (e.g. an injected fixture) is not a new check.
            return
        refreshed = []
        if data:
            sources = {"english_title": data.get("title"), "runtime": data.get("runtime"), "popularity": data.get("popularity"), "imdb_id": (data.get("external_ids") or {}).get("imdb_id"), "en_poster": data.get("poster_path"), "backdrop": data.get("backdrop_path"), "release_year": data.get("release_date"), "tmdbRating": data.get("vote_average"), "tmdbVotes": data.get("vote_count"), "genres": data.get("genres")}
            for field, value in sources.items():
                if field not in target or target[field] is None or target[field] == "" or target[field] == [] or value is None or value == "" or value == []:
                    continue
                if field == "release_year" and self.MAIN_TABLE_NAME in ("allSoons", "finalSoons"):
                    continue  # Local Coming Soon dates supply this value.
                if isinstance(value, (int, float)) and not isfinite(value):
                    continue
                if field == "runtime" and self.MAIN_TABLE_NAME in ("allTheques", "finalThequeMovies") and isinstance(value, (int, float)) and value <= 0:
                    continue
                if field == "runtime" and mapping and not value:
                    continue
                refreshed.append(field)
            videos = (data.get("videos") or {}).get("results") or []
            if target.get("en_trailer") and any(v.get("key") == target["en_trailer"] for v in videos):
                refreshed.append("en_trailer")
        if event["outcome"] == "success" and not refreshed:
            event.update(outcome="no_data", reason="no_applicable_fields")
        self.recordProviderFreshness(target, "tmdb", event, refreshed)

    def recordImdbFreshness(self, target, imdb_id, ratings):
        event = deepcopy(getattr(self, "_imdb_observation", None))
        if not imdb_id:
            event = {"outcome": "not_attempted", "reason": "missing_imdb_id", "source": {}}
        elif event is None:
            return
        elif event["outcome"] == "success" and not ratings:
            event.update(outcome="no_listing", reason="absent_from_dataset")
        if event is not None:
            event["source"] = {**event.get("source", {}), "imdb_id": str(imdb_id)[:128]}
            self.recordProviderFreshness(target, "imdb", event, ("imdbRating", "imdbVotes") if ratings else ())

    def prepareMovieFreshness(self, table, rows):
        if table not in ("finalMovies", "finalThequeMovies", "finalSoons"):
            return
        for row in rows:
            if "provider_freshness" in row:
                # A later existing normalization may turn a parsed value into
                # an empty field; it must not retain a current observation.
                for provider, fields in FIELDS.items():
                    state = row["provider_freshness"].get(provider, {}).get("fields", {})
                    for field in fields:
                        if field in row and (row[field] is None or row[field] == "" or row[field] == []):
                            state[field] = {"state": "cleared" if getattr(self, "solo_update_only", False) else "missing"}
                continue
            tmdb_id = self.clean_int(row.get("tmdb_id"))
            previous = self.supabase.table(table).select("*").eq("tmdb_id", tmdb_id).execute().data or []
            self.startProviderFreshness(previous[0] if previous else {}, row)
            key = (f"movie/{tmdb_id}", (("append_to_response", "external_ids,videos"),))
            with self._request_lock:
                pending = self._tmdb_cache.get(key)
            if pending is not None and pending.done() and pending.exception() is None:
                self.recordTmdbFreshness(row, pending.result(), tmdb_id, mapping=True)
