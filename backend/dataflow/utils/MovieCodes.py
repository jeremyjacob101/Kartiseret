from typing import Any, Iterable
import secrets


class MovieCodes:
    MOVIE_CODES_TABLE_NAME = "movieCodes"
    MOVIE_CODE_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    MOVIE_CODE_LENGTH = 3
    MOVIE_CODE_CAPACITY = len(MOVIE_CODE_ALPHABET) ** MOVIE_CODE_LENGTH
    MOVIE_CODE_ALPHABETS_BY_WIDTH = (
        "1iljIt",
        "23457fkrsvxyzFJLT",
        "0689abcdeghnopquABCDEGHKNOPQRSUVXYZ",
        "mwMW",
    )
    MOVIE_CODE_ATTEMPTS_PER_WIDTH = 1_000

    @classmethod
    def movieCodeForNumber(cls, value: int) -> str:
        if value < 0 or value >= cls.MOVIE_CODE_CAPACITY:
            raise ValueError(f"Movie code number must be between 0 and {cls.MOVIE_CODE_CAPACITY - 1}")

        remaining = value
        characters = []
        for _ in range(cls.MOVIE_CODE_LENGTH):
            characters.append(cls.MOVIE_CODE_ALPHABET[remaining % len(cls.MOVIE_CODE_ALPHABET)])
            remaining //= len(cls.MOVIE_CODE_ALPHABET)
        return "".join(reversed(characters))

    @classmethod
    def randomMovieCode(cls, alphabet: str | None = None) -> str:
        characters = alphabet or cls.MOVIE_CODE_ALPHABET
        return "".join(secrets.choice(characters) for _ in range(cls.MOVIE_CODE_LENGTH))

    @classmethod
    def randomAvailableMovieCode(cls, used_codes: set[str]) -> str:
        alphabet = ""
        for width_tier in cls.MOVIE_CODE_ALPHABETS_BY_WIDTH:
            alphabet += width_tier
            for _ in range(cls.MOVIE_CODE_ATTEMPTS_PER_WIDTH):
                movie_code = cls.randomMovieCode(alphabet)
                if movie_code not in used_codes:
                    return movie_code

        while len(used_codes) < cls.MOVIE_CODE_CAPACITY:
            movie_code = cls.randomMovieCode()
            if movie_code not in used_codes:
                return movie_code

        raise ValueError("Movie code capacity of 238328 has been reached")

    def ensureMovieCodes(self, tmdb_ids: Iterable[Any]) -> dict[int, str]:
        normalized_ids: set[int] = set()
        for tmdb_id in tmdb_ids:
            try:
                value = int(tmdb_id)
            except (TypeError, ValueError):
                continue
            if value > 0:
                normalized_ids.add(value)

        if not normalized_ids:
            return {}

        requested_ids = sorted(normalized_ids)
        movie_codes_by_tmdb: dict[int, str] = {}

        for start in range(0, len(requested_ids), 200):
            requested_chunk = requested_ids[start : start + 200]
            response = self.supabase.table(self.MOVIE_CODES_TABLE_NAME).select("tmdb_id,movie_code").in_("tmdb_id", requested_chunk).execute()
            for row in response.data or []:
                try:
                    tmdb_id = int(row.get("tmdb_id"))
                except (AttributeError, TypeError, ValueError):
                    continue
                movie_code = str(row.get("movie_code") or "").strip()
                if tmdb_id > 0 and len(movie_code) == self.MOVIE_CODE_LENGTH and all(character in self.MOVIE_CODE_ALPHABET for character in movie_code):
                    movie_codes_by_tmdb[tmdb_id] = movie_code

        used_codes = {str(row.get("movie_code") or "").strip() for row in self.selectAll(self.MOVIE_CODES_TABLE_NAME, select="movie_code")}
        new_rows = []

        for tmdb_id in requested_ids:
            if tmdb_id in movie_codes_by_tmdb:
                continue

            movie_code = self.randomAvailableMovieCode(used_codes)
            movie_codes_by_tmdb[tmdb_id] = movie_code
            used_codes.add(movie_code)
            new_rows.append({"tmdb_id": tmdb_id, "movie_code": movie_code})

        if new_rows:
            self.supabase.table(self.MOVIE_CODES_TABLE_NAME).insert(new_rows).execute()

        return movie_codes_by_tmdb

    def ensureMovieCodesForTable(self, table_name: str) -> dict[int, str]:
        rows = self.selectAll(table_name, select="tmdb_id")
        return self.ensureMovieCodes(row.get("tmdb_id") for row in rows)
