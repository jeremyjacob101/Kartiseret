from backend.dataflow.BaseDataflow import BaseDataflow


class NowPlayingsClean(BaseDataflow):
    MAIN_TABLE_NAME = "allShowtimes"
    HELPER_TABLE_NAME = "tableFixes"

    def logic(self):
        _, tmdb_fix_by_title, _ = self.buildTmdbFixMaps(self.helper_table_rows)
        fixed_row_ids = {row.get("id") for row in self.main_table_rows if self.tmdbFixForTitle(row.get("english_title"), tmdb_fix_by_title)}

        self.applyYesPlanetHebrewToRavHenEnglish()

        for row in self.main_table_rows:
            if row.get("cleaned") is True:
                continue
            if row.get("id") in fixed_row_ids:
                self.updates.append({**row, "cleaned": True})
                continue
            row["english_title"] = self.normalizeTitle(row.get("english_title") or "")
            row["hebrew_title"] = (row.get("hebrew_title") or "").lower()
            if self.removeBadTitle(row.get("english_title")):
                self.delete_these.append(row[self.PRIMARY_KEY])
            elif self.removeRussianHebrewTitle(row.get("hebrew_title")):
                self.delete_these.append(row[self.PRIMARY_KEY])
            self.updates.append({"id": row["id"], "english_title": row["english_title"], "hebrew_title": row.get("hebrew_title"), "cleaned": True})

        self.upsertUpdates(self.MAIN_TABLE_NAME, refresh=False)
        self.deleteTheseRows(self.MAIN_TABLE_NAME, refresh=False)
