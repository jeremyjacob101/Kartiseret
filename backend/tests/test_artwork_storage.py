import unittest
from io import BytesIO
from unittest.mock import Mock, patch

from backend.dataflow.utils.ArtworkStorage import ArtworkStorage


class Missing(Exception):
    response = {"Error": {"Code": "404"}}


class ArtworkStorageTests(unittest.TestCase):
    def setUp(self):
        self.client = Mock()
        self.session = Mock()
        self.storage = ArtworkStorage(self.client, "test-bucket", "https://images.example.test", session=self.session)

    def test_existing_manifest_reuses_all_variants_without_download(self):
        result = self.storage.store("poster", "/abc.jpg")
        self.assertEqual([width for width, _ in result.variants], [185, 342, 780])
        self.assertTrue(result.url.endswith("/342.webp"))
        self.session.get.assert_not_called()
        self.client.put_object.assert_not_called()
        self.assertEqual(self.client.head_object.call_count, 1)

    def test_changed_source_path_has_a_distinct_published_identity(self):
        old = self.storage.image_url("poster", "/old.jpg", 342)
        new = self.storage.image_url("poster", "/new.jpg", 342)
        self.assertNotEqual(old, new)
        self.assertNotEqual(old.split("/poster/")[1].split("/")[0], new.split("/poster/")[1].split("/")[0])

    def test_rejects_invalid_source_without_network(self):
        for path in ("https://evil.test/a.jpg", "/../a.jpg", "/a.jpg?x=1", "/a.svg"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.storage.store("poster", path)
        self.session.get.assert_not_called()

    def test_storage_permission_error_is_not_treated_as_missing(self):
        self.client.head_object.side_effect = RuntimeError("access denied")
        with self.assertRaisesRegex(RuntimeError, "access denied"):
            self.storage.store("backdrop", "/abc.jpg")
        self.session.get.assert_not_called()

    def test_uploads_variants_before_manifest(self):
        from PIL import Image
        image = BytesIO()
        Image.new("RGB", (1000, 1500), "red").save(image, format="JPEG")
        self.client.head_object.side_effect = Missing()
        response = self.session.get.return_value
        response.status_code = 200
        response.iter_content.return_value = [image.getvalue()]
        result = self.storage.store("poster", "/abc.jpg")
        uploads = self.client.put_object.call_args_list
        self.assertEqual(len(uploads), 4)
        self.assertTrue(uploads[-1].kwargs["Key"].endswith("/complete"))
        for upload, (width, _) in zip(uploads, result.variants):
            with Image.open(BytesIO(upload.kwargs["Body"])) as variant:
                self.assertEqual(variant.width, width)
                self.assertEqual(variant.format, "WEBP")
        response.close.assert_called_once()

    def test_failed_variant_upload_does_not_publish_manifest(self):
        from PIL import Image
        image = BytesIO()
        Image.new("RGB", (500, 750), "red").save(image, format="JPEG")
        self.client.head_object.side_effect = Missing()
        response = self.session.get.return_value
        response.status_code = 200
        response.iter_content.return_value = [image.getvalue()]
        self.client.put_object.side_effect = [None, RuntimeError("upload failed")]
        with self.assertRaisesRegex(RuntimeError, "upload failed"):
            self.storage.store("poster", "/abc.jpg")
        self.assertFalse(any(call.kwargs["Key"].endswith("/complete") for call in self.client.put_object.call_args_list))

    def test_failed_download_does_not_publish_manifest(self):
        self.client.head_object.side_effect = Missing()
        response = self.session.get.return_value
        response.raise_for_status.side_effect = RuntimeError("unavailable")
        with self.assertRaisesRegex(RuntimeError, "unavailable"):
            self.storage.store("poster", "/abc.jpg")
        self.client.put_object.assert_not_called()
        response.close.assert_called_once()

    def test_download_is_bounded_before_image_decode(self):
        self.client.head_object.side_effect = Missing()
        response = self.session.get.return_value
        response.status_code = 200
        response.iter_content.return_value = [b"x" * (20 * 1024 * 1024), b"y"]
        with self.assertRaisesRegex(ValueError, "download limit"):
            self.storage.store("poster", "/abc.jpg")
        self.client.put_object.assert_not_called()
        response.close.assert_called_once()

    def test_corrupt_image_is_never_published(self):
        self.client.head_object.side_effect = Missing()
        response = self.session.get.return_value
        response.status_code = 200
        response.iter_content.return_value = [b"not an image"]
        with self.assertRaises(Exception):
            self.storage.store("backdrop", "/abc.jpg")
        self.client.put_object.assert_not_called()

    def test_row_retains_old_artwork_on_failure_and_retries_next_run(self):
        flow = Mock()
        flow.summaryEnabled = True
        row = {"tmdb_id": 123, "en_poster": "old-poster", "backdrop": "old-backdrop"}
        data = {"poster_path": "/new.jpg", "backdrop_path": "/new-backdrop.jpg"}
        with patch.object(self.storage, "store", side_effect=RuntimeError("temporary upload failure")):
            first = self.storage.resolve_row(flow, row.copy(), data)
        self.assertEqual(first["en_poster"], "old-poster")
        self.assertEqual(first["backdrop"], "old-backdrop")

        from backend.dataflow.utils.ArtworkStorage import ArtworkResult, VARIANTS
        def completed(kind, path):
            urls = tuple((width, self.storage.image_url(kind, path, width)) for width in VARIANTS[kind])
            primary = dict(urls)[342 if kind == "poster" else 1280]
            return ArtworkResult(path, primary, urls)
        with patch.object(self.storage, "store", side_effect=completed):
            retry = self.storage.resolve_row(flow, row.copy(), data)
        self.assertTrue(retry["en_poster"].startswith("https://images.example.test/api/images/v1/poster/"))
        self.assertTrue(retry["backdrop"].startswith("https://images.example.test/api/images/v1/backdrop/"))
        self.assertNotIn("poster_path", retry)
        self.assertNotIn("backdrop_path", retry)

    def test_one_failed_image_does_not_block_a_complete_other_image(self):
        flow = Mock()
        flow.summaryEnabled = False
        row = {"tmdb_id": 123, "en_poster": "old-poster", "backdrop": "old-backdrop"}
        from backend.dataflow.utils.ArtworkStorage import ArtworkResult
        poster = ArtworkResult("/new.jpg", "new-poster", ((342, "new-poster"),))
        with patch.object(self.storage, "store", side_effect=[poster, RuntimeError("backdrop failed")]):
            result = self.storage.resolve_row(
                flow,
                row,
                {"poster_path": "/new.jpg", "backdrop_path": "/new-backdrop.jpg"},
            )
        self.assertEqual(result["en_poster"], "new-poster")
        self.assertEqual(result["backdrop"], "old-backdrop")


if __name__ == "__main__":
    unittest.main()
