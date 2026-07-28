from dotenv import load_dotenv

load_dotenv()

from supabase import create_client
import os

from backend.utils.supabase.clear_orphan_final_movies import DELETE_CHUNK_SIZE, select_tmdb_ids


def clear_orphan_final_theque_movies():
    sb = create_client(os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))

    screening_tmdb_ids = select_tmdb_ids(sb, "finalTheques")
    movie_tmdb_ids = select_tmdb_ids(sb, "finalThequeMovies")
    orphan_tmdb_ids = sorted(movie_tmdb_ids - screening_tmdb_ids)

    deleted_count = 0
    for start in range(0, len(orphan_tmdb_ids), DELETE_CHUNK_SIZE):
        chunk = orphan_tmdb_ids[start : start + DELETE_CHUNK_SIZE]
        sb.table("finalThequeMovies").delete().in_("tmdb_id", chunk).execute()
        deleted_count += len(chunk)

    # print(f"Deleted {deleted_count} orphan finalThequeMovies rows.")


if __name__ == "__main__":
    clear_orphan_final_theque_movies()
