from __future__ import annotations

from contextlib import redirect_stderr
from io import StringIO
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import Mock, patch

from backend.config import upload_cron_log


class UploadCronLogTests(TestCase):
    def _run(self, directory: str, *, data, mark_failed: bool = False, storage_error: Exception | None = None):
        log_path = Path(directory) / "cron.log"
        run_id_path = Path(directory) / "run-id"
        log_path.write_text("cron output", encoding="utf-8")
        run_id_path.write_text("42\n", encoding="utf-8")

        client = Mock()
        client.table.return_value.update.return_value.eq.return_value.select.return_value.execute.return_value.data = data
        store_class = Mock()
        if storage_error:
            store_class.return_value.save_file_artifact.side_effect = storage_error
        args = ["--target", "development", "--run-id-file", str(run_id_path), "--path", str(log_path)]
        if mark_failed:
            args.append("--mark-failed")
        with patch.dict(os.environ, {"SUPABASE_URL": "https://dev.example", "SUPABASE_SERVICE_ROLE_KEY": "test-key"}), patch.object(
            upload_cron_log, "load_dotenv"
        ), patch.object(upload_cron_log, "_select_profile"), patch.object(
            upload_cron_log, "RunArtifactStore", store_class
        ), patch.object(upload_cron_log, "create_client", return_value=client), patch.object(
            upload_cron_log, "write_recovery_envelope"
        ) as recovery, patch("sys.argv", ["upload_cron_log", *args]):
            stderr = StringIO()
            with redirect_stderr(stderr):
                result = upload_cron_log.main()
        return (
            result, store_class.return_value, recovery, stderr.getvalue(),
            log_path.exists(), run_id_path.exists(),
        )

    def test_storage_failure_with_supabase_confirmation_marks_run_failed(self):
        with TemporaryDirectory() as directory:
            result, store, recovery, stderr, log_exists, _run_id_exists = self._run(
                directory, data=[{"run_id": 42}], storage_error=RuntimeError("R2 unavailable")
            )
        self.assertEqual(result, 1)
        store.mark_run_failed.assert_called_once_with(42, reason="cron_upload_RuntimeError")
        store.mark_run_unconfirmed.assert_not_called()
        self.assertIn("failed in Supabase", stderr)
        self.assertTrue(log_exists)
        self.assertEqual(recovery.call_args.args[2]["status"], "failed")

    def test_missing_supabase_confirmation_marks_d1_run_unconfirmed(self):
        with TemporaryDirectory() as directory:
            result, store, recovery, stderr, log_exists, _run_id_exists = self._run(
                directory, data=[], storage_error=RuntimeError("R2 unavailable")
            )
        self.assertEqual(result, 1)
        store.mark_run_failed.assert_not_called()
        store.mark_run_unconfirmed.assert_called_once_with(
            42, reason="supabase_finalization_unconfirmed"
        )
        self.assertIn("unconfirmed in Supabase", stderr)
        self.assertTrue(log_exists)
        self.assertEqual(recovery.call_args.args[2]["status"], "unconfirmed")

    def test_shell_transcript_failure_flag_requires_confirmed_supabase_status(self):
        with TemporaryDirectory() as directory:
            result, store, recovery, stderr, log_exists, run_id_exists = self._run(
                directory, data=[], mark_failed=True
            )
        self.assertEqual(result, 1)
        store.mark_run_failed.assert_not_called()
        store.mark_run_unconfirmed.assert_called_once_with(
            42, reason="supabase_finalization_unconfirmed"
        )
        self.assertIn("unconfirmed in Supabase", stderr)
        self.assertTrue(log_exists)
        self.assertTrue(run_id_exists)
        self.assertEqual(recovery.call_args.args[2]["status"], "unconfirmed")


if __name__ == "__main__":
    import unittest

    unittest.main()
