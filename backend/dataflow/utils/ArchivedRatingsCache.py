"""Persist ratings independently of the catalog rows that display them."""

from collections import defaultdict
from datetime import datetime, timedelta, timezone
import logging
import re
from threading import Lock

from backend.dataflow.utils.ProviderFreshness import FIELDS
from backend.dataflow.utils.TmdbMovieDetailsCache import archive_cutoff_year, movie_release_year
from backend.utils.log.cloudflare_storage import LeaseLostError


ARCHIVED_RATINGS_TABLE = "archived_movie_ratings_cache"
PROVIDERS = ("letterboxd", "rotten_tomatoes", "imdb")
COMPLETE = {"success", "no_score", "no_listing", "no_data"}
MAX_ATTEMPTS = 3
RETRY_INTERVAL = timedelta(days=7)
BATCH_SIZE = 200
LOGGER = logging.getLogger(__name__)


def original_release_year(row, tmdb=None):
    year = movie_release_year((tmdb or {}).get("release_date"))
    if year is not None:
        return year
    value = str(row.get("release_year") or "")
    return int(value) if re.fullmatch(r"[1-9][0-9]{3}", value) else None


def is_archived_row(row, tmdb=None, *, now=None):
    year = original_release_year(row, tmdb)
    return year is not None and year <= archive_cutoff_year(now)


def _state(row, provider):
    return (row.get("provider_freshness") or {}).get(provider) or {}


def _values(row, provider):
    return {field: row[field] for field in FIELDS[provider] if row.get(field) not in (None, "")}


def _record(tmdb_id, provider, identity, values, event, attempts):
    return {
        "tmdb_id": tmdb_id,
        "provider": provider,
        "provider_identity": identity,
        "rating_values": values,
        "outcome": event["outcome"],
        "reason": event.get("reason"),
        "source": event.get("source") or {},
        "attempted_at": event.get("attempted_at"),
        "checked_at": event.get("checked_at"),
        "attempts": attempts,
    }


class ArchivedRatingsCache:
    def __init__(self, flow, rows, *, now=None):
        self.now = now or datetime.now(timezone.utc)
        self.client = getattr(getattr(flow, "_publication", None), "client", None)
        self.available = True
        self.records = {}
        self.imdb_ids = {}
        self.locks = {}
        candidates = defaultdict(list)
        tmdb_by_id = flow._update_tmdb
        for row in rows:
            tmdb_id = flow.clean_int(row.get("tmdb_id"))
            if tmdb_id and is_archived_row(row, tmdb_by_id.get(tmdb_id), now=self.now):
                candidates[tmdb_id].append(row)
        self.locks = {tmdb_id: Lock() for tmdb_id in candidates}
        if not candidates:
            return

        try:
            self._load(candidates)
        except LeaseLostError:
            raise
        except Exception as error:
            self.available = False
            LOGGER.warning("Archived ratings cache read failed (%s)", type(error).__name__)

        for tmdb_id, movie_rows in candidates.items():
            details = tmdb_by_id.get(tmdb_id) or {}
            imdb_record = self.records.get((tmdb_id, "imdb")) or {}
            possible_ids = [
                (details.get("external_ids") or {}).get("imdb_id"),
                *(row.get("imdb_id") for row in movie_rows),
                imdb_record.get("provider_identity"),
            ]
            self.imdb_ids[tmdb_id] = next(
                (value for value in possible_ids if isinstance(value, str) and re.fullmatch(r"tt[0-9]+", value)),
                None,
            )
        if self.available:
            self._seed(candidates)

    def _load(self, candidates):
        ids = sorted(candidates)
        columns = ",".join([
            "tmdb_id", "imdb_id", "rt_id", "provider_freshness",
            *(field for provider in PROVIDERS for field in FIELDS[provider]),
        ])
        for start in range(0, len(ids), BATCH_SIZE):
            batch = ids[start:start + BATCH_SIZE]
            rows = self.client.table(ARCHIVED_RATINGS_TABLE).select("*").in_("tmdb_id", batch).execute().data
            if not isinstance(rows, list):
                raise ValueError("Incomplete archived ratings cache response")
            self.records.update({(row["tmdb_id"], row["provider"]): row for row in rows})
            unseeded = [tmdb_id for tmdb_id in batch if any(
                (tmdb_id, provider) not in self.records for provider in PROVIDERS
            )]
            if not unseeded:
                continue
            for table in ("finalMovies", "finalThequeMovies"):
                legacy = self.client.table(table).select(columns).in_("tmdb_id", unseeded).execute().data
                if not isinstance(legacy, list):
                    raise ValueError("Incomplete archived ratings seed response")
                for row in legacy:
                    candidates[row["tmdb_id"]].append(row)

    def _seed(self, candidates):
        seeds = []
        for tmdb_id, rows in candidates.items():
            for provider in PROVIDERS:
                if (tmdb_id, provider) in self.records:
                    continue
                eligible = [
                    row for row in rows
                    if provider != "imdb" or not row.get("imdb_id") or row["imdb_id"] == self.imdb_ids[tmdb_id]
                ]
                scored = [row for row in eligible if _values(row, provider)]
                if scored:
                    row = max(scored, key=lambda row: _state(row, provider).get("last_success_at") or "")
                    state = _state(row, provider)
                    event = {
                        "outcome": "success",
                        "reason": "seeded_existing_values",
                        "checked_at": state.get("last_success_at"),
                        "source": state.get("last_success_source"),
                    }
                else:
                    checked = [row for row in eligible if _state(row, provider).get("outcome") in COMPLETE]
                    if not checked:
                        continue
                    row = max(checked, key=lambda row: _state(row, provider).get("checked_at") or "")
                    event = _state(row, provider)
                identity = self.imdb_ids[tmdb_id] if provider == "imdb" else row.get("rt_id") if provider == "rotten_tomatoes" else None
                seeds.append(_record(tmdb_id, provider, identity, _values(row, provider), event, 0))
        for start in range(0, len(seeds), BATCH_SIZE):
            self.save(seeds[start:start + BATCH_SIZE], seeds=True)

    def save(self, records, *, seeds=False):
        if not records:
            return
        # Keep the result available to the other catalog even if a durable write fails.
        self.records.update({(row["tmdb_id"], row["provider"]): row for row in records})
        try:
            self.client.table(ARCHIVED_RATINGS_TABLE).upsert(
                records, on_conflict="tmdb_id,provider", ignore_duplicates=seeds
            ).execute()
        except LeaseLostError:
            raise
        except Exception as error:
            self.available = False
            LOGGER.warning("Archived ratings cache write failed (%s)", type(error).__name__)

    def should_check_imdb(self, tmdb_id):
        if tmdb_id not in self.locks:
            return True
        return bool(self.imdb_ids[tmdb_id]) and self.should_check(tmdb_id, "imdb")

    def should_check(self, tmdb_id, provider):
        if not self.available:
            return False
        record = self.records.get((tmdb_id, provider))
        if record is None:
            return True
        if record["outcome"] in COMPLETE or record["attempts"] >= MAX_ATTEMPTS:
            return False
        attempted = datetime.fromisoformat(record["attempted_at"])
        return self.now - attempted >= RETRY_INTERVAL


class ArchivedRatingsUpdate:
    def prepareArchivedRatings(self, rows):
        self._archived_ratings = ArchivedRatingsCache(self, rows)
        return self._archived_ratings

    def updateMovieRatings(self, original, row, existing, tmdb_id):
        archive = getattr(self, "_archived_ratings", None)
        if archive is None or tmdb_id not in archive.locks:
            self.updateProviders(row, existing, tmdb_id)
            self._updateImdbRating(row)
            return

        # Both catalog rows consume the same result during a shared run.
        with archive.locks[tmdb_id]:
            imdb_id = archive.imdb_ids[tmdb_id]
            row["imdb_id"] = imdb_id or row.get("imdb_id")
            requested = {
                provider for provider in PROVIDERS
                if archive.should_check(tmdb_id, provider) and (provider != "imdb" or imdb_id)
            }
            previous_states = {}
            for provider in PROVIDERS:
                previous_states[provider] = _state(row, provider).get("attempted_at")
                record = archive.records.get((tmdb_id, provider))
                if self.solo_update_only:
                    row.update(_values(original, provider))
                if record is None:
                    continue
                identity = record["provider_identity"]
                if provider == "imdb" and identity and imdb_id and identity != imdb_id:
                    continue
                if provider == "rotten_tomatoes" and identity:
                    row["rt_id"] = identity
                values = record["rating_values"]
                row.update(values)
                self.recordProviderFreshness(row, provider, {
                    "outcome": "cached",
                    "reason": "archived_provider_outcome",
                    "source": {
                        **record["source"],
                        "fetched_at": record["checked_at"],
                        "cached_outcome": record["outcome"],
                    },
                }, values)
            if requested.intersection(("letterboxd", "rotten_tomatoes")):
                self.updateProviders(row, {**existing, **row}, tmdb_id, skip_providers=set(PROVIDERS) - requested)
            if "imdb" in requested:
                self._updateImdbRating(row)
            results = []
            for provider in requested:
                state = _state(row, provider)
                attempted = state.get("attempted_at")
                if not attempted or attempted == previous_states[provider]:
                    continue
                outcome = state["outcome"]
                if provider == "imdb" and outcome == "no_listing" and state.get("reason") != "absent_from_dataset":
                    state = {**state, "outcome": "failed"}
                previous = archive.records.get((tmdb_id, provider))
                identity = imdb_id if provider == "imdb" else row.get("rt_id") if provider == "rotten_tomatoes" else None
                results.append(_record(
                    tmdb_id, provider, identity, _values(row, provider), state,
                    (previous["attempts"] if previous else 0) + 1,
                ))
            archive.save(results)

    def _updateImdbRating(self, row):
        imdb_id = (row.get("imdb_id") or "").strip()
        ratings = self._imdb_ratings.get(imdb_id)
        if ratings:
            row["imdbRating"] = ratings["rating"]
            row["imdbVotes"] = ratings["votes"]
        self.recordImdbFreshness(row, imdb_id, ratings)
