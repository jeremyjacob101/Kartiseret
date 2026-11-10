import os
import subprocess
import sys
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from backend.config import runner


class RunnerDependencyTests(TestCase):
    def test_installs_with_current_interpreter_and_absolute_requirements(self):
        with patch.object(runner.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as install:
            self.assertEqual(runner._install_requirements(), 0)
        command = install.call_args.args[0]
        self.assertEqual(command[:4], [sys.executable, "-m", "pip", "install"])
        self.assertEqual(command[-2:], ["-r", str(runner.PROJECT_ROOT / "requirements.txt")])
        self.assertNotIn("--upgrade", command)
        self.assertEqual(install.call_args.kwargs["cwd"], runner.PROJECT_ROOT)
        self.assertEqual(install.call_args.kwargs["stdin"], subprocess.DEVNULL)
        self.assertEqual(install.call_args.kwargs["timeout"], 600)

    def test_install_failure_stops_before_target_selection_or_worker(self):
        with patch.object(runner.subprocess, "run", return_value=SimpleNamespace(returncode=23)), patch.object(
            runner, "_select_target"
        ) as select_target:
            self.assertEqual(runner.main(["--target", "production"]), 23)
        select_target.assert_not_called()

    def test_timeout_and_unavailable_pip_process_stop_the_runner(self):
        for error in (OSError("cannot start pip"), subprocess.TimeoutExpired("pip", 600)):
            with self.subTest(error=type(error).__name__), patch.object(
                runner.subprocess, "run", side_effect=error
            ), patch.object(runner, "_select_target") as select_target:
                self.assertEqual(runner.main([]), 1)
                select_target.assert_not_called()

    def test_install_precedes_dotenv_target_plan_and_worker(self):
        order = []
        with patch.dict(os.environ, {}, clear=True), patch.object(
            runner, "_install_requirements", side_effect=lambda: order.append("install") or 0
        ), patch("dotenv.load_dotenv", side_effect=lambda *_args: order.append("dotenv")), patch.object(
            runner, "_select_target", side_effect=lambda *_args: order.append("target") or ("development", {})
        ), patch.object(
            runner, "_select_plan", side_effect=lambda: order.append("plan") or ([], None)
        ), patch(
            "backend.config.job_supervisor.run_managed_process",
            side_effect=lambda *_args, **_kwargs: order.append("worker") or SimpleNamespace(exit_code=0),
        ):
            self.assertEqual(runner.main([]), 0)
        self.assertEqual(order, ["install", "dotenv", "target", "plan", "worker"])

    def test_bootstrap_imports_without_any_site_packages(self):
        # -S excludes site-packages: neither dotenv nor requests is available.
        script = (
            "from unittest.mock import patch; from types import SimpleNamespace; "
            "from backend.config import runner; "
            "installer = patch.object(runner.subprocess, 'run', return_value=SimpleNamespace(returncode=23)); "
            "installer.start(); raise SystemExit(runner.main(['--target', 'production']))"
        )
        result = subprocess.run(
            [sys.executable, "-S", "-c", script], cwd=runner.PROJECT_ROOT,
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 23, result.stdout + result.stderr)
        self.assertIn("pipeline was not started", result.stderr)

    def test_help_works_without_installing_packages(self):
        result = subprocess.run(
            [sys.executable, "-S", "-m", "backend.config.runner", "--help"],
            cwd=runner.PROJECT_ROOT, capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--target", result.stdout)
        self.assertNotIn("Checking Python dependencies", result.stdout)
