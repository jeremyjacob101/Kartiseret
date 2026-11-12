"""Exercise the real Python producer and restricted publisher on disposable PG.

Only the Supabase HTTP read transport and artifact sink are adapted. Workspace
loading, token capture, diff construction, staging and atomic publication are real.
"""
import json
import os
import sys
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlparse

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

from backend.dataflow.utils.PublicationWorkspace import PublicationWorkspace

url = os.environ["TEST_DATABASE_URL"]
parsed = urlparse(url)
if parsed.hostname not in {"localhost", "127.0.0.1", "::1"} or parsed.path != "/kartiseret_test":
    raise RuntimeError("Workspace fixture requires disposable local kartiseret_test")


class ReadQuery:
    def __init__(self, table):
        self.table, self.orders, self.bounds, self.filters = table, [], None, []

    def select(self, _columns):
        return self

    def order(self, column):
        self.orders.append(column)
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def range(self, start, end):
        self.bounds = start, end
        return self

    def execute(self):
        start, end = self.bounds
        predicate = sql.SQL(" AND ").join(sql.SQL("{} = %s").format(sql.Identifier(column)) for column, _ in self.filters) if self.filters else sql.SQL("true")
        query = sql.SQL("SELECT to_jsonb(t) AS row FROM (SELECT * FROM public.{} WHERE {} ORDER BY {} OFFSET %s LIMIT %s) t").format(
            sql.Identifier(self.table), predicate, sql.SQL(",").join(map(sql.Identifier, self.orders)))
        with psycopg.connect(url, row_factory=dict_row) as connection:
            connection.execute("SET LOCAL ROLE service_role")
            rows = connection.execute(query, (*[value for _, value in self.filters], start, end-start+1)).fetchall()
        return SimpleNamespace(data=[row["row"] for row in rows])


class ReadClient:
    def table(self, name):
        return ReadQuery(name)

    def rpc(self, name, params):
        if name != "get_publication_input_revision":
            raise ValueError("Unsupported fixture RPC")

        def execute():
            with psycopg.connect(url) as connection:
                connection.execute("SET LOCAL ROLE service_role")
                value = connection.execute("SELECT public.get_publication_input_revision(%s,%s)",
                                           (params["p_table"], params["p_category"])).fetchone()[0]
            return SimpleNamespace(data=value)
        return SimpleNamespace(execute=execute)


request = json.load(sys.stdin)
workspace = PublicationWorkspace("nowplayings", 998001, ReadClient())
workspace.table("pipeline_scrape_snapshots").select().execute()
workspace.table("pipeline_publication_checkpoints").select().execute()
workspace.table("allShowtimes").update({"added": True}).eq("id", request["id"]).execute()
parts = workspace.parts()
with patch("backend.utils.log.run_storage.RunArtifactStore"):
    receipt = workspace.commit()
print(json.dumps({"receipt": receipt, "parts": len(parts), "guard_bytes": sum(len(part.encode()) for part in parts if json.loads(part)["kind"] == "guard"),
                  "guard_rows": sum(len(json.loads(part)["rows"]) for part in parts if json.loads(part)["kind"] == "guard")}))
