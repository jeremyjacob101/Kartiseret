from __future__ import annotations

import os
from unittest import TestCase
from unittest.mock import patch

from backend.utils.log import initialize_run_storage


class InitializeRunStorageTests(TestCase):
    def test_initializes_only_the_selected_profile(self):
        selected = {
            "KARTISERET_TARGET": "development",
            "D1_DATABASE_ID": "dev-d1-id",
            "D1_API_TOKEN": "dev-d1-api-token-with-at-least-32-characters",
            "RUN_ARTIFACTS_R2_BUCKET": "kartiseret-run-artifacts-dev",
        }
        with patch.dict(
            os.environ,
            {"DEV_SECRET": "dev", "PROD_SECRET": "prod", "SUPABASE_SERVICE_ROLE_KEY": "old"},
            clear=True,
        ), patch.object(initialize_run_storage, "load_dotenv"), patch.object(
            initialize_run_storage,
            "resolve_target_environment",
            return_value=selected,
        ), patch.object(initialize_run_storage, "RunArtifactStore") as store:
            self.assertEqual(initialize_run_storage.main(["--target", "development"]), 0)
            store.return_value.ensure_schema.assert_called_once_with()
            self.assertEqual(os.environ["D1_DATABASE_ID"], "dev-d1-id")
            self.assertEqual(os.environ["PROD_SECRET"], "")

    def test_configuration_error_does_not_start_storage(self):
        with patch.object(initialize_run_storage, "load_dotenv"), patch.object(
            initialize_run_storage,
            "resolve_target_environment",
            side_effect=ValueError("development D1 Worker secret is missing"),
        ), patch.object(initialize_run_storage, "RunArtifactStore") as store:
            self.assertEqual(initialize_run_storage.main(["--target", "development"]), 2)
        store.assert_not_called()


if __name__ == "__main__":
    import unittest

    unittest.main()
