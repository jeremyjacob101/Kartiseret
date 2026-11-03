from __future__ import annotations

import os
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from backend.config import runner
from backend.config.target_environment import (
    BUCKETS,
    PROJECT_REFS,
    TargetConfigurationError,
    is_scheduled,
    resolve_target_environment,
)


def _profile(prefix: str, target: str) -> dict[str, str]:
    project_ref = PROJECT_REFS[target]
    bucket = BUCKETS[target]
    return {
        f"{prefix}SUPABASE_URL": f"https://{project_ref}.supabase.co",
        f"{prefix}SUPABASE_PUBLISHABLE_KEY": f"publishable-{target}",
        f"{prefix}SUPABASE_SERVICE_ROLE_KEY": f"service-role-{target}",
        f"{prefix}DATABASE_URL": (
            f"postgresql://kartiseret_api.{project_ref}:db-secret@"
            "aws-0-eu-central-2.pooler.supabase.com:6543/postgres"
        ),
        f"{prefix}DATABASE_SSL_CA_CERT": f"{target}-ca",
        f"{prefix}PUBLICATION_DATABASE_URL": (
            f"postgresql://publisher.{project_ref}:db-secret@"
            "aws-0-eu-central-2.pooler.supabase.com:5432/postgres"
        ),
        f"{prefix}PUBLICATION_DATABASE_SSL_CA_CERT": f"{target}-publisher-ca",
        f"{prefix}R2_ACCOUNT_ID": "a" * 32,
        f"{prefix}R2_BUCKET": bucket,
        f"{prefix}R2_IMAGE_ORIGIN": f"https://{target}.example.test",
        f"{prefix}R2_ACCESS_KEY_ID": f"write-id-{target}",
        f"{prefix}R2_SECRET_ACCESS_KEY": f"write-secret-{target}",
        f"{prefix}R2_READ_ACCESS_KEY_ID": f"read-id-{target}",
        f"{prefix}R2_READ_SECRET_ACCESS_KEY": f"read-secret-{target}",
        f"{prefix}RESEND_API_KEY": f"resend-{target}",
        f"{prefix}TICKET_ALERT_RECIPIENT_API_URL": f"https://{target}.example.test/api",
        f"{prefix}TICKET_ALERT_INTERNAL_API_SECRET": f"ticket-{target}",
    }


class TargetEnvironmentTests(TestCase):
    def setUp(self) -> None:
        self.profiles = {
            **_profile("DEV_", "development"),
            **_profile("PROD_", "production"),
            "TMDB_API_KEY": "shared-tmdb-key",
        }

    def test_development_profile_maps_database_and_r2_as_one_target(self):
        resolved = resolve_target_environment("development", self.profiles)

        self.assertEqual(resolved["SUPABASE_URL"], f"https://{PROJECT_REFS['development']}.supabase.co")
        self.assertEqual(resolved["SUPABASE_SERVICE_ROLE_KEY"], "service-role-development")
        self.assertEqual(resolved["DATABASE_SSL_CA_CERT"], "development-ca")
        self.assertIn(PROJECT_REFS["development"], resolved["DATABASE_URL"])
        self.assertEqual(resolved["R2_BUCKET"], BUCKETS["development"])
        self.assertEqual(resolved["R2_ACCESS_KEY_ID"], "write-id-development")
        self.assertEqual(resolved["R2_READ_ACCESS_KEY_ID"], "read-id-development")
        self.assertEqual(resolved["KARTISERET_TARGET"], "development")
        self.assertEqual(resolved["PROD_SUPABASE_SERVICE_ROLE_KEY"], "")
        self.assertEqual(resolved["DEV_SUPABASE_SERVICE_ROLE_KEY"], "")
        self.assertEqual(resolved["TMDB_API_KEY"], "shared-tmdb-key")
        self.assertEqual(resolved["RESEND_API_KEY"], "")
        self.assertEqual(resolved["TICKET_ALERT_RECIPIENT_API_URL"], "")
        self.assertEqual(resolved["TICKET_ALERT_INTERNAL_API_SECRET"], "")

    def test_production_profile_maps_its_own_values(self):
        resolved = resolve_target_environment("production", self.profiles)

        self.assertEqual(resolved["SUPABASE_SERVICE_ROLE_KEY"], "service-role-production")
        self.assertEqual(resolved["R2_BUCKET"], BUCKETS["production"])
        self.assertEqual(resolved["R2_ACCESS_KEY_ID"], "write-id-production")
        self.assertEqual(resolved["RESEND_API_KEY"], "resend-production")
        self.assertEqual(resolved["DEV_R2_SECRET_ACCESS_KEY"], "")

    def test_app_read_credentials_can_be_configured_without_dataflow_writes(self):
        environment = {
            "DEV_SUPABASE_URL": f"https://{PROJECT_REFS['development']}.supabase.co",
            "DEV_SUPABASE_SERVICE_ROLE_KEY": "dev-service-role",
            "DEV_R2_ACCOUNT_ID": "a" * 32,
            "DEV_R2_BUCKET": BUCKETS["development"],
            "DEV_R2_READ_ACCESS_KEY_ID": "dev-read-id",
            "DEV_R2_READ_SECRET_ACCESS_KEY": "dev-read-secret",
        }

        resolved = resolve_target_environment("development", environment)

        self.assertEqual(resolved["R2_BUCKET"], BUCKETS["development"])
        self.assertEqual(resolved["R2_READ_ACCESS_KEY_ID"], "dev-read-id")
        self.assertNotIn("R2_ACCESS_KEY_ID", resolved)

    def test_selected_profile_cannot_fall_back_to_generic_or_other_target(self):
        environment = {
            **self.profiles,
            "SUPABASE_URL": f"https://{PROJECT_REFS['production']}.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "generic-production-key",
        }
        selected = {key: value for key, value in environment.items() if not key.startswith("DEV_")}

        with self.assertRaisesRegex(TargetConfigurationError, "DEV_SUPABASE_URL"):
            resolve_target_environment("development", selected)

    def test_database_project_mismatch_is_rejected(self):
        environment = dict(self.profiles)
        environment["DEV_DATABASE_URL"] = self.profiles["PROD_DATABASE_URL"]

        with self.assertRaisesRegex(TargetConfigurationError, "DATABASE_URL does not identify"):
            resolve_target_environment("development", environment)

    def test_publication_database_project_mismatch_is_rejected(self):
        environment = dict(self.profiles)
        environment["DEV_PUBLICATION_DATABASE_URL"] = self.profiles["PROD_PUBLICATION_DATABASE_URL"]

        with self.assertRaisesRegex(TargetConfigurationError, "PUBLICATION_DATABASE_URL does not identify"):
            resolve_target_environment("development", environment)

    def test_mismatched_bucket_and_partial_r2_settings_are_rejected(self):
        environment = dict(self.profiles)
        environment["DEV_R2_BUCKET"] = BUCKETS["production"]
        with self.assertRaisesRegex(TargetConfigurationError, "R2_BUCKET must be"):
            resolve_target_environment("development", environment)

        environment = dict(self.profiles)
        environment.pop("DEV_R2_SECRET_ACCESS_KEY")
        with self.assertRaisesRegex(TargetConfigurationError, "image origin and both writer credentials"):
            resolve_target_environment("development", environment)

    def test_partial_read_credentials_and_missing_account_are_rejected(self):
        environment = dict(self.profiles)
        environment.pop("DEV_R2_READ_SECRET_ACCESS_KEY")
        with self.assertRaisesRegex(TargetConfigurationError, "both read-only"):
            resolve_target_environment("development", environment)

        environment = dict(self.profiles)
        environment.pop("DEV_R2_ACCOUNT_ID")
        with self.assertRaisesRegex(TargetConfigurationError, "R2_ACCOUNT_ID is required"):
            resolve_target_environment("development", environment)

    def test_publication_certificate_requires_its_database_connection(self):
        environment = dict(self.profiles)
        environment.pop("DEV_PUBLICATION_DATABASE_URL")
        with self.assertRaisesRegex(TargetConfigurationError, "requires PUBLICATION_DATABASE_URL"):
            resolve_target_environment("development", environment)

    def test_generic_ci_environment_is_validated_without_profile_remapping(self):
        environment = {
            "GITHUB_ACTIONS": "true",
            "KARTISERET_TARGET": "development",
            "SUPABASE_URL": f"https://{PROJECT_REFS['development']}.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "dev-service-role",
            "DEV_SUPABASE_URL": "must-not-be-used",
        }
        resolved = resolve_target_environment("development", environment)

        self.assertEqual(resolved["SUPABASE_URL"], environment["SUPABASE_URL"])
        self.assertEqual(resolved["KARTISERET_TARGET"], "development")
        self.assertEqual(resolved["DEV_SUPABASE_URL"], "")

    def test_github_target_must_match_supabase_url(self):
        environment = {
            "GITHUB_ACTIONS": "true",
            "KARTISERET_TARGET": "development",
            "SUPABASE_URL": f"https://{PROJECT_REFS['production']}.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "wrong-project-key",
        }
        with self.assertRaisesRegex(TargetConfigurationError, "selected Supabase project"):
            resolve_target_environment("development", environment)

    def test_target_required_and_schedule_default_production(self):
        with self.assertRaises(TargetConfigurationError):
            resolve_target_environment("staging", {})
        self.assertTrue(is_scheduled({"JJ_INTEL_MAC_DAILY_RUN": "true"}))
        self.assertTrue(is_scheduled({"GITHUB_ACTIONS": "true"}))
        self.assertFalse(is_scheduled({}))


class RunnerTargetSelectionTests(TestCase):
    def setUp(self) -> None:
        self.profiles = {
            **_profile("DEV_", "development"),
            **_profile("PROD_", "production"),
        }

    def test_interactive_target_is_selected_before_run_plan(self):
        order: list[str] = []
        environment = dict(self.profiles)
        with patch.dict(os.environ, environment, clear=True), patch(
            "backend.utils.console.inputMenu.choose_environment_target",
            side_effect=lambda: order.append("target") or "development",
        ), patch.object(
            runner,
            "_select_plan",
            side_effect=lambda: order.append("plan") or ([], None),
        ), patch.object(
            runner, "run_managed_process", return_value=SimpleNamespace(exit_code=0)
        ) as process:
            self.assertEqual(runner.main([]), 0)

        self.assertEqual(order, ["target", "plan"])
        child_environment = process.call_args.kwargs["env"]
        self.assertEqual(child_environment["KARTISERET_TARGET"], "development")
        self.assertEqual(child_environment["R2_BUCKET"], BUCKETS["development"])
        self.assertEqual(child_environment["PROD_R2_SECRET_ACCESS_KEY"], "")

    def test_cli_target_overrides_scheduled_production_default(self):
        environment = {**self.profiles, "JJ_INTEL_MAC_DAILY_RUN": "true"}
        with patch.dict(os.environ, environment, clear=True), patch.object(
            runner, "_select_plan", return_value=([], None)
        ), patch.object(
            runner, "run_managed_process", return_value=SimpleNamespace(exit_code=0)
        ) as process:
            self.assertEqual(runner.main(["--target", "development"]), 0)

        self.assertEqual(
            process.call_args.kwargs["env"]["SUPABASE_URL"],
            f"https://{PROJECT_REFS['development']}.supabase.co",
        )

    def test_scheduled_run_defaults_to_production_without_prompt(self):
        environment = {**self.profiles, "JJ_INTEL_MAC_WEEKLY_RUN": "true"}
        with patch.dict(os.environ, environment, clear=True), patch(
            "backend.utils.console.inputMenu.choose_environment_target"
        ) as prompt:
            target, selected = runner._select_target()

        self.assertEqual(target, "production")
        self.assertEqual(selected["R2_BUCKET"], BUCKETS["production"])
        prompt.assert_not_called()

    def test_environment_target_is_used_for_scheduled_run(self):
        environment = {
            **self.profiles,
            "JJ_INTEL_MAC_DAILY_RUN": "true",
            "KARTISERET_TARGET": "development",
        }
        with patch.dict(os.environ, environment, clear=True):
            target, selected = runner._select_target()

        self.assertEqual(target, "development")
        self.assertEqual(selected["R2_BUCKET"], BUCKETS["development"])

    def test_github_target_conflict_with_cli_is_rejected(self):
        environment = {
            **self.profiles,
            "GITHUB_ACTIONS": "true",
            "KARTISERET_TARGET": "production",
            "SUPABASE_URL": f"https://{PROJECT_REFS['production']}.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "production-key",
        }
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesRegex(TargetConfigurationError, "conflicts with the GitHub Actions target"):
                runner._select_target("development")

