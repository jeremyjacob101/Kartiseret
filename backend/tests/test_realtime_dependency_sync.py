import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from backend.config.realtime import realtime_watcher


class RealtimeDependencySyncTests(TestCase):
    def test_dependency_change_after_git_pull_skips_solo_update(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "pyproject.toml").write_text("[project]\nname='fixture'\n")
            (root / "uv.lock").write_text("version = 1\n")
            (root / ".python-version").write_text("3.14.2\n")
            with patch.object(realtime_watcher, "PROJECT_ROOT", root):
                startup_fingerprint = realtime_watcher._dependency_fingerprint()

            def git_command(args, *, cwd, logger):
                if args[:2] == ["git", "pull"]:
                    (root / "uv.lock").write_text("version = 2\n")
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            with patch.object(realtime_watcher, "PROJECT_ROOT", root), patch.object(
                realtime_watcher,
                "STARTUP_DEPENDENCY_FINGERPRINT",
                startup_fingerprint,
            ), patch.object(realtime_watcher, "REALTIME_GIT_SYNC", True), patch.dict(
                os.environ,
                {"KARTISERET_STARTUP_DEPENDENCY_FINGERPRINT": startup_fingerprint},
                clear=False,
            ), patch.object(
                realtime_watcher, "_run_cmd", side_effect=git_command
            ) as run_command:
                self.assertFalse(
                    realtime_watcher._git_sync_before_update(
                        realtime_watcher.logging.getLogger("test.realtime")
                    )
                )
            self.assertEqual(run_command.call_count, 4)
