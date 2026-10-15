from types import SimpleNamespace
import copy


class Query:
    def __init__(self, database, table):
        self.database = database
        self.table = table
        self.operation = "select"
        self.predicates = []
        self.bounds = None
        self.order_column = None
        self.payload = None

    def select(self, *args):
        return self

    def order(self, column):
        self.order_column = column
        return self

    def range(self, start, end):
        self.bounds = (start, end)
        return self

    def update(self, payload):
        self.operation, self.payload = "update", copy.deepcopy(payload)
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

    def execute(self):
        rows = self.database.tables.setdefault(self.table, [])
        selected = [row for row in rows if all(predicate(row) for predicate in self.predicates)]
        if self.order_column:
            selected.sort(key=lambda row: str(row.get(self.order_column) or ""))
        if self.bounds:
            selected = selected[self.bounds[0] : self.bounds[1] + 1]
        if self.operation != "select":
            if self.database.fail_table == self.table and self.operation == "upsert":
                raise RuntimeError("Injected final-table failure")
            self.database.actions.append({"op": self.operation, "table": self.table, "payload": self.payload, "ids": sorted(str(row.get("id")) for row in selected) if self.operation != "upsert" else []})
        if self.operation == "update":
            for row in selected:
                row.update(self.payload)
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
