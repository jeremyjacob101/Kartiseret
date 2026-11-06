from backend.scraping.utils.InitializeBaseCinema import InitializeBaseCinema, build_chrome, setUpSupabase, navigate, logSuccessfulRun
from backend.scraping.utils.FormatAndAppend import AppendToInfo, formatAndUpload, formatAndWriteCsv, _format_rows_from_gathering_info
from backend.scraping.utils.ScrapedFixes import ScrapedFixes
from backend.scraping.utils.ScrapingHelpers import ScrapingHelpers
from datetime import date, datetime, timezone
import uuid
import logging
import json
import time
from backend.utils.log.cloudflare_storage import CloudflareStorageError, LeaseLostError
from backend.utils.log.r2_budget import R2BudgetError, R2BudgetExceeded


class BaseCinema(ScrapingHelpers, ScrapedFixes, InitializeBaseCinema, AppendToInfo):
    CINEMA_NAME: str
    SCREENING_CITY: str
    URL: str
    HEADLESS: bool = True
    USES_BROWSER: bool = True
    DEFAULT_SCRAPE_MODE = None

    def __init__(self, cinema_type, supabase_table_name, run_id, *args, scrape_mode=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.driver = None
        self.scrape_mode = scrape_mode or self.DEFAULT_SCRAPE_MODE or ("selenium" if self.USES_BROWSER else "auto")
        if self.scrape_mode not in ("selenium", "requests", "auto"):
            raise ValueError(f"Unknown scrape mode: {self.scrape_mode}")
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
        }).eq("snapshot_id", self.snapshot_id).execute()
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

    def selenium_logic(self):
        if not self.USES_BROWSER:
            raise NotImplementedError("No Selenium collector is available")
        return self.logic()

    def requests_logic(self):
        if self.USES_BROWSER:
            raise NotImplementedError("No requests collector is available")
        return self.logic()

    def _collect_selenium(self):
        if self.driver is None:
            self.driver = build_chrome(self.HEADLESS)
        navigate(self)
        self.selenium_logic()

    def _reset_collection(self, initial_attributes):
        # A fallback must not reuse partial rows or source-specific lists.
        for attribute in set(self.__dict__) - initial_attributes:
            delattr(self, attribute)
        start, today, year, month = self.startTime, self.today_date, self.current_year, self.current_month
        timing_weekday = self._timing_weekday
        InitializeBaseCinema.__init__(self)
        self.startTime, self.today_date, self.current_year, self.current_month = start, today, year, month
        self._timing_weekday = timing_weekday
        self._uploaded_scrape_rows = None
        self._empty_snapshot_evidence = None

    def _validate_requests_collection(self):
        columns = self.gathering_info
        if not isinstance(columns, dict) or any(not isinstance(values, list) for values in columns.values()):
            raise ValueError("Requests collector returned invalid columns")
        if len({len(values) for values in columns.values()}) > 1:
            raise ValueError("Requests collector returned unequal column lengths")
        rows, _ = _format_rows_from_gathering_info(self)
        if not rows and not self._empty_snapshot_evidence:
            raise ValueError("Empty collection without confirmed source evidence")
        if self.supabase_table_name == "allSoons":
            for row in rows:
                date.fromisoformat(row.get("release_date") or "")

    def _record_collection(self, transport, started, status, error=None):
        if not getattr(self, '_snapshot_manifest_started', False):
            return
        from backend.utils.log.run_storage import RunArtifactStore

        name = getattr(self, '_artifact_item_name', None) or self.__class__.__name__
        attempt = getattr(self, '_artifact_attempt', None) or 1
        snapshot = getattr(self, 'snapshot_id', None) or 'no-snapshot'
        payload = {
            'scraper': self.__class__.__name__, 'transport': transport, 'status': status,
            'snapshot_id': snapshot, 'attempt': attempt,
            'seconds': time.perf_counter() - started,
            'rows': len(self.gathering_info.get('hebrew_title', [])),
            'requests': getattr(self, '_http_stats', {}).get('requests', 0) if transport == 'requests' else 0,
            'observed_retries': getattr(self, '_http_stats', {}).get('observed_retries', 0) if transport == 'requests' else 0,
            'coverage': getattr(self, '_coverage', {}),
            'failure_type': type(error).__name__ if error else None,
            'failure_reason': str(error)[:500] if error else None,
        }
        # Use main's guarded D1 writer and recovery envelopes. Storage or lease
        # failures must propagate, never start another transport or publication.
        RunArtifactStore().save_text_artifact(
            run_id=int(self.run_id), artifact_type='scrape_transport',
            name=f'{name}-{attempt}-{snapshot}-{transport}.json',
            text=json.dumps(payload, ensure_ascii=False), metadata=payload,
            identity_namespace=snapshot,
        )

    def scrape(self):
        catalog_published = False
        self._uploaded_scrape_rows = None
        try:
            self.startScrapeSnapshot()
            mode = getattr(self, "scrape_mode", "selenium" if self.USES_BROWSER else "requests")
            self._http_stats = {'requests': 0, 'observed_retries': 0}
            self._coverage = {}
            initial_attributes = set(self.__dict__)
            collection_started = time.perf_counter()
            if mode == "selenium":
                try:
                    self._collect_selenium()
                except (LeaseLostError, R2BudgetError, R2BudgetExceeded):
                    raise
                except Exception as error:
                    self._record_collection('selenium', collection_started, 'failed', error)
                    raise
                self._record_collection('selenium', collection_started, 'complete')
            else:
                try:
                    self.requests_logic()
                    self._validate_requests_collection()
                except (CloudflareStorageError, R2BudgetError, R2BudgetExceeded):
                    raise
                except Exception as error:
                    self._record_collection('requests', collection_started, 'failed', error)
                    if mode != "auto":
                        raise
                    logging.getLogger(__name__).warning("Requests collection failed for %s (%s: %s); retrying with Selenium", self.__class__.__name__, type(error).__name__, error)
                    self.failScrapeSnapshot(error)
                    previous_name = getattr(self, "_artifact_item_name", None)
                    self._artifact_item_name = f"{previous_name or self.__class__.__name__}_requests"
                    try:
                        formatAndWriteCsv(self, successful=False)
                    finally:
                        self._artifact_item_name = previous_name
                    self._reset_collection(initial_attributes)
                    self.startScrapeSnapshot()
                    self._coverage = {}
                    fallback_started = time.perf_counter()
                    try:
                        self._collect_selenium()
                    except (LeaseLostError, R2BudgetError, R2BudgetExceeded):
                        raise
                    except Exception as fallback_error:
                        self._record_collection('selenium', fallback_started, 'failed', fallback_error)
                        raise
                    self._record_collection('selenium', fallback_started, 'complete')
                else:
                    self._record_collection('requests', collection_started, 'complete')
            formatAndUpload(self)
            catalog_published = True
            # Persist scrape output after publication so the D1 outcome reflects
            # whether the source rows actually reached Supabase.
            formatAndWriteCsv(self, successful=True)
            self.finishScrapeSnapshot(getattr(self, "_snapshot_row_count", 0))
            logSuccessfulRun(self)
        except Exception as error:
            self.failScrapeSnapshot(error)
            if catalog_published and isinstance(error, CloudflareStorageError):
                raise CloudflareStorageError(
                    "Catalog data was published to Supabase, but storing its scrape rows in D1 failed; "
                    "the run is marked failed and the local recovery copy is retained."
                ) from error
            if not isinstance(error, CloudflareStorageError):
                try:
                    formatAndWriteCsv(self, successful=False)
                except CloudflareStorageError as storage_error:
                    if catalog_published:
                        raise CloudflareStorageError(
                            "Catalog data was published to Supabase, but recording the failed scrape attempt in D1 failed; "
                            "the run is marked failed and the local recovery copy is retained."
                        ) from storage_error
                    raise storage_error from error
            raise
