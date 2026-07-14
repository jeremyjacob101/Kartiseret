import os

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()


def stop_latest_util_run() -> None:
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    latest = sb.table("utilRunLogs").select("date_created,run_id,selected_runners").order("run_id", desc=True).limit(1).execute().data
    if not latest:
        print("No rows found in utilRunLogs.")
        return

    latest_run = latest[0]
    run_id = latest_run["run_id"]
    print(f"Created at: {latest_run.get('date_created')}")
    print(f"Run ID: {run_id}")
    print(f"Selected runners: {latest_run.get('selected_runners')}")

    while True:
        answer = input("Set this run's running_now to false? [y/n]: ").strip().lower()
        if answer in {"y", "n"}:
            break
        print("Please type y or n.")

    if answer == "n":
        print("No changes made.")
        return

    sb.table("utilRunLogs").update({"running_now": False}).eq("run_id", run_id).execute()
    print(f"Set running_now to false for utilRunLogs run_id {run_id}.")


if __name__ == "__main__":
    stop_latest_util_run()
