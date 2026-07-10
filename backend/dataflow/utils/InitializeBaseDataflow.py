from collections import defaultdict
from supabase import create_client
from selenium import webdriver
import time, os

runningGithubActions = os.environ.get("GITHUB_ACTIONS") == "true"


def setUpSupabase(self):
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    self.supabase = create_client(url, key)


def setUpTmdb(self):
    self.TMDB_API_KEY = os.environ.get("TMDB_API_KEY")

def build_chrome(headless: bool = True):
    options = webdriver.ChromeOptions()
    if headless:
        options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument(f"--window-size=1920,1080")
    options.add_argument("user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.92 Safari/537.36")
    # options.add_argument(f"user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.0 Safari/537.36")
    return webdriver.Chrome(options=options)

def logSuccessfulRun(self) -> None:
    if runningGithubActions:
        return

    # Solo-update watcher runs intentionally skip utilAvgTime machine stats.
    if str(os.environ.get("SOLO_UPDATE_ONLY", "")).strip().lower() in {"1", "true", "yes", "on"}:
        return

    runner_machine = os.environ.get("RUNNER_MACHINE")
    if not runner_machine:
        return

    duration_seconds = time.perf_counter() - self.startTime
    avg_time_col, num_runs_col = "avg_time_" + str(runner_machine), "num_runs_" + str(runner_machine)

    resp = self.supabase.table("utilAvgTime").select(f"{avg_time_col},{num_runs_col}").eq("name", self.__class__.__name__).limit(1).execute()
    row = resp.data[0]
    old_avg = float(row.get(avg_time_col) or 0.0)
    n = int(row.get(num_runs_col) or 0)
    new_avg = (old_avg * n + float(duration_seconds)) / (n + 1)
    update_payload = {avg_time_col: float(new_avg), num_runs_col: n + 1}

    self.supabase.table("utilAvgTime").update(update_payload).eq("name", self.__class__.__name__).eq(num_runs_col, n).execute()


class InitializeBaseDataflow:
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.reset_soon_row_state()
        self.reset_np_main_row_state()
        self.reset_np_groupkey_row_state()

        self.startTime = time.perf_counter()
        self.init_dataflow_summary_state()

        self.requests_headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari", "Accept-Language": "en-US,en;q=0.9", "Accept-Encoding": "gzip, deflate", "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Upgrade-Insecure-Requests": "1"}

        self.non_deduplicated_updates = []
        self.non_enriched_updates = []
        self.visited_already = set()
        self.delete_these = []
        self.updates = []
        self.PRIMARY_KEY = "id"
        self.potential_chosen_id = None

        self.first_search_result = None
        self.found_year_match = False
        self.candidates = []
        self.details = {}
        self.chosen_path = None
        self.alt_options = []
        self.unhealthy_cinemas = set()

        self.general_focused_page = 1
        self.year_focused_page = 1
        self.search_plans = []
        self.processed_ids = set()
        self.seen_already = set()
        self.skip_tokens = set()

        self.title_counts_by_key = defaultdict(lambda: defaultdict(int))
        self.grouped_rows_by_key = defaultdict(list)
        self.date_of_showing = None
        self.tmdb_fix_by_title = {}
        self.tmdb_fix_ids = set()
        self.tmdb_fix_alias_by_tmdb = {}
        self.override_tmdb = None
        self.movies_by_tmdb = {}
        self.parsed_year = None
        self.year_counts = {}
        self.meta_by_key = {}
        self.key_result = {}

        self.existing_final_ids_by_cinema = defaultdict(set)
        self.new_final_ids_by_cinema = defaultdict(set)
        self.latest_rows_by_cinema = defaultdict(list)
        self.updates_by_cinema = defaultdict(list)
        self.latest_run_id_by_cinema = {}
        self.latest_snapshot_rows = []

        self.fake_runtimes = [0, 30, 40, 45, 60, 90, 100, 120, 130, 150, 180, 200, 240, 250, 300]
