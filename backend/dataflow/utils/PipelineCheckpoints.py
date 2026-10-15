"""Durable TMDb match decisions and resumable snapshot publication state."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import uuid


MATCHING_POLICY_VERSION = 1
MATCH_DECISION_TTL_DAYS = 180
RETRY_DIAGNOSTIC_TTL_HOURS = 24
CHECKPOINT_QUERY_BATCH_SIZE = 24
CHECKPOINT_INSERT_BATCH_SIZE = 50


def stable_fingerprint(value) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class PreparedPublication:
    """The input and write plan PR4 can move into one transactional publisher."""

    category: str
    snapshot_id: str
    run_id: int
    input_fingerprint: str
    screenings: tuple[dict, ...] = ()
    movies: tuple[dict, ...] = ()
    stale_screening_ids: tuple[str, ...] = ()
    retained_screening_ids: tuple[str, ...] = ()
    raw_row_ids_to_mark: tuple[str, ...] = ()
    unresolved_group_keys: tuple[str, ...] = ()
    source_complete: bool = False


class PipelineCheckpoints:
    """Small service-role-backed checkpoint API used by the dataflow stages."""

    def initPipelineCheckpoints(self):
        self._match_decision_cache = {}
        self._pending_match_checkpoints = []
        self._publication_owner_token = str(uuid.uuid4())
        self._publication_claims = {}
        self.prepared_publications = []
        self._pipeline_cleanup_attempted = False

    def matchInputFingerprint(self, category: str, identity_key: str, rows: list[dict]) -> str:
        evidence = []
        for row in rows:
            evidence.append({
                "title": self.clean_str(row.get("english_title")).strip(),
                "normalized_title": self.normalizeTitle(row.get("english_title")),
                "release_year": self.clean_int(row.get("release_year")),
                "directed_by": self.clean_str(row.get("directed_by")).strip().casefold(),
                "runtime": self.clean_int(row.get("runtime")),
                "cinema": self.clean_str(row.get("cinema")).strip(),
                "city": self.clean_str(row.get("screening_city")).strip(),
                "source": self.clean_str(row.get("_checkpoint_source")).strip(),
            })
        evidence.sort(key=lambda item: json.dumps(item, ensure_ascii=False, sort_keys=True))
        fixes = getattr(self, "helper_table_rows", []) or []
        skips = getattr(self, "helper_table_2_rows", []) or []
        helper_evidence = {
            "fixes": sorted(
                (
                    self.clean_str(row.get("title_fix")).strip(),
                    str(self.clean_int(row.get("tmdb_id")) or ""),
                )
                for row in fixes
            ),
            "skips": sorted(self.clean_str(row.get("name_or_tmdb_id")).strip().casefold() for row in skips),
        }
        return stable_fingerprint({
            "policy_version": MATCHING_POLICY_VERSION,
            "category": category,
            "identity_key": identity_key,
            "evidence": evidence,
            "helper_evidence": helper_evidence,
        })

    def matchIdentityHash(self, category: str, identity_key: str) -> str:
        return stable_fingerprint([category, identity_key])

    def loadMatchDecisionCache(self, category: str, identities: dict[str, str]) -> None:
        """Load current reusable decisions in bounded PostgREST requests."""
        self._match_decision_cache = {}
        identity_by_hash = {self.matchIdentityHash(category, key): key for key in identities}
        identity_hashes = list(identity_by_hash)
        now = datetime.now(timezone.utc).isoformat()
        for start in range(0, len(identity_hashes), CHECKPOINT_QUERY_BATCH_SIZE):
            chunk = identity_hashes[start : start + CHECKPOINT_QUERY_BATCH_SIZE]
            rows = self.supabase.table("pipeline_match_checkpoints").select(
                "category,identity_hash,input_fingerprint,decision,tmdb_id,imdb_id,match_path,alt_options,reason,run_id,expires_at,created_at"
            ).eq("category", category).in_("identity_hash", chunk).in_(
                "decision", ["matched", "intentional_skip"]
            ).gt("expires_at", now).order("run_id", desc=True).order("created_at", desc=True).execute().data or []
            for row in rows:
                identity_key = identity_by_hash.get(row.get("identity_hash"))
                if not identity_key:
                    continue
                cache_key = (identity_key, row.get("input_fingerprint"))
                self._match_decision_cache.setdefault(cache_key, row)

    def reusableMatchDecision(self, category: str, identity_key: str, fingerprint: str):
        return self._match_decision_cache.get((identity_key, fingerprint))

    def recordMatchDecision(
        self,
        category: str,
        identity_key: str,
        fingerprint: str,
        decision: str,
        *,
        tmdb_id=None,
        imdb_id=None,
        match_path=None,
        alt_options=None,
        reason=None,
    ) -> None:
        if decision not in {"matched", "intentional_skip", "retryable_failure"}:
            raise ValueError(f"Unsupported match checkpoint decision: {decision}")
        ttl = timedelta(hours=RETRY_DIAGNOSTIC_TTL_HOURS) if decision == "retryable_failure" else timedelta(days=MATCH_DECISION_TTL_DAYS)
        row = {
            "category": category,
            "identity_key": identity_key,
            "identity_hash": self.matchIdentityHash(category, identity_key),
            "input_fingerprint": fingerprint,
            "matching_policy_version": MATCHING_POLICY_VERSION,
            "decision": decision,
            "tmdb_id": self.clean_int(tmdb_id),
            "imdb_id": self.clean_str(imdb_id).strip() or None,
            "match_path": self.clean_str(match_path).strip() or None,
            "alt_options": alt_options if isinstance(alt_options, list) else [],
            "reason": self.clean_str(reason).strip()[:100] or None,
            "run_id": self.clean_int(getattr(self, "run_id", None)),
            "expires_at": (datetime.now(timezone.utc) + ttl).isoformat(),
        }
        self._pending_match_checkpoints.append(row)
        if decision in {"matched", "intentional_skip"}:
            self._match_decision_cache[(identity_key, fingerprint)] = row
            # Persist completed decisions before the next title can stall or the
            # process deadline can terminate the run.
            self.flushMatchDecisionCheckpoints()
        if len(self._pending_match_checkpoints) >= CHECKPOINT_INSERT_BATCH_SIZE:
            self.flushMatchDecisionCheckpoints()

    def flushMatchDecisionCheckpoints(self) -> None:
        if not self._pending_match_checkpoints:
            return
        rows, self._pending_match_checkpoints = self._pending_match_checkpoints, []
        self.supabase.table("pipeline_match_checkpoints").insert(rows).execute()

    def latestReusableDecisionForIdentity(self, category: str, identity_key: str):
        identity_hash = self.matchIdentityHash(category, identity_key)
        rows = self.supabase.table("pipeline_match_checkpoints").select(
            "decision,tmdb_id,run_id,expires_at"
        ).eq("category", category).eq("identity_hash", identity_hash).eq("decision", "matched").gt(
            "expires_at", datetime.now(timezone.utc).isoformat()
        ).order("run_id", desc=True).order("created_at", desc=True).limit(1).execute().data or []
        return rows[0] if rows else None

    def snapshotInputFingerprint(self, category: str, snapshot_id: str, rows: list[dict], identity_fingerprints: list[str]) -> str:
        return stable_fingerprint({
            "policy_version": MATCHING_POLICY_VERSION,
            "category": category,
            "snapshot_id": snapshot_id,
            "rows": sorted(
                ([
                    self.clean_str(row.get("english_title")).strip(),
                    self.clean_int(row.get("release_year")),
                    self.clean_str(row.get("directed_by")).strip().casefold(),
                    self.clean_int(row.get("runtime")),
                    self.clean_str(row.get("screening_city")).strip(),
                    self.clean_date(row.get("date_of_showing")),
                    self.clean_str(row.get("showtime")).strip(),
                    self.clean_str(row.get("english_href")).strip(),
                    self.clean_str(row.get("hebrew_href")).strip(),
                ] for row in rows),
                key=lambda item: json.dumps(item, ensure_ascii=False, sort_keys=True),
            ),
            "group_fingerprints": sorted(identity_fingerprints),
            "helper_fingerprint": self.matchInputFingerprint(category, "helpers", rows[:0]),
        })

    def loadLatestScrapeSnapshots(self, table_name: str) -> dict[str, dict]:
        """Return the newest attempt per source, including a failed latest attempt.

        A failed/running newer scrape must fence off an older complete snapshot;
        otherwise replaying that old snapshot could delete screenings using stale
        source data.
        """
        manifests = self.selectAll("pipeline_scrape_snapshots")
        latest = {}
        for manifest in manifests:
            if manifest.get("table_name") != table_name:
                continue
            cinema = self.clean_str(manifest.get("cinema")).strip()
            if not cinema:
                continue
            key = (self.clean_int(manifest.get("run_id")) or -1, self.clean_int(manifest.get("attempt")) or 0, self.clean_str(manifest.get("started_at")))
            current = latest.get(cinema)
            current_key = current[0] if current else None
            if current is None or key > current_key:
                latest[cinema] = (key, manifest)
        return {cinema: item[1] for cinema, item in latest.items()}

    def selectLatestRawSnapshots(self, table_name: str, rows: list[dict]):
        """Use only completed, isolated attempts; legacy data stays non-authoritative."""
        latest_manifests = self.loadLatestScrapeSnapshots(table_name)
        manifest_scopes = set(latest_manifests)
        rows_by_snapshot = {}
        legacy_by_cinema = {}
        for row in rows:
            snapshot_id = self.clean_str(row.get("snapshot_id")).strip()
            cinema = self.clean_str(row.get("cinema")).strip()
            if snapshot_id:
                rows_by_snapshot.setdefault(snapshot_id, []).append(row)
            elif cinema:
                run_id = self.clean_int(row.get("run_id")) or -1
                current = legacy_by_cinema.get(cinema)
                if current is None or run_id > current[0]:
                    legacy_by_cinema[cinema] = (run_id, [row])
                elif run_id == current[0]:
                    current[1].append(row)

        rows_by_cinema = {}
        snapshot_ids_by_cinema = {}
        legacy_cinemas = set()
        usable_manifests = {}
        for cinema, manifest in latest_manifests.items():
            if manifest.get("status") != "complete":
                self.trace_note(f"snapshot_not_complete | cinema={cinema} | status={manifest.get('status')}")
                continue
            snapshot_id = self.clean_str(manifest.get("snapshot_id")).strip()
            snapshot_rows = rows_by_snapshot.get(snapshot_id, [])
            expected_count = self.clean_int(manifest.get("row_count")) or 0
            if expected_count != len(snapshot_rows):
                self.trace_note(f"snapshot_manifest_mismatch | cinema={cinema} | snapshot_id={snapshot_id}")
                continue
            usable_manifests[cinema] = manifest
            rows_by_cinema[cinema] = snapshot_rows
            snapshot_ids_by_cinema[cinema] = snapshot_id
            source = self.clean_str(manifest.get("source_name")).strip() or cinema
            for row in snapshot_rows:
                row["_checkpoint_source"] = source

        for cinema, (_run_id, snapshot_rows) in legacy_by_cinema.items():
            if cinema in manifest_scopes or all(row.get("added") is True for row in snapshot_rows):
                continue
            rows_by_cinema[cinema] = snapshot_rows
            legacy_cinemas.add(cinema)
            for row in snapshot_rows:
                row["_checkpoint_source"] = f"legacy:{cinema}"

        manifests = usable_manifests
        self.latest_snapshot_manifests_by_cinema = manifests
        self.latest_snapshot_ids_by_cinema = snapshot_ids_by_cinema
        return rows_by_cinema, manifests, snapshot_ids_by_cinema, legacy_cinemas

    def claimSnapshotPublications(
        self,
        category: str,
        manifests_by_cinema: dict[str, dict],
        rows_by_cinema: dict[str, list[dict]],
        group_keys_by_row_id: dict[str, str],
        identity_fingerprints: dict[str, str],
        row_fingerprints_by_id: dict[str, str] | None = None,
    ) -> bool:
        """Claim every unfinished source snapshot together or do no publication."""
        busy = False
        self._publication_set_busy = False
        for cinema, manifest in sorted(manifests_by_cinema.items()):
            snapshot_id = self.clean_str(manifest.get("snapshot_id")).strip()
            if not snapshot_id:
                continue
            fingerprints = []
            for row in rows_by_cinema.get(cinema, []):
                row_id = self.clean_str(row.get("id"))
                if row_fingerprints_by_id and row_id in row_fingerprints_by_id:
                    fingerprints.append(row_fingerprints_by_id[row_id])
                    continue
                identity_key = group_keys_by_row_id.get(row_id)
                if identity_key in identity_fingerprints:
                    fingerprints.append(identity_fingerprints[identity_key])
            fingerprint = self.snapshotInputFingerprint(
                category,
                snapshot_id,
                rows_by_cinema.get(cinema, []),
                fingerprints,
            )
            result = self.claimSnapshotPublication(category, snapshot_id, fingerprint, cinema=cinema)
            if result.get("state") == "owned_by_active_run":
                busy = True
        if busy:
            self._publication_set_busy = True
            self.releasePublicationClaims(reason="another active run owns a source snapshot")
            return False
        return bool(self._publication_claims)

    def claimSnapshotPublication(self, category: str, snapshot_id: str, input_fingerprint: str, *, cinema: str) -> dict:
        result = self.supabase.rpc("claim_pipeline_publication_checkpoint", {
            "p_category": category,
            "p_cinema": cinema,
            "p_snapshot_id": snapshot_id,
            "p_input_fingerprint": input_fingerprint,
            "p_run_id": int(self.run_id),
            "p_owner_token": self._publication_owner_token,
        }).execute().data
        if isinstance(result, list) and result:
            result = result[0]
        if not isinstance(result, dict):
            raise RuntimeError("Publication checkpoint claim returned an invalid response")
        if result.get("claimed"):
            self._publication_claims[snapshot_id] = {
                "category": category,
                "cinema": cinema,
                "input_fingerprint": input_fingerprint,
                "generation": int(result["generation"]),
                "phase": result.get("phase") or "in_progress",
            }
        return result

    PUBLICATION_PHASE_ORDER = {
        "in_progress": 0,
        "prepared": 1,
        "screenings_written": 2,
        "movies_written": 3,
        "stale_rows_deleted": 4,
        "published": 5,
    }

    def snapshotPublicationReached(self, snapshot_id: str, phase: str) -> bool:
        claim = self._publication_claims.get(snapshot_id)
        return bool(claim and self.PUBLICATION_PHASE_ORDER.get(claim.get("phase"), 0) >= self.PUBLICATION_PHASE_ORDER[phase])

    def assertSnapshotPublicationOwnership(self, snapshot_ids=None) -> None:
        """Fail before writes when a newer attempt has taken over this source."""
        ids = list(snapshot_ids) if snapshot_ids is not None else list(self._publication_claims)
        for snapshot_id in ids:
            claim = self._publication_claims.get(snapshot_id)
            if not claim:
                continue
            result = self.supabase.rpc("assert_pipeline_publication_ownership", {
                "p_category": claim["category"],
                "p_cinema": claim["cinema"],
                "p_snapshot_id": snapshot_id,
                "p_input_fingerprint": claim["input_fingerprint"],
                "p_owner_token": self._publication_owner_token,
                "p_generation": claim["generation"],
            }).execute().data
            if result not in (True, [True], [{"assert_pipeline_publication_ownership": True}]):
                raise RuntimeError("Publication checkpoint ownership changed before a database write")

    def advanceSnapshotPublication(self, snapshot_id: str, phase: str, *, has_unresolved: bool = False) -> None:
        claim = self._publication_claims[snapshot_id]
        if self.PUBLICATION_PHASE_ORDER[phase] < self.PUBLICATION_PHASE_ORDER.get(claim.get("phase"), 0):
            return
        result = self.supabase.rpc("advance_pipeline_publication_checkpoint", {
            "p_category": claim["category"],
            "p_cinema": claim["cinema"],
            "p_snapshot_id": snapshot_id,
            "p_input_fingerprint": claim["input_fingerprint"],
            "p_owner_token": self._publication_owner_token,
            "p_generation": claim["generation"],
            "p_phase": phase,
            "p_has_unresolved": bool(has_unresolved),
        }).execute().data
        if result not in (True, [True], [{"advance_pipeline_publication_checkpoint": True}]):
            raise RuntimeError(f"Publication checkpoint ownership changed before {phase}")
        claim["phase"] = phase

    def releasePublicationClaims(self, *, reason: str | None = None) -> None:
        for snapshot_id, claim in list(self._publication_claims.items()):
            try:
                self.supabase.rpc("release_pipeline_publication_checkpoint", {
                    "p_category": claim["category"],
                    "p_cinema": claim["cinema"],
                    "p_snapshot_id": snapshot_id,
                    "p_input_fingerprint": claim["input_fingerprint"],
                    "p_owner_token": self._publication_owner_token,
                    "p_generation": claim["generation"],
                    "p_reason": self.clean_str(reason).strip()[:100] or None,
                }).execute()
            except Exception:
                pass
        self._publication_claims.clear()
        if not self._pipeline_cleanup_attempted:
            self._pipeline_cleanup_attempted = True
            try:
                self.supabase.rpc("cleanup_pipeline_reliability_state", {"p_limit": 250}).execute()
            except Exception:
                pass
