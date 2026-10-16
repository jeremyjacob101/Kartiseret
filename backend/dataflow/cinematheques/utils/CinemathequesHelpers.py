import os

from backend.dataflow.utils.InitializeBaseDataflow import logSuccessfulRun, runningGithubActions
from backend.dataflow.utils.SupabaseTables import SupabaseTables


class CinemathequesHelpers:
    PRIMARY_KEY_BY_TABLE = {
        **SupabaseTables.PRIMARY_KEY_BY_TABLE,
        "allTheques": "id",
        "finalTheques": "id",
        "finalThequeMovies": "tmdb_id",
    }

    def ensureCinemathequeTimingRow(self):
        if runningGithubActions:
            return
        if str(os.environ.get("SOLO_UPDATE_ONLY", "")).strip().lower() in {"1", "true", "yes", "on"}:
            return

        runner_machine = os.environ.get("RUNNER_MACHINE")
        if not runner_machine:
            return

        rows = self.supabase.table("utilAvgTime").select("name").eq("name", self.__class__.__name__).limit(1).execute().data or []
        if not rows:
            self.supabase.table("utilAvgTime").insert({"name": self.__class__.__name__, "type": "dataflow"}).execute()

    def dataRun(self):
        try:
            self.logic()
            self.ensureCinemathequeTimingRow()
            logSuccessfulRun(self)
            self.flush_summary(successful=True)
        except Exception:
            self.flush_summary(successful=False)
            raise
        finally:
            self.releasePublicationClaims()
            self.closeDataflowRequests()

    def _all_theque_key(self, row: dict) -> tuple:
        # Raw history is deduplicated only inside a scraper snapshot. Including
        # run_id deliberately preserves the same screening across later runs.
        return (self.clean_str(row.get("snapshot_id")).strip(), self.clean_int(row.get("run_id")), *self._showtime_key(row))

    def dedupeAllTheques(self, table_name: str, refresh: bool = True):
        self._dedupe_by_key(
            table_name=table_name,
            key_func=self._all_theque_key,
            prefer_key=self._showtime_prefer_key,
            refresh=refresh,
        )

    def dedupeFinalTheques(self, table_name: str, refresh: bool = True):
        self.dedupeFinalShowtimes(table_name, refresh=refresh)

    def buildFinalThequeScreeningRow(self, row):
        new_row = dict(row)
        runtime = self.clean_int(new_row.get("runtime"))
        new_row["runtime"] = runtime if runtime is not None and runtime > 0 else None
        return new_row

    def buildFinalThequeMovieRow(self, tmdb_id, res):
        runtime = self.clean_int(res.get("runtime"))
        if runtime is not None and runtime <= 0:
            runtime = None

        return {
            "tmdb_id": self.clean_int(tmdb_id),
            "english_title": self.clean_str(res.get("english_title")).strip(),
            "hebrew_title": self.clean_str(res.get("hebrew_title")).strip() or None,
            "release_year": self.clean_int(res.get("release_year")),
            "runtime": runtime,
            "popularity": self.clean_float(res.get("popularity")),
            "imdb_id": self.clean_str(res.get("imdb_id")).strip() or None,
            "genres": self.clean_array(res.get("genres")),
            "en_poster": self.clean_str(res.get("en_poster")).strip() or None,
            "en_trailer": self.clean_str(res.get("en_trailer")).strip() or None,
            "backdrop": self.clean_str(res.get("backdrop")).strip() or None,
            "alt_options": res.get("alt_options") if isinstance(res.get("alt_options"), list) else [],
        }

    def normalizeUpdateRuntime(self, result):
        if not isinstance(result, dict):
            return result
        runtime = self.clean_int(result.get("runtime"))
        result["runtime"] = runtime if runtime is not None and runtime > 0 else None
        return result
