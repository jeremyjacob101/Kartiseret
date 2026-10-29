"""Resumable source snapshot publication state."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json


MATCHING_POLICY_VERSION = 2


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
        self._publication_claims = {}
        self.prepared_publications = []

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
        return self._latestScrapeSnapshots(table_name, self.selectAll("pipeline_scrape_snapshots"))

    def _scrapeSnapshotOrder(self, manifest: dict) -> tuple:
        return (
            self.clean_int(manifest.get("run_id")) or -1,
            self.clean_int(manifest.get("attempt")) or 0,
            self.clean_str(manifest.get("started_at")),
        )

    def _latestScrapeSnapshots(self, table_name: str, manifests: list[dict]) -> dict[str, dict]:
        latest = {}
        for manifest in manifests:
            if manifest.get("table_name") != table_name:
                continue
            cinema = self.clean_str(manifest.get("cinema")).strip()
            if not cinema:
                continue
            key = self._scrapeSnapshotOrder(manifest)
            current = latest.get(cinema)
            current_key = current[0] if current else None
            if current is None or key > current_key:
                latest[cinema] = (key, manifest)
        return {cinema: item[1] for cinema, item in latest.items()}

    def rawRowsForCleaning(self, table_name: str, rows: list[dict]) -> list[dict]:
        """Avoid rewriting replaced failed attempts during a selected mapping run.

        Pending flags alone never prove that a row is disposable. Keep legacy,
        unknown, complete, running, and still-current failed snapshots eligible.
        Only an explicitly failed attempt with a newer, complete, count-matched
        replacement from the same source can be excluded. This changes neither
        stored rows/flags nor the mapper's existing snapshot eligibility rules.
        Clean-only and direct Clean runs retain their full historical scope.
        """
        context = getattr(self, "_shared_request_context", None)
        if table_name not in getattr(context, "selected_mapping_tables", ()):
            return rows

        manifests = self.selectAll("pipeline_scrape_snapshots")
        latest = self._latestScrapeSnapshots(table_name, manifests)
        known = {
            self.clean_str(manifest.get("snapshot_id")).strip(): manifest
            for manifest in manifests
            if manifest.get("table_name") == table_name and manifest.get("snapshot_id")
        }
        rows_by_snapshot = {}
        for row in rows:
            snapshot_id = self.clean_str(row.get("snapshot_id")).strip()
            if snapshot_id:
                rows_by_snapshot.setdefault(snapshot_id, []).append(row)

        replacements = {}
        for cinema, manifest in latest.items():
            snapshot_id = self.clean_str(manifest.get("snapshot_id")).strip()
            expected = self.clean_int(manifest.get("row_count"))
            snapshot_rows = rows_by_snapshot.get(snapshot_id, [])
            if (
                manifest.get("status") == "complete"
                and snapshot_id
                and self.clean_str(manifest.get("source_name")).strip()
                and expected is not None
                and expected >= 0
                and expected == len(snapshot_rows)
                and all(self.clean_str(row.get("cinema")).strip() == cinema for row in snapshot_rows)
            ):
                replacements[cinema] = manifest

        # Prove replacement once per attempt, rather than repeating manifest
        # comparisons for every raw row in a large failed scrape backlog.
        replaced_failed = {}
        for snapshot_id, original in known.items():
            cinema = self.clean_str(original.get("cinema")).strip()
            replacement = replacements.get(cinema)
            if (
                replacement is not None
                and original.get("status") == "failed"
                and self.clean_str(original.get("source_name")).strip()
                == self.clean_str(replacement.get("source_name")).strip()
                and self._scrapeSnapshotOrder(original) < self._scrapeSnapshotOrder(replacement)
            ):
                replaced_failed[snapshot_id] = cinema
        selected = [
            row for row in rows
            if replaced_failed.get(self.clean_str(row.get("snapshot_id")).strip())
            != self.clean_str(row.get("cinema")).strip()
        ]
        self.trace_note(
            f"cleaning_scope | table={table_name} | rows={len(rows)} | selected={len(selected)}"
            f" | replaced_failed={len(rows) - len(selected)}"
        )
        return selected

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
        """Start or resume each complete source snapshot's publication checkpoint."""
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
            self.claimSnapshotPublication(category, snapshot_id, fingerprint, cinema=cinema)
        return bool(self._publication_claims)

    def claimSnapshotPublication(self, category: str, snapshot_id: str, input_fingerprint: str, *, cinema: str) -> dict:
        result = self.supabase.rpc("claim_pipeline_publication_checkpoint", {
            "p_category": category,
            "p_cinema": cinema,
            "p_snapshot_id": snapshot_id,
            "p_input_fingerprint": input_fingerprint,
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

    def advanceSnapshotPublication(self, snapshot_id: str, phase: str, *, has_unresolved: bool = False) -> None:
        claim = self._publication_claims[snapshot_id]
        if self.PUBLICATION_PHASE_ORDER[phase] < self.PUBLICATION_PHASE_ORDER.get(claim.get("phase"), 0):
            return
        result = self.supabase.rpc("advance_pipeline_publication_checkpoint", {
            "p_category": claim["category"],
            "p_cinema": claim["cinema"],
            "p_snapshot_id": snapshot_id,
            "p_input_fingerprint": claim["input_fingerprint"],
            "p_phase": phase,
            "p_has_unresolved": bool(has_unresolved),
        }).execute().data
        if result not in (True, [True], [{"advance_pipeline_publication_checkpoint": True}]):
            raise RuntimeError(f"Publication checkpoint could not advance to {phase}")
        claim["phase"] = phase
