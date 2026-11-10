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
        """Run the actual wrapper against a disposable checkout and bare remote."""
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
            "if [[ \"$1\" == \"-m\" && \"$2\" == \"pip\" ]]; then\n"
            "  printf 'pip\\n' >> \"$CRON_TEST_PYTHON_CALLS\"\n"
            "  exit \"${CRON_TEST_PIP_STATUS:-0}\"\n"
            "fi\n"
            "if [[ \"$1\" == \"-u\" ]]; then\n"
            "  printf 'runner\\n' >> \"$CRON_TEST_PYTHON_CALLS\"\n"
            "  printf '42\\n' > \"$KARTISER_RUN_ID_FILE\"\n"
            "  echo runner-stdout\n"
            "  echo runner-stderr >&2\n"
            "  exit \"$CRON_TEST_STATUS\"\n"
            "fi\n"
            "if [[ \"$1\" == \"-m\" && \"$2\" == \"backend.config.upload_cron_log\" ]]; then\n"
            "  while [[ $# -gt 0 ]]; do\n"
            "    if [[ \"$1\" == \"--path\" ]]; then cp \"$2\" \"$CRON_TEST_UPLOADED_LOG\"; rm -f \"$2\"; fi\n"
            "    if [[ \"$1\" == \"--run-id-file\" ]]; then rm -f \"$2\"; fi\n"
            "    shift\n"
            "  done\n"
            "  exit \"${CRON_TEST_UPLOAD_STATUS:-0}\"\n"
            "fi\n"
            "exit 99\n"
        )
        runner.chmod(0o755)
        (root / "requirements.txt").write_text("# cron script fixture\n")
        self.git("add", ".", cwd=root)
        self.git("commit", "-m", "Initial fixture", cwd=root)
        self.git("remote", "add", "origin", str(remote), cwd=root)
        self.git("push", "origin", "main", cwd=root)
        initial = self.git("rev-parse", "HEAD", cwd=root)

        script = directory / "run.sh"
        source = (CRON_DIR / f"run_{kind}.sh").read_text()
        source = source.replace(
            'PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"',
            f'PROJECT_ROOT="{root}"',
        ).replace(
            'PYTHON="${KARTISERET_PYTHON:-$PROJECT_ROOT/.venv/bin/python}"',
            'PYTHON="$PROJECT_ROOT/runner_fixture"',
        )
        if failure == "sync":
            self.git("remote", "set-url", "origin", str(directory / "missing.git"), cwd=root)
        elif failure == "tee":
            bin_dir = directory / "bin"
            bin_dir.mkdir()
            tee = bin_dir / "tee"
            tee.write_text(
                f'#!/bin/sh\nif [ "$1" = "-a" ]; then cat >/dev/null; exit 73; fi\nexec {shutil.which("tee")} "$@"\n'
            )
            tee.chmod(0o755)
            source = source.replace('export PATH="', f'export PATH="{bin_dir}:', 1)
        script.write_text(source)
        recovery = directory / "recovery"
        upload_copy = directory / "uploaded.log"
        result = subprocess.run(
            ["/bin/bash", str(script), "argument with spaces"],
            cwd=directory,
            env={
                **os.environ,
                "HOME": str(directory),
                "KARTISERET_RECOVERY_ROOT": str(recovery),
                "CRON_TEST_STATUS": str(status),
                "CRON_TEST_PYTHON_CALLS": str(directory / "python-calls.log"),
                "CRON_TEST_UPLOADED_LOG": str(upload_copy),
                "GIT_CONFIG_NOSYSTEM": "1",
                "GIT_CONFIG_GLOBAL": os.devnull,
            },
            capture_output=True,
            text=True,
            timeout=30,
        )
        return root, remote, initial, result, recovery, upload_copy

    def test_runs_upload_transcript_and_never_commit_or_push_run_output(self):
        for kind in ("daily", "weekly"):
            for status in (0, 1, 124):
                with self.subTest(kind=kind, status=status), tempfile.TemporaryDirectory() as temp:
                    root, remote, initial, result, recovery, uploaded = self.run_cron(Path(temp), kind, status)
                    self.assertEqual(result.returncode, status, result.stdout + result.stderr)
                    self.assertEqual(self.git("rev-parse", "main", cwd=remote), initial)
                    self.assertEqual(self.git("rev-parse", "HEAD", cwd=root), initial)
                    self.assertEqual(self.git("status", "--porcelain", cwd=root), "")
                    self.assertEqual(
                        (Path(temp) / "python-calls.log").read_text().splitlines(),
                        ["runner"],
                    )
                    transcript = uploaded.read_text()
                    self.assertIn("runner-stdout", transcript)
                    self.assertIn("runner-stderr", transcript)
                    self.assertIn(f"runner exit {status}", transcript)
                    self.assertFalse(recovery.exists() and list(recovery.rglob("*.log")))

    def test_code_sync_and_storage_failures_keep_local_output_and_do_not_publish_git(self):
        for kind in ("daily", "weekly"):
            for failure in ("sync", "tee"):
                with self.subTest(kind=kind, failure=failure), tempfile.TemporaryDirectory() as temp:
                    root, remote, initial, result, recovery, _uploaded = self.run_cron(Path(temp), kind, 0, failure=failure)
                    self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertEqual(self.git("rev-parse", "main", cwd=remote), initial)
                    self.assertEqual(self.git("rev-parse", "HEAD", cwd=root), initial)
                    if failure == "sync":
                        self.assertNotIn("runner-stdout", result.stdout)
                    else:
                        self.assertEqual(result.returncode, 73)
