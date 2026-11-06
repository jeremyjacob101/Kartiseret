from unittest import TestCase
from unittest.mock import Mock, patch

from backend.utils.log.cloudflare_storage import LeaseLostError
from backend.utils.log.job_lease import LeaseSession, before_mutation


class JobLeaseTests(TestCase):
    def test_direct_postgres_publication_checks_ownership_before_sql(self):
        from unittest.mock import MagicMock
        from backend.dataflow.utils.PostgresPublicationPublisher import PostgresPublicationPublisher
        publisher = object.__new__(PostgresPublicationPublisher)
        publisher.test_mode = True
        publisher.database_url = 'postgresql://localhost/test'
        with patch('psycopg.connect', return_value=MagicMock()) as connect, patch(
            'backend.utils.log.job_lease.before_mutation', side_effect=LeaseLostError('lost')
        ):
            with publisher._connect():
                cursor_class = connect.call_args.kwargs['cursor_factory']
                with self.assertRaises(LeaseLostError):
                    cursor_class.execute(object(), 'SELECT publication_commit()')

    def session(self):
        session = LeaseSession(Mock(), 'owner', terminate=Mock())
        session.store = Mock()
        return session

    def test_verification_failure_latches_before_shutdown_and_never_recovers(self):
        session = self.session()
        session.store.verify.side_effect = TimeoutError('uncertain')
        with self.assertRaises(LeaseLostError):
            session.verify()
        self.assertTrue(session.failed.is_set())
        session.terminate.assert_called_once()
        session.store.verify.side_effect = None
        with self.assertRaises(LeaseLostError):
            session.verify()
        session.store.verify.assert_called_once_with('owner')

    def test_heartbeat_renewal_failure_stops_immediately(self):
        session = self.session()
        session.closed.wait = Mock(return_value=False)
        session.store.renew.side_effect = TimeoutError('renewal uncertain')
        session._heartbeat()
        self.assertTrue(session.failed.is_set())
        session.terminate.assert_called_once()

    def test_resumed_or_replaced_owner_cannot_issue_another_mutation(self):
        session = self.session()
        session.store.verify.side_effect = LeaseLostError('expired')
        with patch('backend.utils.log.job_lease._active', session):
            with self.assertRaises(LeaseLostError):
                before_mutation()
        session.terminate.assert_called_once()

    def test_hard_lifetime_cannot_be_extended_by_a_heartbeat(self):
        session = self.session()
        session.deadline = 1
        with self.assertRaises(LeaseLostError):
            session.verify()
        session.store.verify.assert_not_called()
        session.terminate.assert_called_once()

    def test_closed_session_refuses_writes(self):
        session = self.session()
        session.closed.set()
        with self.assertRaises(LeaseLostError):
            session.verify()
        session.store.verify.assert_not_called()

    def test_parent_loss_stops_worker(self):
        session = self.session()
        with patch.dict('os.environ', {'KARTISERET_LEASE_WORKER': 'true'}), patch('os.getppid', return_value=-1):
            with self.assertRaises(LeaseLostError):
                session.verify()
        session.terminate.assert_called_once()

    def test_d1_guard_blocks_the_actual_http_send(self):
        from backend.utils.log.cloudflare_storage import D1Client
        client = D1Client('a' * 36, 'b' * 32, 'c' * 24)
        session = self.session()
        session.failed.set()
        with patch('backend.utils.log.job_lease._active', session), patch('requests.post') as send:
            with self.assertRaises(LeaseLostError):
                client.execute('UPDATE run_logs SET status = ?', ('failed',))
        send.assert_not_called()

    def test_supabase_factory_installs_mutation_guard(self):
        from types import SimpleNamespace
        from backend.utils.log.job_lease import create_client
        client = Mock()
        client.postgrest.session.event_hooks = {}
        with patch('supabase.create_client', return_value=client):
            create_client('url', 'key')
        handler = client.postgrest.session.event_hooks['request'][0]
        with patch('backend.utils.log.job_lease.before_mutation', side_effect=LeaseLostError('lost')):
            with self.assertRaises(LeaseLostError):
                handler(SimpleNamespace(method='POST'))
            handler(SimpleNamespace(method='GET'))

    def test_heartbeat_failure_terminates_a_real_worker(self):
        import sys
        from backend.config.job_supervisor import run_managed_process
        code = '''
from unittest.mock import Mock
from backend.utils.log.job_lease import LeaseSession
import time
session = LeaseSession(Mock(), 'owner', interval=0.01)
session.store = Mock()
session.store.verify.side_effect = TimeoutError('lost')
session.start()
time.sleep(60)
'''
        result = run_managed_process([sys.executable, '-c', code], seconds=3, grace_seconds=0.5)
        self.assertNotEqual(result.exit_code, 0)
        self.assertLess(result.elapsed_seconds, 3)

    def test_takeover_reconciliation_only_clears_marker_after_confirmation(self):
        from backend.utils.log.job_lease import reconcile_predecessor
        from tempfile import TemporaryDirectory
        store = Mock(predecessor_run_id=42)
        store.d1.execute.return_value.rows = [{'run_id': 42}]
        store.d1.execute.return_value.changes = 1
        client = Mock()
        response = client.table.return_value.update.return_value.eq.return_value.execute.return_value
        response.data = []
        with TemporaryDirectory() as directory, patch.dict('os.environ', {
            'SUPABASE_URL': 'url', 'SUPABASE_SERVICE_ROLE_KEY': 'key', 'KARTISERET_RECOVERY_ROOT': directory,
        }), patch('backend.utils.log.job_lease.create_client', return_value=client), patch(
            'backend.utils.log.job_lease._active', Mock(token='new-owner')
        ):
            with self.assertRaises(LeaseLostError):
                reconcile_predecessor(store)
            self.assertEqual(store.predecessor_run_id, 42)
            response.data = [{'run_id': 42}]
            reconcile_predecessor(store)
        self.assertIsNone(store.predecessor_run_id)
        store.mark_run_unconfirmed.assert_called_with(42, 'expired_lease_takeover', release_lease=False)
        self.assertEqual(store.d1.execute.call_args.args[1], ('new-owner',))

    def test_reserved_predecessor_without_either_run_record_can_be_reconciled(self):
        from backend.utils.log.job_lease import reconcile_predecessor
        store = Mock(predecessor_run_id=42)
        store.d1.execute.return_value.rows = []
        store.d1.execute.return_value.changes = 1
        client = Mock()
        client.table.return_value.update.return_value.eq.return_value.execute.return_value.data = []
        lookup = client.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value
        for data in (None, [{'run_id': 42}], []):
            lookup.data = data
            store.predecessor_run_id = 42
            with patch.dict('os.environ', {'SUPABASE_URL': 'url', 'SUPABASE_SERVICE_ROLE_KEY': 'key'}), patch(
                'backend.utils.log.job_lease.create_client', return_value=client
            ), patch('backend.utils.log.cloudflare_storage.write_recovery_envelope'), patch(
                'backend.utils.log.job_lease._active', Mock(token='new-owner')
            ):
                if data != []:
                    with self.assertRaises(LeaseLostError):
                        reconcile_predecessor(store)
                    self.assertEqual(store.predecessor_run_id, 42)
                else:
                    reconcile_predecessor(store)
                    self.assertIsNone(store.predecessor_run_id)
        store.mark_run_unconfirmed.assert_not_called()

    def test_reconciliation_cannot_clear_a_replacement_owners_marker(self):
        from backend.utils.log.job_lease import reconcile_predecessor
        store = Mock(predecessor_run_id=42)
        store.d1.execute.return_value.rows = [{'run_id': 42}]
        store.d1.execute.return_value.changes = 0
        client = Mock()
        client.table.return_value.update.return_value.eq.return_value.execute.return_value.data = [{'run_id': 42}]
        with patch.dict('os.environ', {'SUPABASE_URL': 'url', 'SUPABASE_SERVICE_ROLE_KEY': 'key'}), patch(
            'backend.utils.log.job_lease.create_client', return_value=client
        ), patch('backend.utils.log.cloudflare_storage.write_recovery_envelope'), patch(
            'backend.utils.log.job_lease._active', Mock(token='expired-owner')
        ), self.assertRaises(LeaseLostError):
            reconcile_predecessor(store)
        self.assertEqual(store.predecessor_run_id, 42)
