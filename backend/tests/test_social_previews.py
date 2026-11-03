import base64
from io import BytesIO
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from backend.dataflow.BaseDataflow import BaseDataflow
from backend.dataflow import social_previews


FINGERPRINT = "a" * 64
JPEG = b"\xff\xd8\xff\xd9"
CARD = {
    "tmdbId": "42",
    "title": "A Movie",
    "posterUrl": "https://image.tmdb.org/t/p/w342/a.jpg",
    "backdropUrl": "https://image.tmdb.org/t/p/w1280/b.jpg",
    "isComingSoon": False,
    "year": 2026,
    "releaseDate": None,
    "runtime": 110,
    "genres": ["Drama"],
    "imdbRating": 7.5,
    "rtCriticRating": None,
    "rtCriticVotes": None,
    "rtAudienceRating": None,
    "rtAudienceVotes": None,
    "lbRating": None,
}
ROW = {
    "tmdb_id": 42,
    "social_preview_fingerprint": None,
    "solo_update": False,
}


class FakeWorker:
    def __init__(self, current_fingerprint=FINGERPRINT):
        self.current_fingerprint = current_fingerprint
        self.closed = False
        self.requests = []

    def request(self, message):
        self.requests.append(message)
        if message["op"] == "fingerprint":
            fingerprint = (
                self.current_fingerprint
                if not message["record"].get("changed_during_render")
                else "b" * 64
            )
            return {"fingerprint": fingerprint, "data": CARD}
        return {"jpeg": base64.b64encode(JPEG).decode("ascii")}

    def close(self):
        self.closed = True


class MissingObject(Exception):
    response = {"Error": {"Code": "404"}}


class FakeR2:
    def __init__(self):
        self.objects = {}
        self.put_calls = []

    def head_object(self, *, Bucket, Key):
        obj = self.objects.get(Key)
        if obj is None:
            raise MissingObject()
        return {
            "ContentType": obj["ContentType"],
            "ContentLength": len(obj["Body"]),
        }

    def put_object(self, **kwargs):
        self.put_calls.append(kwargs)
        self.objects[kwargs["Key"]] = kwargs

    def get_object(self, **_kwargs):
        return {"Body": BytesIO(b"fake webp"), "ContentType": "image/webp"}


class SocialPreviewTests(unittest.TestCase):
    def make_client(self, current_row=None):
        current_row = current_row or ROW
        client = Mock()
        table = Mock()
        read = Mock()
        read.eq.return_value = read
        read.limit.return_value = read
        read.execute.return_value.data = [current_row]
        table.select.return_value = read
        write = Mock()
        write.eq.return_value = write
        write.is_.return_value = write
        write.select.return_value = write
        write.execute.return_value.data = [{"tmdb_id": 42}]
        table.update.return_value = write
        client.table.return_value = table
        return client

    def refresh(self, client, r2, worker, *, row=ROW, **kwargs):
        storage = SimpleNamespace(client=r2, bucket="dev")
        with patch.object(
            social_previews,
            "each_row",
            side_effect=lambda _client, table, _columns: iter(
                [row] if table == "finalMovies" else []
            ),
        ), patch.object(
            social_previews,
            "_card_sources",
            return_value=(b"poster", b"backdrop"),
        ):
            return social_previews.refresh_social_previews(
                client, storage, worker=worker, **kwargs
            )

    def test_dry_run_identifies_stale_card_without_writes(self):
        client = self.make_client()
        r2 = FakeR2()
        worker = FakeWorker()

        result = self.refresh(client, r2, worker, dry_run=True)

        self.assertEqual(result["pending"], 1)
        self.assertEqual(result["updated"], 0)
        self.assertFalse(r2.put_calls)
        client.table.return_value.update.assert_not_called()

    def test_upload_verifies_before_publishing_pointer_and_reruns_are_unchanged(self):
        client = self.make_client()
        r2 = FakeR2()
        worker = FakeWorker()
        storage = SimpleNamespace(client=r2, bucket="dev")
        ordered = []
        original_put = r2.put_object

        def put_then_record(**kwargs):
            ordered.append("upload")
            original_put(**kwargs)

        update_query = client.table.return_value.update.return_value

        def record_pointer_update(_value):
            ordered.append("pointer")
            return update_query

        client.table.return_value.update.side_effect = record_pointer_update
        r2.put_object = put_then_record

        with patch.object(
            social_previews,
            "each_row",
            side_effect=lambda _client, table, _columns: iter(
                [ROW] if table == "finalMovies" else []
            ),
        ), patch.object(social_previews, "_card_sources", return_value=(b"poster", b"backdrop")):
            result = social_previews.refresh_social_previews(
                client, storage, worker=worker
            )

        self.assertEqual(result["updated"], 1)
        self.assertEqual(ordered, ["upload", "pointer"])
        upload = r2.objects[f"social/v1/{FINGERPRINT}/card.jpg"]
        self.assertEqual(upload["Body"], JPEG)
        self.assertEqual(upload["ContentType"], "image/jpeg")
        self.assertIn("immutable", upload["CacheControl"])

        unchanged_row = {**ROW, "social_preview_fingerprint": FINGERPRINT}
        client2 = self.make_client(unchanged_row)
        r2_existing = FakeR2()
        r2_existing.objects[f"social/v1/{FINGERPRINT}/card.jpg"] = upload
        worker2 = FakeWorker()
        result2 = self.refresh(client2, r2_existing, worker2, row=unchanged_row)
        self.assertEqual(result2["unchanged"], 1)
        self.assertEqual(result2["updated"], 0)
        client2.table.return_value.update.assert_not_called()

    def test_failed_replacement_upload_keeps_the_existing_pointer_and_retries(self):
        previous_fingerprint = "c" * 64
        row = {**ROW, "social_preview_fingerprint": previous_fingerprint}
        client = self.make_client(row)
        r2 = FakeR2()
        r2.put_object = Mock(side_effect=RuntimeError("temporary R2 failure"))

        first = self.refresh(client, r2, FakeWorker(), row=row)

        self.assertEqual(first["failed"], 1)
        client.table.return_value.update.assert_not_called()

        retry_client = self.make_client(row)
        retry_r2 = FakeR2()
        retried = self.refresh(retry_client, retry_r2, FakeWorker(), row=row)

        self.assertEqual(retried["updated"], 1)
        self.assertEqual(
            retry_client.table.return_value.update.call_args.args[0],
            {"social_preview_fingerprint": FINGERPRINT},
        )
        self.assertIn(f"social/v1/{FINGERPRINT}/card.jpg", retry_r2.objects)

    def test_categories_with_the_same_card_fingerprint_share_one_r2_object(self):
        client = self.make_client()
        r2 = FakeR2()
        storage = SimpleNamespace(client=r2, bucket="dev")
        worker = FakeWorker()

        with patch.object(
            social_previews,
            "each_row",
            side_effect=lambda _client, table, _columns: iter(
                [ROW] if table in {"finalMovies", "finalThequeMovies"} else []
            ),
        ), patch.object(
            social_previews,
            "_card_sources",
            return_value=(b"poster", b"backdrop"),
        ):
            result = social_previews.refresh_social_previews(
                client, storage, worker=worker
            )

        self.assertEqual(result["updated"], 2)
        self.assertEqual(len(r2.put_calls), 1)
        self.assertIn(f"social/v1/{FINGERPRINT}/card.jpg", r2.objects)

    def test_source_change_during_render_never_publishes_a_stale_fingerprint(self):
        client = self.make_client({**ROW, "changed_during_render": True})
        r2 = FakeR2()
        worker = FakeWorker()

        result = self.refresh(client, r2, worker)

        self.assertEqual(result["stale"], 1)
        client.table.return_value.update.assert_not_called()
        self.assertIn(f"social/v1/{FINGERPRINT}/card.jpg", r2.objects)

    def test_bad_fingerprint_is_rejected_before_a_write(self):
        class InvalidWorker(FakeWorker):
            def request(self, message):
                if message["op"] == "fingerprint":
                    return {"fingerprint": "invalid", "data": CARD}
                raise AssertionError("render must not run")

        client = self.make_client()
        r2 = FakeR2()
        result = self.refresh(client, r2, InvalidWorker())
        self.assertEqual(result["failed"], 1)
        self.assertFalse(r2.put_calls)
        client.table.return_value.update.assert_not_called()

    def test_social_refresh_runs_only_after_a_standalone_catalog_commit(self):
        for owns_publication, expected_events in (
            (False, []),
            (True, ["commit", "social"]),
        ):
            events = []
            flow = SimpleNamespace(
                MAIN_TABLE_NAME="finalMovies",
                _owns_publication=owns_publication,
                _publication=SimpleNamespace(commit=lambda: events.append("commit")),
                logic=lambda: None,
                flush_summary=lambda **_kwargs: None,
                closeDataflowRequests=lambda: None,
                discardPublicationStage=lambda: None,
            )

            with patch("backend.dataflow.BaseDataflow.logSuccessfulRun"), patch(
                "backend.dataflow.social_previews.refresh_configured_social_previews",
                side_effect=lambda: events.append("social"),
            ):
                BaseDataflow.dataRun(flow)

            self.assertEqual(events, expected_events)


if __name__ == "__main__":
    unittest.main()
