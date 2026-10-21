from backend.dataflow.utils.SupabaseTables import SupabaseTables
from backend.dataflow.utils.MovieCodes import MovieCodes
from backend.dataflow.utils.DataflowHelpers import DataflowHelpers
from backend.dataflow.utils.DataflowRequests import DataflowRequests
from backend.dataflow.utils.PipelineCheckpoints import PipelineCheckpoints
from backend.dataflow.utils.ImdbRatings import ImdbRatings
from backend.dataflow.utils.DataflowSummaryHelpers import DataflowSummaryHelpers
from backend.scraping.utils.ScrapingHelpers import ScrapingHelpers
from backend.scraping.utils.InitializeBaseCinema import build_chrome
from backend.dataflow.utils.InitializeBaseDataflow import InitializeBaseDataflow, setUpSupabase, setUpTmdb, logSuccessfulRun
from backend.dataflow.comingsoons.utils.ComingSoonsHelpers import ComingSoonsHelpers
from backend.dataflow.nowplayings.utils.NowPlayingsHelpers import NowPlayingsHelpers
from backend.dataflow.utils.PublicationWorkspace import publication_scope
import os


class BaseDataflow(PipelineCheckpoints, InitializeBaseDataflow, DataflowRequests, ImdbRatings, DataflowSummaryHelpers, DataflowHelpers, SupabaseTables, MovieCodes, ComingSoonsHelpers, NowPlayingsHelpers, ScrapingHelpers):
    MAIN_TABLE_NAME: str = ""
    DUPLICATE_TABLE_NAME: str = ""
    MOVING_TO_TABLE_NAME: str = ""
    MOVING_TO_TABLE_NAME_2: str = ""
    HELPER_TABLE_NAME: str = ""
    HELPER_TABLE_NAME_2: str = ""
    HELPER_TABLE_NAME_3: str = ""
    HELPER_TABLE_NAME_4: str = ""
    HEADLESS: bool = True
    USES_BROWSER: bool = False

    def __init__(self, run_id, *args, request_context=None, **kwargs):
        self._shared_request_context = request_context
        super().__init__(*args, **kwargs)
        self.run_id = run_id
        self.solo_update_only = str(os.environ.get("SOLO_UPDATE_ONLY", "")).strip().lower() in {"1", "true", "yes", "on"}

        self.driver = build_chrome(self.HEADLESS) if self.USES_BROWSER else None

        setUpSupabase(self)
        setUpTmdb(self)

        self.refreshAllTables()

    def rows_for_update(self) -> list[dict]:
        rows = list(getattr(self, "main_table_rows", []) or [])
        if not self.solo_update_only:
            return rows
        return [row for row in rows if isinstance(row, dict) and bool(row.get("solo_update"))]

    def apply_solo_update_postprocess(self, row: dict) -> dict:
        if self.solo_update_only and isinstance(row, dict):
            row["solo_update"] = False
        return row

    def logic(self):
        raise NotImplementedError("Each dataflow must implement its own logic()")

    def dataRun(self):
        try:
            with publication_scope(getattr(self, "_publication", None)):
                self.logic()
            if getattr(self, "_owns_publication", False):
                self._publication.commit()
            if hasattr(self, "ensureCinemathequeTimingRow"):
                self.ensureCinemathequeTimingRow()
            logSuccessfulRun(self)
            self.flush_summary(successful=True)
        except Exception:
            self.discardPublicationStage()
            self.flush_summary(successful=False)
            raise
        finally:
            self.closeDataflowRequests()

    def finishSharedDataRun(self, successful: bool = True):
        if successful:
            if hasattr(self, "ensureCinemathequeTimingRow"):
                self.ensureCinemathequeTimingRow()
            logSuccessfulRun(self)
        self.flush_summary(successful=successful)

    def discardPublicationStage(self):
        if hasattr(self, "_publication_savepoint"):
            self._publication.restore(self._publication_savepoint)
