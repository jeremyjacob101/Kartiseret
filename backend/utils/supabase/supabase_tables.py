from dotenv import load_dotenv

load_dotenv()

from typing import Optional, Sequence
from backend.dataflow.utils.PublicationWorkspace import create_client, maintenance_publication, CATEGORY_TABLES
import os




def _sync_tables(action: str, source_table: Optional[str] = None, target_tables: Optional[Sequence[str]] = None, page_size: int = 200, start: int = 0) -> None:
    sb = create_client(os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))
    targets = list(target_tables or [])
    action = action.strip().lower()
    if action not in {"append", "clear", "replace"} or ((action in {"append", "replace"}) and not source_table) or not targets:
        raise ValueError("action must be one of: append, clear, replace OR no source_table when append/replace OR no target_tables")

    if action == "clear" or action == "replace":
        for target in targets:
            sb.table(target).delete().filter("id", "not.is", "null").execute()
        if action == "clear":
            return

    while True:
        res = sb.table(source_table).select("*").range(start, start + page_size - 1).execute()
        rows = res.data or []
        if not rows:
            break

        for target in targets:
            sb.table(target).insert(rows).execute()

        start += page_size


def sync_tables(action, source_table=None, target_tables=None, page_size=200, start=0):
    targets = list(target_tables or [])
    categories = {category for category, tables in CATEGORY_TABLES.items() if any(table in tables for table in targets)}
    if len(categories) != 1:
        raise ValueError("Table synchronization requires one explicit publication category")
    with maintenance_publication(categories.pop()):
        return _sync_tables(action, source_table, targets, page_size, start)


if __name__ == "__main__":  # append, clear, replace
    sync_tables(action="clear", source_table="", target_tables=["", ""])
