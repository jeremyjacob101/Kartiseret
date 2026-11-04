import json
from datetime import date


def _format_rows_from_gathering_info(self):
    info = getattr(self, "gathering_info", {})
    if not isinstance(info, dict):
        return [], []

    active_columns = [name for name, values in info.items() if isinstance(values, list) and len(values) > 0]
    max_rows = max((len(info[name]) for name in active_columns), default=0)

    if not active_columns or max_rows == 0:
        return [], []

    rows = []
    for row_index in range(max_rows):
        row_data = {}
        for column_name in active_columns:
            column_values = info[column_name]
            value = column_values[row_index] if row_index < len(column_values) else None

            if isinstance(value, str):
                value = value.strip()
                if value == "":
                    continue
            elif value is None:
                continue
            else:
                try:
                    if hasattr(value, "__len__") and len(value) == 0:
                        continue
                except Exception:
                    pass

            if isinstance(value, (dict, list, tuple, set)):
                value = json.dumps(value, ensure_ascii=False)

            row_data[column_name] = value

        if row_data:
            rows.append(row_data)

    return rows, active_columns


def formatAndWriteCsv(self, successful: bool):
    """Persist the attempt's row output in D1; the legacy name avoids churn.

    This intentionally does not emit a CSV into the checkout. Failed D1 writes
    propagate and leave a local recovery envelope for explicit manual recovery.
    """
    rows, _columns = _format_rows_from_gathering_info(self)
    if not rows:
        return None
    from backend.utils.log.run_storage import RunArtifactStore

    RunArtifactStore().save_scraped_rows(
        run_id=int(self.run_id),
        scraper=getattr(self, "_artifact_item_name", None) or self.__class__.__name__,
        attempt=int(getattr(self, "_artifact_attempt", None) or 1),
        successful=bool(successful),
        rows=rows,
    )
    return len(rows)


def formatAndUpload(self):
    rows, _columns = _format_rows_from_gathering_info(self)
    if not rows:
        if not getattr(self, "_empty_snapshot_evidence", None):
            raise Exception("Empty gathering_info table without confirmed empty-source evidence")
        self._snapshot_row_count = 0
        return None
    snapshot_id = getattr(self, "snapshot_id", None)
    if snapshot_id:
        for row in rows:
            row["snapshot_id"] = snapshot_id
    if self.supabase_table_name == "allSoons":
        for row in rows:
            date.fromisoformat(row.get("release_date") or "")
    result = self.supabase.table(self.supabase_table_name).insert(rows).execute()
    self._snapshot_row_count = len(rows)
    return result


class AppendToInfo:
    def appendToGatheringInfo(self, print_info=False):
        self.fixScreeningType()
        self.fixScreeningTech()
        self.fixCinemaName()
        self.fixLanguage()
        self.fixRating()

        self.gathering_info["showtime"].append(self.showtime)
        self.gathering_info["english_title"].append(self.english_title)
        self.gathering_info["hebrew_title"].append(self.hebrew_title)
        self.gathering_info["english_href"].append(self.english_href)
        self.gathering_info["hebrew_href"].append(self.hebrew_href)
        self.gathering_info["screening_type"].append(self.screening_type)
        self.gathering_info["screening_tech"].append(self.screening_tech)
        self.gathering_info["original_language"].append(self.original_language)
        self.gathering_info["dub_language"].append(self.dub_language)
        self.gathering_info["date_of_showing"].append(self.date_of_showing)
        self.gathering_info["release_year"].append(self.release_year)
        self.gathering_info["release_date"].append(self.release_date)
        self.gathering_info["directed_by"].append(self.directed_by)
        self.gathering_info["runtime"].append(self.runtime)
        self.gathering_info["rating"].append(self.rating)
        self.gathering_info["screening_city"].append(self.screening_city)
        self.gathering_info["cinema"].append(self.CINEMA_NAME)
        self.gathering_info["run_id"].append(self.run_id)

        if print_info:
            self.printRow()
