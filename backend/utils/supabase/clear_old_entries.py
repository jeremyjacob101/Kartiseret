from dotenv import load_dotenv

load_dotenv()

from datetime import date, timedelta
from supabase import create_client
import os

ALL_SHOWTIMES_CUTOFF_DAYS_AGO = 16
ALL_SOONS_CUTOFF_DAYS_AGO = 31
FINAL_SHOWTIMES_CUTOFF_DAYS_AGO = 1
FINAL_SOONS_CUTOFF_DAYS_AGO = 0


def clear_old_entries(category=None, showtimes_days_ago=ALL_SHOWTIMES_CUTOFF_DAYS_AGO, soons_days_ago=ALL_SOONS_CUTOFF_DAYS_AGO, final_showtimes_days_ago=FINAL_SHOWTIMES_CUTOFF_DAYS_AGO, final_soons_days_ago=FINAL_SOONS_CUTOFF_DAYS_AGO):
    sb = create_client(os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))

    if category in (None, "nowplayings"):
        all_showtimes_cutoff = (date.today() - timedelta(days=showtimes_days_ago)).isoformat()
        final_showtimes_cutoff = (date.today() - timedelta(days=final_showtimes_days_ago)).isoformat()
        sb.table("allShowtimes").delete().lte("date_of_showing", all_showtimes_cutoff).execute()
        sb.table("finalShowtimes").delete().lte("date_of_showing", final_showtimes_cutoff).execute()

    if category in (None, "soons"):
        all_soons_cutoff = (date.today() - timedelta(days=soons_days_ago)).isoformat()
        final_soons_cutoff = (date.today() - timedelta(days=final_soons_days_ago)).isoformat()
        sb.table("allSoons").delete().lte("release_date", all_soons_cutoff).execute()
        sb.table("finalSoons").delete().lte("release_date", final_soons_cutoff).execute()


if __name__ == "__main__":
    clear_old_entries()
