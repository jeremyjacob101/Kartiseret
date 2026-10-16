from types import SimpleNamespace
import copy


class Query:
    def __init__(self, database, table):
        self.database = database
        self.table = table
        self.operation = "select"
        self.predicates = []
        self.bounds = None
        self.limit_count = None
        self.order_columns = []
        self.payload = None

    def select(self, *args):
        return self

    def order(self, column, desc=False):
        self.order_columns.append((column, bool(desc)))
        return self

    def range(self, start, end):
        self.bounds = (start, end)
        return self

    def limit(self, count):
        self.limit_count = count
        return self

    def update(self, payload):
        self.operation, self.payload = "update", copy.deepcopy(payload)
        return self

    def insert(self, payload):
        self.operation, self.payload = "insert", copy.deepcopy(payload)
        return self

    def upsert(self, payload):
        self.operation, self.payload = "upsert", copy.deepcopy(payload)
        return self

    def delete(self):
        self.operation = "delete"
        return self

    def in_(self, column, values):
        self.predicates.append(lambda row: row.get(column) in values)
        return self

    def eq(self, column, value):
        self.predicates.append(lambda row: row.get(column) == value)
        return self

    def gt(self, column, value):
        self.predicates.append(lambda row: row.get(column) is not None and row.get(column) > value)
        return self

    def execute(self):
        if self.operation == "upsert" and self.table == "finalSoons" and any(row.get("release_date") is None for row in self.payload):
            raise ValueError('null value in column "release_date" of relation "finalSoons" violates not-null constraint')
        rows = self.database.tables.setdefault(self.table, [])
        selected = [row for row in rows if all(predicate(row) for predicate in self.predicates)]
        for column, desc in reversed(self.order_columns):
            selected.sort(key=lambda row: str(row.get(column) or ""), reverse=desc)
        if self.bounds:
            selected = selected[self.bounds[0] : self.bounds[1] + 1]
        if self.limit_count is not None:
            selected = selected[: self.limit_count]
        if self.operation != "select":
            if self.database.fail_table == self.table and self.operation == "upsert":
                raise RuntimeError("Injected final-table failure")
            self.database.actions.append({"op": self.operation, "table": self.table, "payload": self.payload, "ids": sorted(str(row.get("id")) for row in selected) if self.operation != "upsert" else []})
        if self.operation == "update":
            for row in selected:
                row.update(self.payload)
        elif self.operation == "insert":
            payload_rows = self.payload if isinstance(self.payload, list) else [self.payload]
            inserted = []
            for payload in payload_rows:
                row = copy.deepcopy(payload)
                rows.append(row)
                inserted.append(row)
            selected = inserted
        elif self.operation == "delete":
            self.database.tables[self.table] = [row for row in rows if row not in selected]
        elif self.operation == "upsert":
            primary_key = "tmdb_id" if self.table in ("finalMovies", "finalThequeMovies", "finalSoons") else "id"
            for row in self.payload:
                existing = next((item for item in rows if item.get(primary_key) == row.get(primary_key)), None)
                if existing is None:
                    rows.append(copy.deepcopy(row))
                else:
                    existing.update(row)
        return SimpleNamespace(data=copy.deepcopy(selected))


class DB:
    def __init__(self, tables, fail_table=None):
        self.tables = copy.deepcopy(tables)
        self.actions = []
        self.fail_table = fail_table

    def table(self, table):
        return Query(self, table)

    def rpc(self, function_name, params):
        return RpcQuery(self, function_name, copy.deepcopy(params))


class RpcQuery:
    def __init__(self, database, function_name, params):
        self.database = database
        self.function_name = function_name
        self.params = params

    def execute(self):
        tables = self.database.tables
        if self.function_name == "claim_pipeline_publication_checkpoint":
            category = self.params["p_category"]
            snapshot_id = self.params["p_snapshot_id"]
            cinema = self.params["p_cinema"]
            source_table = {"nowplayings": "allShowtimes", "cinematheques": "allTheques", "comingsoons": "allSoons"}[category]
            manifests = [row for row in tables.get("pipeline_scrape_snapshots", []) if row.get("table_name") == source_table and row.get("cinema") == cinema]
            manifest = next((row for row in manifests if row.get("snapshot_id") == snapshot_id), None)
            newest = max(manifests, key=lambda row: (row.get("run_id") or -1, row.get("attempt") or 0, row.get("started_at") or ""), default=None)
            if manifest is None or manifest.get("status") != "complete" or newest is None or newest.get("snapshot_id") != snapshot_id:
                result = {"claimed": False, "state": "superseded", "phase": "in_progress"}
                return SimpleNamespace(data=result)

            key = (category, snapshot_id)
            rows = tables.setdefault("pipeline_publication_checkpoints", [])
            current = next((row for row in rows if (row.get("category"), row.get("snapshot_id")) == key), None)
            if current is None:
                current = {
                    "category": category,
                    "snapshot_id": snapshot_id,
                    "input_fingerprint": self.params["p_input_fingerprint"],
                    "phase": "in_progress",
                    "has_unresolved": False,
                }
                rows.append(current)
            if current["phase"] == "published" and current["input_fingerprint"] == self.params["p_input_fingerprint"] and not current["has_unresolved"]:
                result = {"claimed": False, "state": "published", "phase": current["phase"]}
            else:
                resume_phases = {"prepared", "screenings_written", "movies_written", "stale_rows_deleted"}
                resume_phase = current["phase"] if current["input_fingerprint"] == self.params["p_input_fingerprint"] and not current["has_unresolved"] and current["phase"] in resume_phases else "in_progress"
                current.update({
                    "input_fingerprint": self.params["p_input_fingerprint"],
                    "phase": resume_phase,
                    "has_unresolved": False,
                })
                result = {"claimed": True, "state": "in_progress", "phase": resume_phase}
        elif self.function_name == "advance_pipeline_publication_checkpoint":
            params = self.params
            source_table = {"nowplayings": "allShowtimes", "cinematheques": "allTheques", "comingsoons": "allSoons"}[params["p_category"]]
            manifests = [row for row in tables.get("pipeline_scrape_snapshots", []) if row.get("table_name") == source_table and row.get("cinema") == params["p_cinema"]]
            manifest = next((row for row in manifests if row.get("snapshot_id") == params["p_snapshot_id"]), None)
            newest = max(manifests, key=lambda row: (row.get("run_id") or -1, row.get("attempt") or 0, row.get("started_at") or ""), default=None)
            current = next((row for row in tables.setdefault("pipeline_publication_checkpoints", []) if row.get("category") == params["p_category"] and row.get("snapshot_id") == params["p_snapshot_id"]), None)
            latest_complete = bool(manifest and manifest.get("status") == "complete" and newest and newest.get("snapshot_id") == params["p_snapshot_id"])
            matched = bool(latest_complete and current and current.get("input_fingerprint") == params["p_input_fingerprint"])
            if matched:
                current.update({"phase": params["p_phase"], "has_unresolved": current.get("has_unresolved", False) or params["p_has_unresolved"]})
            result = matched
        else:
            raise NotImplementedError(self.function_name)
        return SimpleNamespace(data=result)
