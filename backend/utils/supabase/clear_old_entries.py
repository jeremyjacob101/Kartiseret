from dotenv import load_dotenv

load_dotenv()

from datetime import date, timedelta
from supabase import create_client
import os

ALL_SHOWTIMES_CUTOFF_DAYS_AGO = 5
ALL_SOONS_CUTOFF_DAYS_AGO = 31
FINAL_SHOWTIMES_CUTOFF_DAYS_AGO = 1
FINAL_SOONS_CUTOFF_DAYS_AGO = 0
DELETE_CHUNK_SIZE = 200


def delete_entries_on_or_before(sb, table_name, date_column, cutoff):
    deleted_count = 0

    while True:
        rows = sb.table(table_name).select("id").lte(date_column, cutoff).order("id").range(0, DELETE_CHUNK_SIZE - 1).execute().data or []
        row_ids = [row.get("id") for row in rows if row.get("id")]
        if not row_ids:
            return deleted_count

        sb.table(table_name).delete().in_("id", row_ids).execute()
        deleted_count += len(row_ids)


def clear_old_entries(category=None, showtimes_days_ago=ALL_SHOWTIMES_CUTOFF_DAYS_AGO, soons_days_ago=ALL_SOONS_CUTOFF_DAYS_AGO, final_showtimes_days_ago=FINAL_SHOWTIMES_CUTOFF_DAYS_AGO, final_soons_days_ago=FINAL_SOONS_CUTOFF_DAYS_AGO):
    sb = create_client(os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))

    if category in (None, "nowplayings"):
        all_showtimes_cutoff = (date.today() - timedelta(days=showtimes_days_ago)).isoformat()
        final_showtimes_cutoff = (date.today() - timedelta(days=final_showtimes_days_ago)).isoformat()
        all_showtimes_deleted = delete_entries_on_or_before(sb, "allShowtimes", "date_of_showing", all_showtimes_cutoff)
        final_showtimes_deleted = delete_entries_on_or_before(sb, "finalShowtimes", "date_of_showing", final_showtimes_cutoff)
        print(f"Deleted {all_showtimes_deleted} old allShowtimes rows on or before {all_showtimes_cutoff}.")
        print(f"Deleted {final_showtimes_deleted} old finalShowtimes rows on or before {final_showtimes_cutoff}.")

    if category in (None, "soons"):
        all_soons_cutoff = (date.today() - timedelta(days=soons_days_ago)).isoformat()
        final_soons_cutoff = (date.today() - timedelta(days=final_soons_days_ago)).isoformat()
        all_soons_deleted = delete_entries_on_or_before(sb, "allSoons", "release_date", all_soons_cutoff)
        final_soons_deleted = delete_entries_on_or_before(sb, "finalSoons", "release_date", final_soons_cutoff)
        print(f"Deleted {all_soons_deleted} old allSoons rows on or before {all_soons_cutoff}.")
        print(f"Deleted {final_soons_deleted} old finalSoons rows on or before {final_soons_cutoff}.")


if __name__ == "__main__":
    clear_old_entries()
