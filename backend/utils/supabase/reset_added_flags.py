from dotenv import load_dotenv

load_dotenv()

import os

from supabase import create_client

TABLES_BY_CATEGORY = {
    "nowplayings": ["allShowtimes"],
    "comingsoons": ["allSoons"],
    "both": ["allShowtimes", "allSoons"],
}

UPDATE_CHUNK_SIZE = 200


def reset_added_flags(category: str) -> None:
    sb = create_client(os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))

    for table_name in TABLES_BY_CATEGORY[category]:
        reset_count = 0

        while True:
            rows = sb.table(table_name).select("id").eq("added", True).order("id").range(0, UPDATE_CHUNK_SIZE - 1).execute().data or []
            if not rows:
                break

            row_ids = [row.get("id") for row in rows if row.get("id")]
            if not row_ids:
                break

            sb.table(table_name).update({"added": False}).in_("id", row_ids).execute()
            reset_count += len(row_ids)

        print(f"Reset {reset_count} added rows in {table_name}.")


if __name__ == "__main__":
    # reset_added_flags("nowplayings")
    # reset_added_flags("comingsoons")
    reset_added_flags("both")
