from __future__ import annotations

from unittest import TestCase

from backend.config.realtime.launch_realtime_watcher import selected_environment
from backend.config.target_environment import BUCKETS, D1_DATABASE_IDS, PROJECT_REFS, RUN_ARTIFACT_BUCKETS


def profile(prefix: str, target: str) -> dict[str, str]:
    ref = PROJECT_REFS[target]
    return {
        f"{prefix}SUPABASE_URL": f"https://{ref}.supabase.co",
        f"{prefix}SUPABASE_SERVICE_ROLE_KEY": f"service-{target}",
        f"{prefix}SUPABASE_PUBLISHABLE_KEY": f"publishable-{target}",
        f"{prefix}R2_BUCKET": BUCKETS[target],
        f"{prefix}R2_READ_ACCESS_KEY_ID": f"artwork-read-{target}",
        f"{prefix}R2_READ_SECRET_ACCESS_KEY": f"artwork-read-secret-{target}",
        f"{prefix}D1_DATABASE_ID": D1_DATABASE_IDS[target] or "12345678-1234-4234-8234-123456789abc",
        f"{prefix}D1_API_TOKEN": f"d1-api-token-{target}-with-at-least-32-characters",
        f"{prefix}RUN_ARTIFACTS_R2_BUCKET": RUN_ARTIFACT_BUCKETS[target],
        f"{prefix}RUN_ARTIFACTS_R2_ACCESS_KEY_ID": f"run-write-{target}",
        f"{prefix}RUN_ARTIFACTS_R2_SECRET_ACCESS_KEY": f"run-write-secret-{target}",
    }


class RealtimeTargetTests(TestCase):
    def test_headless_watcher_defaults_to_production_and_pairs_storage(self):
        source = {**profile("DEV_", "development"), **profile("PROD_", "production"), "R2_ACCOUNT_ID": "a" * 32}
        target, resolved = selected_environment(None, source)
        self.assertEqual(target, "production")
        self.assertEqual(resolved["SUPABASE_URL"], f"https://{PROJECT_REFS['production']}.supabase.co")
        self.assertEqual(resolved["RUN_ARTIFACTS_R2_BUCKET"], RUN_ARTIFACT_BUCKETS["production"])
        self.assertEqual(resolved["D1_API_TOKEN"], "d1-api-token-production-with-at-least-32-characters")

    def test_explicit_development_target_never_inherits_production_secrets(self):
        source = {**profile("DEV_", "development"), **profile("PROD_", "production"), "R2_ACCOUNT_ID": "a" * 32}
        target, resolved = selected_environment("development", source)
        self.assertEqual(target, "development")
        self.assertEqual(resolved["SUPABASE_URL"], f"https://{PROJECT_REFS['development']}.supabase.co")
        self.assertEqual(resolved["RUN_ARTIFACTS_R2_BUCKET"], RUN_ARTIFACT_BUCKETS["development"])
        self.assertEqual(resolved["D1_API_TOKEN"], "d1-api-token-development-with-at-least-32-characters")
        self.assertEqual(resolved["PROD_SUPABASE_SERVICE_ROLE_KEY"], "")


if __name__ == "__main__":
    import unittest

    unittest.main()
