from backend.scraping.utils.InitializeBaseCinema import InitializeBaseCinema, build_chrome, setUpSupabase, navigate, logSuccessfulRun
from backend.scraping.utils.FormatAndAppend import AppendToInfo, formatAndUpload, formatAndWriteCsv
from backend.scraping.utils.ScrapedFixes import ScrapedFixes
from backend.scraping.utils.ScrapingHelpers import ScrapingHelpers
from datetime import datetime, timezone
import uuid


class BaseCinema(ScrapingHelpers, ScrapedFixes, InitializeBaseCinema, AppendToInfo):
    CINEMA_NAME: str
    SCREENING_CITY: str
    URL: str
    HEADLESS: bool = True

    def __init__(self, cinema_type, supabase_table_name, run_id, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.driver = build_chrome(self.HEADLESS)
        self.cinema_type = cinema_type
        self.supabase_table_name = supabase_table_name
        self.run_id = run_id
        self.snapshot_id = str(uuid.uuid4())
        self._empty_snapshot_evidence = None
        self._snapshot_manifest_started = False

        setUpSupabase(self)

    def confirmEmptySnapshot(self, evidence: str):
        evidence = str(evidence or "").strip()
        if not evidence:
            raise ValueError("An empty scrape requires explicit source evidence")
        self._empty_snapshot_evidence = evidence[:100]

    def startScrapeSnapshot(self):
        # A scraper object may be reused for a retry in the same run. Every
        # invocation must have a distinct manifest and empty-result evidence
        # must describe this attempt only.
        self.snapshot_id = str(uuid.uuid4())
        self._snapshot_manifest_started = False
        self._empty_snapshot_evidence = None
        self._snapshot_row_count = 0
        self.supabase.table("pipeline_scrape_snapshots").insert({
            "snapshot_id": self.snapshot_id,
            "run_id": int(self.run_id),
            "attempt": max(1, int(getattr(self, "_artifact_attempt", 1) or 1)),
            "table_name": self.supabase_table_name,
            "source_name": self.__class__.__name__,
            "cinema": self.CINEMA_NAME,
            "status": "running",
            "row_count": 0,
        }).execute()
        self._snapshot_manifest_started = True

    def finishScrapeSnapshot(self, row_count: int):
        result = self.supabase.table("pipeline_scrape_snapshots").update({
            "status": "complete",
            "row_count": int(row_count),
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "failure_reason": None,
        }).eq("snapshot_id", self.snapshot_id).select("snapshot_id").execute()
        if not (result.data or []):
            raise RuntimeError(f"Scrape snapshot manifest was not finalized: {self.snapshot_id}")

    def failScrapeSnapshot(self, error: Exception):
        if not getattr(self, "_snapshot_manifest_started", False):
            return
        try:
            self.supabase.table("pipeline_scrape_snapshots").update({
                "status": "failed",
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "failure_reason": type(error).__name__[:100],
            }).eq("snapshot_id", self.snapshot_id).eq("status", "running").execute()
        except Exception:
            pass

    def logic(self):
        raise NotImplementedError("Each cinema must implement its own logic()")

    def scrape(self):
        try:
            self.startScrapeSnapshot()
            navigate(self)
            self.logic()
            formatAndUpload(self)
            self.finishScrapeSnapshot(getattr(self, "_snapshot_row_count", 0))
            logSuccessfulRun(self)
            formatAndWriteCsv(self, successful=True)
        except Exception as error:
            self.failScrapeSnapshot(error)
            formatAndWriteCsv(self, successful=False)
            raise
