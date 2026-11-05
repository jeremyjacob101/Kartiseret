from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event, Thread
from unittest import TestCase
from unittest.mock import Mock, call, patch
import json
import os
import signal
import sys
import time
from types import SimpleNamespace
from pathlib import Path as PathClass

from backend.config.job_supervisor import run_managed_process
from backend.config.runner import _serialize_plan
from backend.config.runner_worker import _decode_plan
from backend.config import runner_worker


class JobSupervisorTests(TestCase):
    def test_unconfirmed_process_shutdown_never_releases_remote_lock(self):
        from backend.config import job_supervisor
        original_stop = job_supervisor._stop_process_group

        def stop_but_report_unconfirmed(*args, **kwargs):
            original_stop(*args, **kwargs)
            return False

        code = "import os,json,time; os.write(int(os.environ['KARTISERET_JOB_CONTROL_FD']), (json.dumps({'event':'run_id','run_id':42})+'\\n').encode()); time.sleep(60)"
        with patch.object(job_supervisor, "_stop_process_group", side_effect=stop_but_report_unconfirmed), patch.object(
            job_supervisor, "_finalize_run_lock"
        ) as finalize, patch.object(job_supervisor, "_record_interrupted_run"):
            outcome = run_managed_process([sys.executable, "-c", code], seconds=0.3, grace_seconds=0.5)
        self.assertEqual(outcome.reason, "child_reap_timeout")
        finalize.assert_not_called()

    def test_job_and_shutdown_limits_cannot_outlive_the_lease(self):
        from backend.config.job_supervisor import job_seconds, termination_grace_seconds, run_managed_process

        with patch.dict(os.environ, {"PIPELINE_JOB_DEADLINE_SECONDS": "16201"}):
            with self.assertRaises(ValueError):
                job_seconds()
        with patch.dict(os.environ, {"PIPELINE_TERMINATION_GRACE_SECONDS": "301"}):
            with self.assertRaises(ValueError):
                termination_grace_seconds()
        self.assertEqual(run_managed_process([sys.executable], seconds=16201).reason, "invalid_budget")
        self.assertEqual(run_managed_process([sys.executable], seconds=1, grace_seconds=301).reason, "invalid_budget")

    @staticmethod
    def _assert_pid_stopped(test: TestCase, pid: int) -> None:
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                return
            # Linux can briefly expose a dead orphan as a zombie until init reaps it.
            stat = Path(f"/proc/{pid}/stat")
            if stat.exists() and stat.read_text().split()[2] == "Z":
                return
            time.sleep(0.01)
        test.fail(f"supervised process {pid} remained alive after termination")

    def test_deadline_kills_blocked_network_and_executor_shutdown(self):
        cases = {
            "blocked DNS": """
import os, socket, threading
from pathlib import Path
Path(os.environ['SUPERVISOR_TEST_PID_FILE']).write_text(str(os.getpid()))
socket.getaddrinfo = lambda *args, **kwargs: threading.Event().wait(60)
socket.getaddrinfo('deliberately-blocked.invalid', 80)
""",
            "executor shutdown": """
import os, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
Path(os.environ['SUPERVISOR_TEST_PID_FILE']).write_text(str(os.getpid()))
with ThreadPoolExecutor(max_workers=1) as executor:
    executor.submit(time.sleep, 60)
""",
        }
        for name, code in cases.items():
            with self.subTest(name=name), TemporaryDirectory() as directory:
                marker = Path(directory) / "worker.pid"
                started = time.monotonic()
                outcome = run_managed_process(
                    [sys.executable, "-c", code],
                    seconds=0.4,
                    grace_seconds=0.4,
                    env={"SUPERVISOR_TEST_PID_FILE": str(marker)},
                    cwd=directory,
                )
                elapsed = time.monotonic() - started
                self.assertEqual(outcome.reason, "deadline_exceeded")
                self.assertEqual(outcome.exit_code, 124)
                self.assertLess(elapsed, 1.5)
                self._assert_pid_stopped(self, int(marker.read_text()))

    def test_deadline_kills_descendants_that_ignore_termination(self):
        with TemporaryDirectory() as directory:
            parent_pid_file = Path(directory) / "parent.pid"
            descendant_pid_file = Path(directory) / "descendant.pid"
            descendant = "import os, signal, time; from pathlib import Path; Path(os.environ['SUPERVISOR_TEST_DESCENDANT_PID_FILE']).write_text(str(os.getpid())); signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(60)"
            code = f"""
import os, subprocess, sys, time
from pathlib import Path
descendant = {descendant!r}
subprocess.Popen([sys.executable, '-c', descendant])
Path(os.environ['SUPERVISOR_TEST_PID_FILE']).write_text(str(os.getpid()))
deadline = time.monotonic() + 2
while not Path(os.environ['SUPERVISOR_TEST_DESCENDANT_PID_FILE']).exists() and time.monotonic() < deadline:
    time.sleep(0.01)
time.sleep(60)
"""
            outcome = run_managed_process(
                [sys.executable, "-c", code],
                seconds=0.5,
                grace_seconds=0.5,
                env={
                    "SUPERVISOR_TEST_PID_FILE": str(parent_pid_file),
                    "SUPERVISOR_TEST_DESCENDANT_PID_FILE": str(descendant_pid_file),
                },
                cwd=directory,
            )
            self.assertEqual(outcome.reason, "deadline_exceeded")
            self._assert_pid_stopped(self, int(parent_pid_file.read_text()))
            descendant_pid = int(descendant_pid_file.read_text())
            self._assert_pid_stopped(self, descendant_pid)

    def test_cancellation_stops_and_reaps_the_owned_process_group(self):
        with TemporaryDirectory() as directory:
            marker = Path(directory) / "worker.pid"
            cancel = Event()
            code = """
import os, time
from pathlib import Path
Path(os.environ['SUPERVISOR_TEST_PID_FILE']).write_text(str(os.getpid()))
time.sleep(60)
"""
            with ThreadPoolExecutor(max_workers=1) as pool:
                result = pool.submit(
                    run_managed_process,
                    [sys.executable, "-c", code],
                    seconds=10,
                    grace_seconds=0.6,
                    env={"SUPERVISOR_TEST_PID_FILE": str(marker)},
                    cwd=directory,
                    cancel_event=cancel,
                )
                deadline = time.monotonic() + 3
                while not marker.exists() and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertTrue(marker.exists(), "worker did not start")
                cancel.set()
                outcome = result.result(timeout=3)
            self.assertEqual(outcome.reason, "cancelled")
            self.assertEqual(outcome.exit_code, 130)
            self._assert_pid_stopped(self, int(marker.read_text()))

    def test_parent_sigterm_cancels_the_worker(self):
        with TemporaryDirectory() as directory:
            marker = Path(directory) / "worker.pid"
            code = """
import os, time
from pathlib import Path
Path(os.environ['SUPERVISOR_TEST_PID_FILE']).write_text(str(os.getpid()))
time.sleep(60)
"""

            def stop_parent_after_worker_starts():
                deadline = time.monotonic() + 3
                while not marker.exists() and time.monotonic() < deadline:
                    time.sleep(0.01)
                if marker.exists():
                    os.kill(os.getpid(), signal.SIGTERM)

            stopper = Thread(target=stop_parent_after_worker_starts)
            stopper.start()
            outcome = run_managed_process(
                [sys.executable, "-c", code],
                seconds=10,
                grace_seconds=0.6,
                env={"SUPERVISOR_TEST_PID_FILE": str(marker)},
                cwd=directory,
            )
            stopper.join(timeout=2)
            self.assertFalse(stopper.is_alive())
            self.assertEqual(outcome.reason, "cancelled")
            self._assert_pid_stopped(self, int(marker.read_text()))

    def test_timed_out_run_is_marked_failed_and_lock_cleanup_is_attempted(self):
        with TemporaryDirectory() as directory:
            marker = Path(directory) / "worker.pid"
            code = """
import json, os, time
from pathlib import Path
Path(os.environ['SUPERVISOR_TEST_PID_FILE']).write_text(str(os.getpid()))
fd = int(os.environ['KARTISERET_JOB_CONTROL_FD'])
event = {'event': 'run_id', 'run_id': 987654321}
os.write(fd, (json.dumps(event) + '\\n').encode())
time.sleep(60)
"""
            recovery_root = Path(directory) / "recovery"
            with patch.dict(os.environ, {"KARTISERET_RECOVERY_ROOT": str(recovery_root)}), patch(
                "backend.config.job_supervisor._finalize_run_lock", return_value=True
            ) as finalizer:
                outcome = run_managed_process(
                    [sys.executable, "-c", code],
                    seconds=0.4,
                    grace_seconds=1,
                    env={"SUPERVISOR_TEST_PID_FILE": str(marker)},
                    cwd=directory,
                )
            self.assertEqual(outcome.reason, "deadline_exceeded")
            self.assertEqual(outcome.run_id, 987654321)
            self.assertTrue(outcome.remote_finalized)
            finalizer.assert_called_once()
            outcome_files = list((recovery_root / "supervisor_outcomes").glob("987654321.json"))
            self.assertEqual(len(outcome_files), 1)
            record = json.loads(outcome_files[0].read_text())
            self.assertEqual(record["state"], "deadline_exceeded")
            self.assertIn("unknown", record["remote_write_outcome"])
            self.assertFalse((Path(directory) / "backend/utils/log/logger_artifacts").exists())
            self._assert_pid_stopped(self, int(marker.read_text()))

    def test_normal_completion_and_startup_failure_are_reported(self):
        code = """
import json, os
event = {'event': 'run_complete', 'successful': True}
os.write(int(os.environ['KARTISERET_JOB_CONTROL_FD']), (json.dumps(event) + '\\n').encode())
"""
        success = run_managed_process([sys.executable, "-c", code], seconds=2, grace_seconds=0.3)
        self.assertIsNone(success.reason)
        self.assertEqual(success.exit_code, 0)
        self.assertTrue(success.successful)

        false_result_code = """
import json, os
event = {'event': 'run_complete', 'successful': False}
os.write(int(os.environ['KARTISERET_JOB_CONTROL_FD']), (json.dumps(event) + '\\n').encode())
"""
        completed_unsuccessfully = run_managed_process([sys.executable, "-c", false_result_code], seconds=2, grace_seconds=0.3)
        self.assertEqual(completed_unsuccessfully.reason, "run_failed")
        self.assertEqual(completed_unsuccessfully.exit_code, 1)
        self.assertFalse(completed_unsuccessfully.successful)

        startup = run_managed_process(["/path/that/does/not/exist"], seconds=2, grace_seconds=0.3)
        self.assertEqual(startup.reason, "startup_failed")
        self.assertEqual(startup.exit_code, 125)

    def test_interactive_plan_round_trip_preserves_custom_class_selections(self):
        plan = [("cinema", "allSoons", [PathClass]), ("dataflow", "nowPlayingData", [])]
        self.assertEqual(_decode_plan(_serialize_plan(plan)), plan)

    def test_worker_exits_nonzero_after_any_pipeline_step_fails(self):
        class FakeRunLogSession:
            def __init__(self, on_allocated=None):
                self.run_id = 41
                self.on_allocated = on_allocated

            def __enter__(self):
                if self.on_allocated:
                    self.on_allocated(self.run_id)
                return self

            def __exit__(self, *_args):
                return False

            def set_plan(self, _plan):
                pass

            def set_successful(self, _successful):
                pass

        with patch.dict(os.environ, {"KARTISERET_RUN_PLAN_JSON": "[]"}), patch(
            "backend.config.runners.runPlan", return_value=False
        ), patch("backend.utils.log.artifact_logging.setup_logging"), patch(
            "backend.utils.log.run_logging.RunLogSession", FakeRunLogSession
        ), patch("backend.config.runner_worker.report_event") as report_event:
            exit_code = runner_worker.main()

        self.assertEqual(exit_code, 1)
        report_event.assert_has_calls([
            call("run_id", run_id=41),
            call("run_complete", successful=False),
        ])

    def test_r2_budget_failure_bypasses_best_effort_artifact_reporting(self):
        from backend.config.runners import _run_attempt
        from backend.utils.log.r2_budget import R2BudgetExceeded

        spec = SimpleNamespace(
            make_instance=lambda *_args: SimpleNamespace(),
            run_instance=Mock(side_effect=R2BudgetExceeded("Class A budget reached")),
            cleanup=Mock(side_effect=RuntimeError("cleanup failed")),
        )
        with patch("backend.config.runners.artifactPrinting") as report:
            with self.assertRaisesRegex(R2BudgetExceeded, "Class A budget reached"):
                _run_attempt(spec, object, "test", 7, 1)
        report.assert_not_called()
        spec.cleanup.assert_called_once()

    def test_base_dataflow_does_not_flush_summary_after_budget_failure(self):
        from backend.dataflow.BaseDataflow import BaseDataflow
        from backend.utils.log.r2_budget import R2BudgetExceeded

        error = R2BudgetExceeded("Class B operation budget reached")
        flow = SimpleNamespace(
            logic=Mock(side_effect=error),
            _publication=None,
            _owns_publication=False,
            MAIN_TABLE_NAME="",
            discardPublicationStage=Mock(),
            flush_summary=Mock(),
            closeDataflowRequests=Mock(),
        )
        with self.assertRaises(R2BudgetExceeded):
            BaseDataflow.dataRun(flow)
        flow.discardPublicationStage.assert_called_once_with()
        flow.flush_summary.assert_not_called()
        flow.closeDataflowRequests.assert_called_once_with()

    def test_shared_dataflow_propagates_budget_failure_after_closing_flows(self):
        from backend.config import runners
        from backend.utils.log.r2_budget import R2BudgetExceeded

        events = []

        class Flow:
            def beginSharedUpdate(self):
                return [{"tmdb_id": 42}]

            def prepareUpdateTmdb(self, _rows):
                self._update_tmdb = {}

            def process_row(self, _row):
                raise R2BudgetExceeded("Class B budget reached")

            def trace_note(self, _message):
                pass

            def discardPublicationStage(self):
                events.append("discard")

            def closeDataflowRequests(self):
                events.append("close")

        flow = Flow()
        fake_class = type("TestUpdate", (), {})
        with patch.dict(runners.dataflowDictionary, {
            "make_instance": lambda *_args: flow,
            "cleanup": lambda _flow: events.append("cleanup"),
        }), self.assertRaisesRegex(R2BudgetExceeded, "Class B budget reached"):
            runners._run_shared_update_round(
                [("test", fake_class)], 42, 1, SimpleNamespace(),
            )
        self.assertEqual(events, ["discard", "cleanup", "close"])

    def test_run_finalization_measures_d1_without_more_r2_after_budget_failure(self):
        from backend.utils.log import run_logging
        from backend.utils.log.r2_budget import R2BudgetExceeded

        storage = Mock()
        client = Mock()
        client.table.return_value.update.return_value.eq.return_value.execute.return_value.data = [{"run_id": 42}]
        session = run_logging.RunLogSession()
        session.run_id = 42
        session._start_time = time.monotonic() - 1
        session._selected_runners = []
        session._successful = False
        session._storage = storage
        session._lease_token = "lease"
        with patch.dict(os.environ, {
            "SUPABASE_URL": "https://example.test",
            "SUPABASE_SERVICE_ROLE_KEY": "test-key",
        }), patch("backend.utils.log.run_logging.create_client", return_value=client):
            session.__exit__(R2BudgetExceeded, R2BudgetExceeded("Class A budget reached"), None)

        storage.d1.measure_database_size.assert_called_once_with()
        storage.check_storage.assert_not_called()
        storage.finalize_run.assert_called_once()
        storage.release_run_lease.assert_called_once_with(token="lease")

    def test_run_id_finalizer_marks_failure_and_releases_running_lock(self):
        from backend.config import supervisor_finalize

        table = Mock()
        client = Mock()
        client.table.return_value = table
        table.update.return_value.eq.return_value.execute.return_value.data = [{"run_id": 42}]
        args = ["supervisor_finalize", "--run-id", "42", "--elapsed-seconds", "123.5"]
        with patch.dict(os.environ, {"SUPABASE_URL": "https://example.test", "SUPABASE_SERVICE_ROLE_KEY": "test-key"}), patch(
            "backend.config.supervisor_finalize.create_client", return_value=client
        ), patch(
            "backend.config.supervisor_finalize.RunArtifactStore"
        ) as store_class, patch.object(sys, "argv", args):
            self.assertEqual(supervisor_finalize.main(), 0)
        table.update.assert_called_once_with({"successful": False, "total_time": 123.5, "running_now": False})
        table.update.return_value.eq.assert_called_once_with("run_id", 42)
        table.update.return_value.eq.return_value.execute.assert_called_once_with()
        store_class.return_value.mark_run_failed.assert_called_once_with(42, reason="supervisor_interrupted")
        store_class.return_value.mark_run_unconfirmed.assert_not_called()

    def test_run_id_finalizer_keeps_d1_status_unconfirmed_when_supabase_is_not_confirmed(self):
        from backend.config import supervisor_finalize

        table = Mock()
        client = Mock()
        client.table.return_value = table
        table.update.return_value.eq.return_value.execute.side_effect = RuntimeError("offline")
        args = ["supervisor_finalize", "--run-id", "43", "--elapsed-seconds", "9"]
        with patch.dict(os.environ, {"SUPABASE_URL": "https://example.test", "SUPABASE_SERVICE_ROLE_KEY": "test-key"}), patch(
            "backend.config.supervisor_finalize.create_client", return_value=client
        ), patch(
            "backend.config.supervisor_finalize.RunArtifactStore"
        ) as store_class, patch(
            "backend.config.supervisor_finalize.write_recovery_envelope"
        ) as recovery, patch.object(sys, "argv", args):
            self.assertEqual(supervisor_finalize.main(), 1)
        store_class.return_value.mark_run_failed.assert_not_called()
        store_class.return_value.mark_run_unconfirmed.assert_called_once_with(
            43, reason="supabase_finalization_unconfirmed"
        )
        recovery.assert_called_once()
        self.assertFalse(recovery.call_args.args[2]["supabase_confirmed"])

    def test_allocated_run_id_is_reported_before_the_run_lock_insert(self):
        from backend.utils.log import run_logging

        with TemporaryDirectory() as directory:
            no_running_run = Mock()
            no_running_run.select.return_value.eq.return_value.limit.return_value.execute.return_value = SimpleNamespace(data=[])
            latest_run = Mock()
            latest_run.select.return_value.order.return_value.limit.return_value.execute.return_value = SimpleNamespace(data=[{"run_id": 41}])
            insert = Mock()
            timeline = []
            insert.insert.side_effect = lambda _row: (timeline.append("insert"), insert)[1]
            insert.insert.return_value.execute.return_value = SimpleNamespace(data=[])
            client = Mock()
            client.table.side_effect = [no_running_run, latest_run, insert]
            callback = lambda run_id: timeline.append(("allocated", run_id))
            storage = Mock()
            with patch.dict(os.environ, {"SUPABASE_URL": "https://example.test", "SUPABASE_SERVICE_ROLE_KEY": "test-key", "KARTISERET_TARGET": "development"}), patch(
                "backend.utils.log.run_logging.create_client", return_value=client
            ), patch("backend.utils.log.run_logging.RunArtifactStore", return_value=storage), patch(
                "backend.utils.log.shared_cleanup.run_pipeline_preflight", return_value={}
            ), patch("backend.config.target_environment.resolve_target_environment", return_value={}):
                self.assertEqual(run_logging.allocate_run_id(on_allocated=callback), 42)
            self.assertEqual(timeline, [("allocated", 42), "insert"])
            storage.acquire_run_lease.assert_called_once_with()
            storage.attach_run_id_to_lease.assert_called_once_with(storage.acquire_run_lease.return_value, 42)
            storage.start_run.assert_called_once()

    def test_failed_d1_start_records_unconfirmed_when_supabase_update_is_empty(self):
        from backend.utils.log import run_logging
        empty = Mock()
        empty.select.return_value.eq.return_value.limit.return_value.execute.return_value = SimpleNamespace(data=[])
        latest = Mock()
        latest.select.return_value.order.return_value.limit.return_value.execute.return_value = SimpleNamespace(data=[{'run_id': 41}])
        insert = Mock()
        finalize = Mock()
        finalize.update.return_value.eq.return_value.execute.return_value = SimpleNamespace(data=[])
        client = Mock()
        client.table.side_effect = [empty, latest, insert, finalize]
        storage = Mock()
        storage.start_run.side_effect = RuntimeError('D1 unavailable')
        with patch.dict(os.environ, {'SUPABASE_URL': 'https://dev.example', 'SUPABASE_SERVICE_ROLE_KEY': 'test', 'KARTISERET_TARGET': 'development'}), patch(
            'backend.utils.log.run_logging.create_client', return_value=client
        ), patch('backend.utils.log.run_logging.RunArtifactStore', return_value=storage), patch(
            'backend.utils.log.run_logging.write_recovery_envelope'
        ) as recovery, patch(
            'backend.utils.log.shared_cleanup.run_pipeline_preflight', return_value={}
        ), patch('backend.config.target_environment.resolve_target_environment', return_value={}):
            with self.assertRaisesRegex(RuntimeError, 'D1 unavailable'):
                run_logging.allocate_run_id()
        self.assertEqual(recovery.call_args.args[2]['status'], 'unconfirmed')
        storage.release_run_lease.assert_called_once()


if __name__ == "__main__":
    import unittest

    unittest.main()
