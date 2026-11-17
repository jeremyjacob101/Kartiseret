import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from unittest import TestCase, skipUnless


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "backend/config/realtime/start_realtime_watcher_background.sh"
ZSH = shutil.which("zsh")


@skipUnless(ZSH, "zsh is not installed")
class RealtimeLauncherTests(TestCase):
    def test_help_and_status_do_not_require_uv_or_python_overrides(self):
        with tempfile.TemporaryDirectory() as temporary:
            environment = {
                **os.environ,
                "PROJECT": temporary,
                "KARTISERET_UV": str(Path(temporary) / "missing-uv"),
                "KARTISERET_PYTHON": "retired-python-override",
            }
            help_result = subprocess.run(
                [ZSH, str(SCRIPT), "--help"],
                cwd=ROOT,
                env=environment,
                capture_output=True,
                text=True,
                timeout=10,
            )
            status_result = subprocess.run(
                [ZSH, str(SCRIPT), "--status"],
                cwd=ROOT,
                env=environment,
                capture_output=True,
                text=True,
                timeout=10,
            )

        self.assertEqual(help_result.returncode, 0, help_result.stderr)
        self.assertIn("--status", help_result.stdout)
        self.assertEqual(status_result.returncode, 0, status_result.stderr)
        self.assertIn("No realtime watcher process recorded", status_result.stdout)
        self.assertNotIn("uv is required", help_result.stderr + status_result.stderr)
