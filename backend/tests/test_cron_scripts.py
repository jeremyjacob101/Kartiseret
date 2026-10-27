import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from unittest import TestCase


CRON_DIR = Path(__file__).resolve().parents[1] / "config" / "cron"


class CronScriptTests(TestCase):
    def git(self, *args, cwd):
        return subprocess.run(
            ["git", *args], cwd=cwd, check=True, capture_output=True, text=True
        ).stdout.strip()

    def run_cron(self, directory, kind, status, *, failure=None):
        """Run the actual shell script against a disposable repo and bare remote."""
        root = directory / "checkout"
        remote = directory / "origin.git"
        root.mkdir()
        self.git("init", "--bare", str(remote), cwd=directory)
        self.git("init", "-b", "main", cwd=root)
        self.git("config", "user.name", "Cron Test", cwd=root)
        self.git("config", "user.email", "cron@example.invalid", cwd=root)
        runner = root / "runner_fixture"
        runner.write_text(
            "#!/bin/bash\n"
            "mkdir -p backend/utils/log/logger_artifacts\n"
            "echo failed-or-successful-run > backend/utils/log/logger_artifacts/result.txt\n"
            "printf '%s\\n' \"$@\" > backend/utils/log/logger_artifacts/arguments.txt\n"
            "echo runner-stdout\n"
            "echo runner-stderr >&2\n"
            "exit \"$CRON_TEST_STATUS\"\n"
        )
        runner.chmod(0o755)
        self.git("add", ".", cwd=root)
        self.git("commit", "-m", "Initial fixture", cwd=root)
        self.git("remote", "add", "origin", str(remote), cwd=root)
        self.git("push", "origin", "main", cwd=root)
        initial = self.git("rev-parse", "HEAD", cwd=root)

        script = directory / "run.sh"
        source = (CRON_DIR / f"run_{kind}.sh").read_text()
        source = source.replace(
            'PROJECT_ROOT="/Users/jeremyjacob/Documents/Coding Projects/Kartiseret/NewScraping-August2025"',
            f"PROJECT_ROOT={json.dumps(str(root))}",
        ).replace('PYTHON="$PROJECT_ROOT/.venv/bin/python"', 'PYTHON="$PROJECT_ROOT/runner_fixture"')
        if failure == "sync":
            self.git("remote", "set-url", "origin", str(directory / "missing.git"), cwd=root)
        elif failure in ("commit", "push"):
            hook = (root / ".git" / "hooks" / "pre-commit") if failure == "commit" else (remote / "hooks" / "pre-receive")
            hook.write_text("#!/bin/sh\nexit 1\n")
            hook.chmod(0o755)
        elif failure == "tee":
            # Fail the runner's tee after the sync log was written successfully.
            bin_dir = directory / "bin"
            bin_dir.mkdir()
            tee = bin_dir / "tee"
            tee.write_text(f'#!/bin/sh\nif [ "$1" = "-a" ]; then cat >/dev/null; exit 73; fi\nexec {shutil.which("tee")} "$@"\n')
            tee.chmod(0o755)
            source = source.replace('export PATH="', f'export PATH="{bin_dir}:', 1)
        script.write_text(source)
        result = subprocess.run(
            ["/bin/bash", str(script), "argument with spaces"],
            cwd=directory,
            env={**os.environ, "CRON_TEST_STATUS": str(status), "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull},
            capture_output=True,
            text=True,
            timeout=30,
        )
        return root, remote, initial, result

    def test_runner_outcome_is_preserved_after_completed_log_and_artifacts_are_pushed(self):
        for kind in ("daily", "weekly"):
            for status in (0, 1, 124):
                with self.subTest(kind=kind, status=status), tempfile.TemporaryDirectory() as temp:
                    root, remote, initial, result = self.run_cron(Path(temp), kind, status)
                    self.assertEqual(result.returncode, status, result.stdout + result.stderr)
                    published = self.git("rev-parse", "main", cwd=remote)
                    self.assertNotEqual(published, initial)
                    self.assertEqual(published, self.git("rev-parse", "HEAD", cwd=root))
                    message = self.git("log", "-1", "--format=%s", "main", cwd=remote)
                    self.assertIn(f"runner exit {status}", message)
                    log_dir = root / "backend" / "config" / "cron" / f"run_{kind}_logs"
                    log = next(log_dir.glob("*.log"))
                    pushed_log = self.git("show", f"main:{log.relative_to(root)}", cwd=remote)
                    self.assertEqual(pushed_log, log.read_text().strip())
                    self.assertIn("runner-stdout", pushed_log)
                    self.assertIn("runner-stderr", pushed_log)
                    self.assertIn(f"(runner exit {status}) ====", pushed_log)
                    artifact = "backend/utils/log/logger_artifacts/arguments.txt"
                    self.assertEqual(
                        self.git("show", f"main:{artifact}", cwd=remote).splitlines(),
                        ["-u", "-m", "backend.config.runner", "argument with spaces"],
                    )
                    self.assertEqual(self.git("status", "--porcelain", cwd=root), "")

    def test_sync_logging_and_publication_errors_remain_fatal(self):
        for kind in ("daily", "weekly"):
            for failure in ("sync", "tee", "commit", "push"):
                with self.subTest(kind=kind, failure=failure), tempfile.TemporaryDirectory() as temp:
                    root, remote, initial, result = self.run_cron(Path(temp), kind, 0, failure=failure)
                    self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertEqual(self.git("rev-parse", "main", cwd=remote), initial)
                    if failure == "sync":
                        self.assertNotIn("runner-stdout", result.stdout)
                        self.assertFalse((root / "backend/utils/log/logger_artifacts").exists())
                    elif failure == "tee":
                        self.assertEqual(result.returncode, 73)
                        self.assertEqual(self.git("rev-parse", "HEAD", cwd=root), initial)
