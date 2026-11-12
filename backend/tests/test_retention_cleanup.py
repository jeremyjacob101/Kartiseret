from contextlib import redirect_stdout
from datetime import date, timedelta
from io import StringIO
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import Mock, patch
from backend.utils.supabase import clear_old_entries as cleanup
from backend.dataflow.utils.PublicationWorkspace import publication_scope

class RetentionCleanupTests(TestCase):
    def client(self, results):
        client = Mock()
        client.rpc.return_value.execute.side_effect = [SimpleNamespace(data=r) for r in results]
        return client

    def result(self, deleted=0, more=False):
        return {"table": "allShowtimes", "eligible": deleted, "deleted": deleted, "has_more": more}

    def test_batches_and_totals_without_reading_catalog(self):
        client = self.client([self.result(200, True), self.result(3)])
        guard = Mock()
        with redirect_stdout(StringIO()) as output:
            n = cleanup._retire_table(client, 'allShowtimes', '2026-01-01', apply=True, lease_guard=guard)
        self.assertEqual(n, 203)
        self.assertEqual(guard.verify.call_count, 2)
        client.table.assert_not_called()
        self.assertIn('retention_batch_complete', output.getvalue())

    def test_invalid_or_partial_response_stops_without_retry(self):
        for bad in [None, {}, self.result(201), self.result(1, True), self.result(True)]:
            client = self.client([bad])
            with redirect_stdout(StringIO()), self.assertRaises(RuntimeError):
                cleanup._retire_table(client, 'allShowtimes', '2026-01-01', apply=True, lease_guard=None)
            self.assertEqual(client.rpc.call_count, 1)

    def test_transport_failure_reports_unknown_outcome_without_retry(self):
        client = Mock(); client.rpc.return_value.execute.side_effect = TimeoutError('timeout')
        with redirect_stdout(StringIO()) as output, self.assertRaises(TimeoutError):
            cleanup._retire_table(client, 'allShowtimes', '2026-01-01', apply=True, lease_guard=None)
        self.assertIn('"outcome": "unknown"', output.getvalue())
        self.assertEqual(client.rpc.call_count, 1)

    def test_lost_lease_prevents_rpc(self):
        guard = Mock(); guard.verify.side_effect = RuntimeError('lost')
        client = Mock()
        with self.assertRaises(RuntimeError):
            cleanup._retire_table(client, 'allShowtimes', '2026-01-01', apply=True, lease_guard=guard)
        client.rpc.assert_not_called()

    def test_cutoffs_and_category_are_preserved(self):
        client = Mock()
        client.rpc.side_effect = lambda name, args: SimpleNamespace(execute=lambda: SimpleNamespace(
            data={"table":args['p_table'],"eligible":7,"deleted":0,"has_more":False}))
        with patch.object(cleanup, 'create_client', return_value=client), redirect_stdout(StringIO()):
            counts = cleanup.clear_old_entries('soons', soons_days_ago=20, apply=False)
        self.assertEqual(counts, {'allSoons':7,'finalSoons':7})
        calls = client.rpc.call_args_list
        self.assertEqual(calls[0].args[1]['p_cutoff'], (date.today()-timedelta(days=20)).isoformat())
        self.assertEqual(calls[1].args[1]['p_cutoff'], date.today().isoformat())

    def test_existing_publication_retains_staged_cleanup(self):
        active = SimpleNamespace(category='nowplayings')
        with publication_scope(active), patch.object(cleanup, '_clear_old_entries', return_value={'allShowtimes':2}) as staged, patch.object(cleanup, '_retire_table') as native:
            self.assertEqual(cleanup.clear_old_entries('nowplayings'), {'allShowtimes':2})
        staged.assert_called_once(); native.assert_not_called()

    def test_invalid_configuration_does_not_delete(self):
        with patch.object(cleanup, 'create_client') as factory:
            with self.assertRaises(ValueError): cleanup.clear_old_entries('unknown')
            factory.assert_not_called()
