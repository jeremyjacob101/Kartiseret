from dotenv import load_dotenv

load_dotenv()

from supabase import create_client
import os

PAGE_SIZE = 500
DELETE_CHUNK_SIZE = 200


def select_tmdb_ids(sb, table_name, page_size=PAGE_SIZE):
    tmdb_ids = set()
    start = 0

    while True:
        rows = sb.table(table_name).select("tmdb_id").range(start, start + page_size - 1).execute().data or []
        if not rows:
            break

        for row in rows:
            tmdb_id = row.get("tmdb_id")
            if tmdb_id is not None:
                tmdb_ids.add(tmdb_id)

        if len(rows) < page_size:
            break
        start += page_size

    return tmdb_ids


def clear_orphan_final_movies():
    sb = create_client(os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))

    showtime_tmdb_ids = select_tmdb_ids(sb, "finalShowtimes")
    final_movie_tmdb_ids = select_tmdb_ids(sb, "finalMovies")
    orphan_tmdb_ids = sorted(final_movie_tmdb_ids - showtime_tmdb_ids)

    deleted_count = 0
    for start in range(0, len(orphan_tmdb_ids), DELETE_CHUNK_SIZE):
        chunk = orphan_tmdb_ids[start : start + DELETE_CHUNK_SIZE]
        sb.table("finalMovies").delete().in_("tmdb_id", chunk).execute()
        deleted_count += len(chunk)


if __name__ == "__main__":
    clear_orphan_final_movies()
