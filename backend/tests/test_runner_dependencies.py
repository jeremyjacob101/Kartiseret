import os
import subprocess
import sys
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from backend.config import runner


class RunnerDependencyTests(TestCase):
    def test_prepared_runner_starts_worker_without_installing_packages(self):
        order = []
        with patch.dict(os.environ, {}, clear=True), patch(
            "dotenv.load_dotenv", side_effect=lambda *_args: order.append("dotenv")
        ), patch.object(
            runner,
            "_select_target",
            side_effect=lambda *_args: order.append("target") or ("development", {}),
        ), patch.object(
            runner,
            "_select_plan",
            side_effect=lambda: order.append("plan") or ([], None),
        ), patch(
            "backend.config.job_supervisor.run_managed_process",
            side_effect=lambda command, **_kwargs: order.append(("worker", command))
            or SimpleNamespace(exit_code=0, run_id=None),
        ) as worker:
            self.assertEqual(runner.main(["--target", "production"]), 0)

        self.assertEqual([entry if isinstance(entry, str) else entry[0] for entry in order], [
            "dotenv",
            "target",
            "plan",
            "worker",
        ])
        self.assertEqual(
            worker.call_args.args[0],
            [sys.executable, "-m", "backend.config.runner_worker"],
        )
        self.assertFalse(hasattr(runner, "_install_requirements"))

    def test_worker_failure_exit_code_is_preserved(self):
        with patch.dict(os.environ, {}, clear=True), patch(
            "dotenv.load_dotenv"
        ), patch.object(
            runner, "_select_target", return_value=("development", {})
        ), patch.object(runner, "_select_plan", return_value=([], None)), patch(
            "backend.config.job_supervisor.run_managed_process",
            return_value=SimpleNamespace(exit_code=23, run_id=None),
        ):
            self.assertEqual(runner.main(["--target", "production"]), 23)

    def test_bootstrap_module_imports_without_site_packages_for_help(self):
        result = subprocess.run(
            [sys.executable, "-S", "-m", "backend.config.runner", "--help"],
            cwd=runner.PROJECT_ROOT,
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--target", result.stdout)
        self.assertNotIn("requirements.txt", result.stdout)
        self.assertNotIn("pip install", result.stdout)
