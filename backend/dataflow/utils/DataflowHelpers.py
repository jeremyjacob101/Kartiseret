from datetime import datetime, date
import re, unicodedata, json


class DataflowHelpers:

    def protectUnresolvedSnapshot(self, rows, *, category=None, identity_key=None):
        for row in rows:
            row_id = row.get("id")
            if row_id not in (None, "", "null"):
                self.unresolved_snapshot_ids.add(row_id)
            snapshot_id = self.clean_str(row.get("snapshot_id")).strip()
            if snapshot_id:
                self.unresolved_identity_keys_by_snapshot[snapshot_id].add(identity_key or "unknown")

    def dateToDate(self, v):
        if isinstance(v, date):
            return v
        return datetime.fromisoformat(str(v)).date()

    def datetimeToDatetime(self, v):
        if isinstance(v, datetime):
            return v

        s = str(v).replace("T", " ")
        if s.endswith("+00"):
            s = s[:-3] + "+0000"
        elif s.endswith("+00:00"):
            s = s[:-6] + "+0000"
        return datetime.strptime(s, "%Y-%m-%d %H:%M:%S.%f%z")

    def removeBadTitle(self, title: str) -> bool:
        if not isinstance(title, str) or title.strip() == "":
            return True  # Empty
        if re.search(r"[\u0400-\u04FF\u0500-\u052F\u2DE0-\u2DFF\uA640-\uA69F\u1C80-\u1C8F]", title):
            return True  # Russian
        if re.search(r"[\u0590-\u05FF\uFB1D-\uFB4F]", title):
            return True  # Hebrew
        if "HOT CINEMA" in title:
            return True  # Cinema
        return False

    def removeRussianHebrewTitle(self, title: str) -> bool:
        if re.search(r"[\u0400-\u04FF\u0500-\u052F\u2DE0-\u2DFF\uA640-\uA69F\u1C80-\u1C8F]", title):
            return True  # Russian
        return False

    def normalizeTitle(self, title: str) -> str:
        if not isinstance(title, str):
            return ""

        title = unicodedata.normalize("NFKD", title)
        title = title.encode("ascii", "ignore").decode("ascii")

        title = title.lower()
        title = re.sub(r"[-–—:?!&]+", " ", title)
        title = re.sub(r"[^a-z0-9 ]+", "", title)
        title = re.sub(r"\s+", " ", title)
        return title.strip()

    def tryExceptNone(self, func):
        try:
            return func()
        except:
            return None

    def tryExceptPass(self, func):
        try:
            func()
        except:
            pass

    def clean_date(self, v):
        if v in (None, "", "null"):
            return None
        if isinstance(v, date):
            return v.isoformat()
        try:
            return date.fromisoformat(str(v)).isoformat()
        except ValueError:
            return None

    def clean_str(self, v):
        return str(v) if v not in (None, "", "null") else ""

    def clean_int(self, v):
        try:
            return int(v) if v not in (None, "", "null") else None
        except:
            return None

    def clean_float(self, v):
        try:
            return float(v) if v not in (None, "", "null") else None
        except:
            return None

    def clean_array(self, v):
        if v in (None, "", "null"):
            return []

        if isinstance(v, list):
            out = []
            for item in v:
                if isinstance(item, dict):
                    name = item.get("name")
                    if name not in (None, "", "null"):
                        out.append(str(name))
                elif item not in (None, "", "null"):
                    out.append(str(item))
            return out

        if isinstance(v, str):
            s = v.strip()
            if not s:
                return []
            try:
                parsed = json.loads(s)
                if isinstance(parsed, list):
                    out = []
                    for item in parsed:
                        if isinstance(item, dict):
                            name = item.get("name")
                            if name not in (None, "", "null"):
                                out.append(str(name))
                        elif item not in (None, "", "null"):
                            out.append(str(item))
                    return out
            except:
                pass
            return [s]

        return []

    def per_thread_updating_extract_existing_values(self, row):
        return {
            "english_title": self.clean_str(row.get("english_title")),
            "release_year": self.clean_int(row.get("release_year")),
            "runtime": self.clean_int(row.get("runtime")),
            "popularity": self.clean_float(row.get("popularity")),
            "tmdb_id": self.clean_int(row.get("tmdb_id")),
            "tmdbRating": self.clean_int(row.get("tmdbRating")),
            "tmdbVotes": self.clean_int(row.get("tmdbVotes")),
            "imdb_id": self.clean_str(row.get("imdb_id")),
            "imdbRating": self.clean_float(row.get("imdbRating")),
            "imdbVotes": self.clean_int(row.get("imdbVotes")),
            "rt_id": self.clean_str(row.get("rt_id")),
            "rtAudienceRating": self.clean_int(row.get("rtAudienceRating")),
            "rtAudienceVotes": self.clean_int(row.get("rtAudienceVotes")),
            "rtCriticRating": self.clean_int(row.get("rtCriticRating")),
            "rtCriticVotes": self.clean_int(row.get("rtCriticVotes")),
            "lb_id": self.clean_str(row.get("lb_id")),
            "lbRating": self.clean_float(row.get("lbRating")),
            "lbVotes": self.clean_int(row.get("lbVotes")),
            "en_poster": self.clean_str(row.get("en_poster")),
            "en_trailer": self.clean_str(row.get("en_trailer")),
            "genres": self.clean_array(row.get("genres")),
            "backdrop": self.clean_str(row.get("backdrop")),
        }

    def solo_update_empty_values(self, tmdb_id, row=None):
        movie_values = {
            "english_title": "",
            "release_year": None,
            "runtime": None,
            "popularity": None,
            "tmdb_id": tmdb_id,
            "tmdbRating": None,
            "tmdbVotes": None,
            "imdb_id": "",
            "imdbRating": None,
            "imdbVotes": None,
            "rt_id": "",
            "rtAudienceRating": None,
            "rtAudienceVotes": None,
            "rtCriticRating": None,
            "rtCriticVotes": None,
            "lb_id": "",
            "lbRating": None,
            "lbVotes": None,
            "en_poster": "",
            "en_trailer": "",
            "genres": [],
            "backdrop": "",
            "alt_options": [],
        }

        if getattr(self, "MAIN_TABLE_NAME", "") != "finalSoons":
            return movie_values

        row = row if isinstance(row, dict) else {}
        return {
            "id": row.get("id"),
            "english_title": "",
            "hebrew_title": "",
            "release_date": self.clean_date(row.get("release_date")),
            "release_year": None,
            "runtime": None,
            "popularity": None,
            "tmdb_id": tmdb_id,
            "imdb_id": "",
            "en_poster": "",
            "en_trailer": "",
            "genres": [],
            "backdrop": "",
            "alt_options": [],
        }

    def updating_existing_values(self, row):
        existing = self.per_thread_updating_extract_existing_values(row)
        if not getattr(self, "solo_update_only", False):
            return existing
        return self.solo_update_empty_values(existing["tmdb_id"], row)

    def updating_output_row(self, row):
        if not getattr(self, "solo_update_only", False):
            return dict(row)

        tmdb_id = self.clean_int(row.get("tmdb_id"))
        new_row = self.solo_update_empty_values(tmdb_id, row)
        new_row["solo_update"] = False
        return new_row

    def normalizeFixTitle(self, title):
        # Preserve non-Latin scripts while keeping the existing Latin punctuation rules.
        text = unicodedata.normalize("NFKD", self.clean_str(title)).casefold()
        result = []
        latin_base = False
        for c in text:
            category = unicodedata.category(c)[0]
            if category == "M":
                if not latin_base:
                    result.append(c)
            elif category in "LN":
                result.append(c)
                latin_base = "LATIN" in unicodedata.name(c, "")
            elif c in "-–—:?!&" or c.isspace():
                result.append(" ")
                latin_base = False
            else:
                latin_base = False
        return " ".join("".join(result).split())

    def buildTmdbFixMaps(self, fix_rows: list[dict]):
        tmdb_fix_ids = set()
        maps = {"exact": {}, "lower": {}, "normalized": {}}
        aliases = {}
        for fix in fix_rows or []:
            if not isinstance(fix, dict):
                continue
            tmdb_id = self.clean_int(fix.get("tmdb_id"))
            title = self.clean_str(fix.get("title_fix")).strip()
            if not tmdb_id or not title:
                continue
            tmdb_fix_ids.add(tmdb_id)
            for tier, key in (("exact", title), ("lower", title.casefold()), ("normalized", self.normalizeFixTitle(title))):
                if key:
                    maps[tier].setdefault(key, set()).add((title, tmdb_id))
            source_id = self.clean_int(title)
            if source_id:
                aliases[source_id] = tmdb_id
        return tmdb_fix_ids, maps, aliases

    def tmdbFixMatch(self, title, maps):
        title = self.clean_str(title).strip()
        if not title:
            return None
        for tier, key in (("exact", title), ("lower", title.casefold()), ("normalized", self.normalizeFixTitle(title))):
            entries = (maps or {}).get(tier, {}).get(key, set()) if key else set()
            if entries:
                ids = {item[1] for item in entries}
                return {"tier": tier, "titles": sorted({item[0] for item in entries}),
                        "tmdb_id": next(iter(ids)) if len(ids) == 1 else None,
                        "conflict": len(ids) > 1, "ids": sorted(ids)}
        return None

    def tmdbFixForTitle(self, title, tmdb_fix_by_title: dict):
        match = self.tmdbFixMatch(title, tmdb_fix_by_title)
        if match and getattr(self, "summaryEnabled", False):
            note = f"tmdb_fix_match | title={title!r} | tier={match['tier']} | fixes={match['titles']!r} | ids={match['ids']!r} | conflict={match['conflict']}"
            if note not in self.summaryNotes:
                self.trace_note(note)
        return match["tmdb_id"] if match and not match["conflict"] else None

    def tmdbFixAliasForTmdbId(self, tmdb_id, tmdb_fix_alias_by_tmdb: dict):
        source_tmdb_id = self.clean_int(tmdb_id)
        if not source_tmdb_id:
            return None
        return tmdb_fix_alias_by_tmdb.get(source_tmdb_id)
