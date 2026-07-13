import unittest

from backend.dataflow.utils.SupabaseTables import SupabaseTables


class _RpcRequest:
    def __init__(self, rows):
        self.rows = rows

    def execute(self):
        return type("Response", (), {"data": self.rows})()


class _FakeSupabase:
    def __init__(self):
        self.calls = []

    def rpc(self, name, params):
        self.calls.append((name, params))
        return _RpcRequest(
            [
                {"tmdb_id": tmdb_id, "movie_code": code}
                for tmdb_id, code in zip(params["p_tmdb_ids"], ("001", "00A", "00z"))
            ]
        )


class MovieCodesTests(unittest.TestCase):
    def test_ensure_movie_codes_normalizes_and_deduplicates_ids(self):
        tables = SupabaseTables()
        tables.supabase = _FakeSupabase()

        movie_codes = tables.ensureMovieCodes([23, "7", None, 23, "bad", 0])

        self.assertEqual(movie_codes, {7: "001", 23: "00A"})
        self.assertEqual(
            tables.supabase.calls,
            [("ensure_movie_codes", {"p_tmdb_ids": [7, 23]})],
        )

    def test_ensure_movie_codes_requires_a_mapping_for_every_requested_id(self):
        tables = SupabaseTables()
        tables.supabase = _FakeSupabase()
        tables.supabase.rpc = lambda *_: _RpcRequest([{"tmdb_id": 7, "movie_code": "001"}])

        with self.assertRaises(ValueError):
            tables.ensureMovieCodes([7, 23])


if __name__ == "__main__":
    unittest.main()
