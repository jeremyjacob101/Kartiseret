from datetime import date
import re, unicodedata


class ComingSoonsHelpers:
    def _soon_release_date_or_min(self, row: dict):
        try:
            raw = row.get("release_date") if isinstance(row, dict) else None
            return self.dateToDate(raw) if raw else date.min
        except Exception:
            return date.min

    def _soon_created_at_timestamp(self, row: dict) -> float:
        try:
            raw = row.get("created_at") if isinstance(row, dict) else None
            if not raw:
                return float("-inf")
            return self.datetimeToDatetime(raw).timestamp()
        except Exception:
            return float("-inf")

    def comingSoonsFreshnessPreferKey(self, row: dict):
        # Prefer rows whose release date has not passed yet. Then prefer the latest
        # release date to handle source-side pushbacks (e.g. 2026-05-14 -> 2026-05-28).
        d_key = self._soon_release_date_or_min(row)
        is_upcoming = 1 if d_key >= date.today() else 0
        runtime = row.get("runtime")
        good_runtime = (runtime is not None) and (runtime not in getattr(self, "fake_runtimes", set()))
        has_release_year = bool(row.get("release_year"))
        has_directed_by = bool((row.get("directed_by") or "").strip())
        run_id = self.clean_int(row.get("run_id")) if isinstance(row, dict) else None

        return (
            is_upcoming,
            d_key,
            1 if has_directed_by else 0,
            1 if good_runtime else 0,
            1 if has_release_year else 0,
            run_id if run_id is not None else -1,
            self._soon_created_at_timestamp(row),
        )

    def choosePreferredComingSoonRow(self, rows: list[dict]) -> dict:
        return max(rows, key=self.comingSoonsFreshnessPreferKey)

    def comingSoonsFinalDedupeSortKey(self, row):
        d_key = self._soon_release_date_or_min(row)

        heb = (row.get("hebrew_title") or "").strip()
        has_hebrew = bool(heb) and heb.lower() != "null"

        return (
            d_key,
            1 if has_hebrew else 0,
        )

    def comingSoonsFinalDedupeSortKey2(self, row: dict):
        rd = self.dateToDate(row["release_date"])
        ca_dt = self.datetimeToDatetime(row["created_at"])
        return (rd, -ca_dt.timestamp())

    def reset_soon_row_state(self):
        self.potential_chosen_id = None

        self.english_title = None
        self.hebrew_title = None
        self.release_date = None
        self.release_year = None
        self.directed_by = None
        self.runtime = None

        self.first_search_result = None
        self.found_year_match = False
        self.candidates = []
        self.details = {}

        self.seen_already = set()
        self.search_plans = []

    def load_soon_row(self, row: dict):
        self.english_title = self.clean_str(row.get("english_title"))
        self.hebrew_title = self.clean_str(row.get("hebrew_title"))
        self.release_date = self.clean_date(row.get("release_date"))
        self.release_year = self.clean_int(row.get("release_year"))
        self.directed_by = self.clean_str(row.get("directed_by"))
        self.runtime = self.clean_int(row.get("runtime"))

    def canonicalize_title(self, title):
        if not title:
            return ""

        t = unicodedata.normalize("NFKC", title.lower().strip())
        t = re.sub(r":\s*הסרט$", "", t)
        t = t.replace("-", " ")
        t = re.sub(r"\s+", " ", t).strip()
        t = re.sub(r"[^\w\s\u0590-\u05FF]", "", t)
        t = re.sub(r"\bשנים\b", "שנה", t)
        t = t.replace(" ", "")

        return t

    def levenshtein_distance(self, a, b, max_distance=1):
        if a == b:
            return 0

        if abs(len(a) - len(b)) > max_distance:
            return max_distance + 1

        if len(a) == len(b):
            diffs = [i for i in range(len(a)) if a[i] != b[i]]
            if len(diffs) == 2:
                i, j = diffs
                if j == i + 1 and a[i] == b[j] and a[j] == b[i]:
                    return 1

        prev = list(range(len(b) + 1))
        for i, ca in enumerate(a, 1):
            curr = [i]
            min_row = i
            for j, cb in enumerate(b, 1):
                cost = 0 if ca == cb else 1
                insert_cost = curr[j - 1] + 1
                delete_cost = prev[j] + 1
                replace_cost = prev[j - 1] + cost
                val = min(insert_cost, delete_cost, replace_cost)
                curr.append(val)
                min_row = min(min_row, val)
            if min_row > max_distance:
                return max_distance + 1
            prev = curr

        return prev[-1]

    def fuzzy_key(self, title, cache=None):
        canonical = self.canonicalize_title(title)
        if cache is None:
            return canonical
        if canonical in cache:
            return cache[canonical]

        for k in cache.keys():
            if self.levenshtein_distance(canonical, k, max_distance=1) <= 1:
                cache[canonical] = k
                return k

        cache[canonical] = canonical
        return canonical
