from contextlib import closing
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import multiprocessing
import os
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from backend.utils.log import r2_storage_guard as storage
from backend.utils.log.r2_budget import R2Budget, R2BudgetError, R2BudgetExceeded


def reserve_worker(path, count, size, high, low):
    guard = storage.StorageGuard(path, 'development', 'owner', lambda: 0, lambda: None, high=high, low=low)
    for _ in range(count):
        guard.reserve(size)


class StorageGuardTests(unittest.TestCase):
    def setUp(self):
        self.directory = self.enterContext(TemporaryDirectory())
        self.path = Path(self.directory) / 'storage.sqlite3'
        self.inventory = Mock(return_value=0)
        self.cleanup = Mock()
        self.clock = Mock(return_value=1000)
        self.guard = storage.StorageGuard(self.path, 'development', 'owner', self.inventory, self.cleanup,
                                          high=1_000_000, low=800_000, clock=self.clock)
        self.guard.initialize()

    def test_fast_path_only_uses_local_reservations(self):
        for _ in range(100):
            self.guard.reserve(100)
        self.assertEqual(self.guard.summary()['estimated_bytes'], 100 * (100 + storage.OVERHEAD_BYTES))
        self.inventory.assert_called_once()
        self.cleanup.assert_not_called()

    def test_incoming_upload_cannot_cross_high_watermark(self):
        self.guard.reserve(790_000)
        with self.assertRaises(storage.R2StorageFull):
            self.guard.reserve(210_000)
        self.assertEqual(self.guard.summary()['blocked'], 'R2StorageFull')
        self.cleanup.assert_called_once()
        with self.assertRaises(storage.R2StorageFull):
            self.guard.reserve(1)

    def test_pressure_cleanup_credits_only_confirmed_reduction(self):
        self.guard.reserve(790_000)
        self.inventory.side_effect = [790_000, 100_000]
        self.guard.reserve(210_000)
        self.assertEqual(self.guard.summary()['estimated_bytes'], 318_192)
        self.cleanup.assert_called_once()

    def test_cleanup_that_does_not_reach_low_watermark_blocks_upload(self):
        self.guard.reserve(790_000)
        self.inventory.side_effect = [790_000, 700_000]
        with self.assertRaises(storage.R2StorageFull):
            self.guard.reserve(210_000)

    def test_preflight_can_use_completed_daily_cleanup_without_repeating_it(self):
        self.inventory.return_value = 1_100_000
        self.clock.return_value += storage.CHECK_SECONDS
        with self.assertRaises(storage.R2StorageFull):
            self.guard.reserve(upload=False, allow_cleanup=False)
        self.cleanup.assert_not_called()

    def test_periodic_refresh_never_discards_inflight_reservations(self):
        self.guard.reserve(100)
        self.clock.return_value += storage.CHECK_SECONDS
        self.guard.reserve(100)
        self.assertEqual(self.inventory.call_count, 2)
        self.assertEqual(self.guard.summary()['estimated_bytes'], 2 * (100 + storage.OVERHEAD_BYTES))

    def test_upload_volume_triggers_refresh(self):
        with patch.object(storage, 'CHECK_BYTES', 4000):
            self.guard.reserve(100)
        self.assertEqual(self.inventory.call_count, 2)

    def test_backwards_clock_refreshes_instead_of_trusting_stale_inventory(self):
        self.clock.return_value -= 1
        self.guard.reserve(100)
        self.assertEqual(self.inventory.call_count, 2)

    def test_inventory_or_cleanup_failure_is_fail_closed_and_latched(self):
        self.clock.return_value += storage.CHECK_SECONDS
        self.inventory.side_effect = TimeoutError('unknown inventory')
        with self.assertRaises(storage.R2StorageError):
            self.guard.reserve(100)
        self.inventory.side_effect = None
        with self.assertRaises(storage.R2StorageFull):
            self.guard.reserve(100)
        self.assertEqual(self.guard.summary()['blocked'], 'TimeoutError')

    def test_missing_or_wrong_job_ledger_cannot_allow_uploads(self):
        other = storage.StorageGuard(self.path, 'production', 'other', self.inventory, self.cleanup)
        with self.assertRaises(storage.R2StorageError):
            other.reserve(100)
        self.path.unlink()
        with self.assertRaises(storage.R2StorageError):
            self.guard.reserve(100)
        self.assertFalse(self.path.exists())

    def test_guard_cannot_be_reset_during_same_job(self):
        self.guard.reserve(100)
        with self.assertRaises(storage.R2StorageError):
            self.guard.initialize()
        self.assertEqual(self.guard.summary()['estimated_bytes'], 100 + storage.OVERHEAD_BYTES)

    def test_threads_and_processes_share_atomic_byte_reservations(self):
        with ThreadPoolExecutor(max_workers=6) as executor:
            list(executor.map(lambda _: self.guard.reserve(100), range(60)))
        ctx = multiprocessing.get_context('spawn')
        processes = [ctx.Process(target=reserve_worker, args=(str(self.path), 20, 100, self.guard.high, self.guard.low)) for _ in range(2)]
        for process in processes:
            process.start()
        for process in processes:
            process.join(timeout=15)
            self.assertEqual(process.exitcode, 0)
        self.assertEqual(self.guard.summary()['estimated_bytes'], 100 * (100 + storage.OVERHEAD_BYTES))

    def test_invalid_watermarks_are_rejected(self):
        for high, low in [(0, 0), (10, 10), (10, 11), ('bad', 1), (2**63, 1)]:
            with self.subTest(high=high, low=low), self.assertRaises(storage.R2StorageError):
                storage.StorageGuard(self.path, 'development', 'owner', self.inventory, self.cleanup, high=high, low=low)

    def test_error_types_propagate_through_existing_runaway_error_handlers(self):
        self.assertIsInstance(storage.R2StorageError('unknown'), R2BudgetError)
        self.assertIsInstance(storage.R2StorageFull('full'), R2BudgetExceeded)

    def test_sdk_fixture_restores_environment_before_later_dataflow_tests(self):
        environment = dict(os.environ)
        result = unittest.TestResult()
        InventoryAndHookTests('test_guard_checks_uploads_but_leaves_reads_and_recovery_deletes_available').run(result)
        self.assertTrue(result.wasSuccessful(), result.errors or result.failures)
        self.assertEqual(dict(os.environ), environment)

    def test_pressure_cleanup_receives_pins_for_unpublished_reused_variants(self):
        key = 'artwork/v1/poster/' + 'a' * 64 + '/complete'
        self.guard.pin('art', key)
        self.guard.pin('art', 'social/v1/fingerprint/card.jpg')
        self.guard.reserve(790_000)
        self.inventory.side_effect = [790_000, 100_000]
        self.guard.reserve(210_000)
        pins = self.cleanup.call_args.args[0]
        for suffix in ('185.webp', '342.webp', '780.webp', 'complete'):
            self.assertTrue(storage.retains(pins, 'art', key.rsplit('/', 1)[0] + '/' + suffix))
        self.assertTrue(storage.retains(pins, 'art', 'social/v1/fingerprint/card.jpg'))
        self.assertFalse(storage.retains(pins, 'other-target', key))

    def test_cleanup_failure_preserves_reservations_and_stops_future_uploads(self):
        self.guard.reserve(790_000)
        self.cleanup.side_effect = RuntimeError('incomplete catalog scan')
        with self.assertRaises(storage.R2StorageError):
            self.guard.reserve(210_000)
        self.assertEqual(self.guard.summary()['estimated_bytes'], 794_096)
        with self.assertRaises(storage.R2StorageFull):
            self.guard.reserve(1)

    def test_corrupt_or_missing_state_is_not_reinitialized(self):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('DELETE FROM storage')
        with self.assertRaises(storage.R2StorageError):
            self.guard.reserve(1)

    def test_oversized_single_upload_is_rejected_without_unnecessary_cleanup(self):
        with self.assertRaises(storage.R2StorageFull):
            self.guard.reserve(self.guard.high)
        self.inventory.assert_called_once()
        self.cleanup.assert_not_called()

    def test_independent_jobs_remeasure_storage_instead_of_resetting_the_ceiling(self):
        used = 0
        successful = 0
        cleanup = Mock()
        for index in range(3):
            guard = storage.StorageGuard(Path(self.directory) / f'job-{index}.sqlite3', 'development', str(index),
                                         lambda: used, cleanup, high=20_000, low=16_000)
            guard.initialize()
            if index < 2:
                guard.reserve(3000)
                used += 3000 + storage.OVERHEAD_BYTES
                successful += 1
            else:
                with self.assertRaises(storage.R2StorageFull):
                    guard.reserve(3000)
        self.assertEqual(successful, 2)
        cleanup.assert_called_once()


class InventoryAndHookTests(unittest.TestCase):
    def setUp(self):
        # Job budgets also set their shared path in os.environ. Restore the
        # complete fixture environment before any later dataflow tests run.
        self.enterContext(patch.dict(os.environ))
        self.enterContext(patch.object(storage, '_active', None))

    def client(self, pages):
        client = Mock()
        client.get_paginator.side_effect = lambda name: SimpleNamespace(paginate=lambda **kwargs: pages.get(name, [{'IsTruncated': False}]))
        return client

    def test_inventory_includes_all_prefixes_both_buckets_and_pending_parts(self):
        first = self.client({'list_objects_v2': [{'IsTruncated': False, 'Contents': [{'Key': 'artwork/x', 'Size': 10}, {'Key': 'unknown/retained', 'Size': 20}]}]})
        second = self.client({'list_multipart_uploads': [{'IsTruncated': False, 'Uploads': [{'Key': 'runs/x', 'UploadId': 'pending'}]}],
                              'list_parts': [{'IsTruncated': False, 'Parts': [{'Size': 30}]}]})
        self.assertEqual(storage.measure_buckets(((first, 'art'), (second, 'runs'))), 60 + 3 * storage.OVERHEAD_BYTES)

    def test_malformed_inventory_cannot_be_treated_as_an_empty_bucket(self):
        for page in ({}, {'IsTruncated': False, 'Contents': None}, {'IsTruncated': False, 'Contents': [{'Key': 'x'}]}, {'IsTruncated': False, 'Contents': [{'Key': 'x', 'Size': -1}]}):
            with self.subTest(page=page), self.assertRaises(storage.R2StorageError):
                storage.measure_buckets(((self.client({'list_objects_v2': [page]}), 'art'),))

    def test_empty_or_truncated_pagination_fails_closed(self):
        for pages in ([], [{'IsTruncated': True, 'Contents': []}]):
            with self.subTest(pages=pages), self.assertRaises(storage.R2StorageError):
                storage.measure_buckets(((self.client({'list_objects_v2': pages}), 'art'),))

    def test_stream_sizing_preserves_position_and_rejects_unknown_size(self):
        from array import array
        self.assertEqual(storage._body_size({'Body': memoryview(array('I', [1, 2, 3]))}), 12)
        stream = BytesIO(b'123456')
        stream.seek(2)
        self.assertEqual(storage._body_size({'Body': stream}), 4)
        self.assertEqual(stream.tell(), 2)
        with self.assertRaises(storage.R2StorageError):
            storage._body_size({'Body': object()})

    def test_guard_checks_uploads_but_leaves_reads_and_recovery_deletes_available(self):
        client = Mock()
        storage.install_storage_guard(client)
        hook = client.meta.events.register_first.call_args.args[1]
        for operation in ('GetObject', 'ListObjectsV2', 'DeleteObjects', 'AbortMultipartUpload'):
            hook(params={}, model=SimpleNamespace(name=operation))
        for operation in ('CopyObject', 'CreateMultipartUpload', 'UploadPart', 'CompleteMultipartUpload'):
            with self.assertRaises(storage.R2StorageError):
                hook(params={}, model=SimpleNamespace(name=operation))
        with TemporaryDirectory() as directory, patch.dict(os.environ, {'R2_BUCKET': 'art', 'RUN_ARTIFACTS_R2_BUCKET': 'runs'}):
            budget = R2Budget.create_job_budget(directory)
            path = budget.path.with_name('r2-storage.sqlite3')
            path.touch()
            guard = Mock(path=path, target='development', token='owner')
            with patch.dict(os.environ, {'KARTISERET_TARGET': 'development', 'KARTISERET_ACTIVE_LEASE_TOKEN': 'owner'}), patch.object(storage, '_active', guard):
                hook(params={'Bucket': 'art', 'Key': 'key', 'Body': b'image'}, model=SimpleNamespace(name='PutObject'))
                guard.reserve.assert_called_once_with(5, bucket='art', key='key')
                with self.assertRaises(storage.R2StorageError):
                    hook(params={'Bucket': 'wrong', 'Body': b'image'}, model=SimpleNamespace(name='PutObject'))

    def test_real_sdk_never_sends_the_upload_that_exceeds_storage(self):
        from botocore.awsrequest import AWSResponse
        from backend.utils.log.r2_client import create_r2_s3_client
        class Raw:
            def stream(self, *args, **kwargs):
                yield b''
        with TemporaryDirectory() as directory, patch.dict(os.environ, {
            'KARTISERET_TARGET': 'development', 'KARTISERET_ACTIVE_LEASE_TOKEN': 'owner',
            'R2_ACCOUNT_ID': 'a' * 32, 'R2_BUCKET': 'art', 'RUN_ARTIFACTS_R2_BUCKET': 'runs',
        }), patch('backend.utils.log.job_lease.before_mutation', return_value=None):
            budget = R2Budget.create_job_budget(directory)
            guard = storage.StorageGuard(budget.path.with_name('r2-storage.sqlite3'), 'development', 'owner',
                                         lambda: 0, Mock(), high=10_000, low=8000)
            guard.initialize()
            client = create_r2_s3_client(access_key='test', secret_key='test')
            with patch.object(storage, '_active', guard), patch.object(client._endpoint.http_session, 'send',
                    return_value=AWSResponse('https://test.invalid', 200, {}, Raw())) as send:
                client.put_object(Bucket='art', Key='first', Body=b'12345')
                with self.assertRaises(storage.R2StorageFull):
                    client.put_object(Bucket='art', Key='blocked', Body=b'x' * 6000)
                self.assertEqual(send.call_count, 1)
                self.assertEqual(budget.snapshot()['class_a'], 1)

    def test_new_preflight_after_daily_skip_still_recovers_storage(self):
        from backend.utils.log import shared_cleanup
        for skipped in (True, False):
            with self.subTest(skipped=skipped), TemporaryDirectory() as directory:
                measure = Mock(side_effect=[1_100_000, 1_100_000, 100_000])
                cleanup = Mock()
                guard = storage.StorageGuard(Path(directory) / 'storage.sqlite3', 'development', 'owner',
                                             measure, cleanup, high=1_000_000, low=800_000)
                guard.initialize()
                result = {'skipped': 'already-cleaned-today'} if skipped else {}
                with patch.dict(os.environ, {'KARTISERET_TARGET': 'development'}), patch.object(
                    storage, 'initialize_storage_guard', return_value=guard
                ), patch.object(shared_cleanup, 'run_shared_cleanup', return_value=result), patch(
                    'backend.utils.log.shared_cleanup.resolve_target_environment', return_value={}
                ):
                    if skipped:
                        report = shared_cleanup.run_pipeline_preflight(Mock(), lease_token='owner')
                        self.assertEqual(report['r2_storage']['estimated_bytes'], 100_000)
                        cleanup.assert_called_once()
                    else:
                        with self.assertRaises(storage.R2StorageFull):
                            shared_cleanup.run_pipeline_preflight(Mock(), lease_token='owner')
                        cleanup.assert_not_called()

    def test_pressure_sweep_retains_pinned_assets_in_all_three_categories(self):
        from datetime import datetime, timedelta, timezone
        from backend.utils.log import shared_cleanup
        old = datetime.now(timezone.utc) - timedelta(days=31)
        prefix = 'artwork/v1/poster/' + 'a' * 64
        social = 'social/v1/' + 'b' * 64 + '/card.jpg'
        artifact = 'runs/2025-01-01/7/screenshots/saved.webp'
        keys = {'artwork/v1/': [prefix + '/342.webp', prefix + '/complete'], 'social/v1/': [social], 'runs/': [artifact]}
        client = Mock()
        client.get_paginator.return_value.paginate.side_effect = lambda **kw: [{'Contents': [
            {'Key': key, 'LastModified': old} for key in keys[kw['Prefix']]
        ]}]
        artwork = SimpleNamespace(client=client, bucket='art')
        store = SimpleNamespace(r2=client, bucket='runs')
        pins = {('art', prefix + '/'), ('art', social), ('runs', artifact)}
        with patch.object(shared_cleanup, '_supabase_client'), patch(
            'backend.dataflow.backfill_catalog_artwork.referenced_keys', return_value=set()
        ), patch('backend.dataflow.social_previews.each_row', return_value=[]), patch.object(
            shared_cleanup, '_scan_run_states', return_value={7: 'successful'}
        ), patch.object(shared_cleanup, '_scan_artifact_references', return_value=set()), patch.object(
            shared_cleanup, '_recoverable_run_ids', return_value=set()
        ):
            report = shared_cleanup.cleanup_r2_storage(store, apply=True, lease_guard=Mock(), artwork=artwork, pins=pins)
        self.assertTrue(all(result['deleted'] == 0 for result in report.values()))
        client.delete_objects.assert_not_called()

    def test_cached_publication_rows_are_pinned_before_any_storage_read(self):
        with TemporaryDirectory() as directory, patch.dict(os.environ, {
            'KARTISERET_TARGET': 'development', 'KARTISERET_ACTIVE_LEASE_TOKEN': 'owner', 'R2_BUCKET': 'art'
        }):
            budget = R2Budget.create_job_budget(directory)
            guard = storage.StorageGuard(budget.path.with_name('r2-storage.sqlite3'), 'development', 'owner', lambda: 0, Mock())
            guard.initialize()
            digest = 'a' * 64
            rows = [{'en_poster': f'https://site.test/api/images/v1/poster/{digest}/342.webp',
                     'backdrop': f'https://site.test/api/images/v1/backdrop/{digest}/1280.webp',
                     'social_preview_fingerprint': digest}]
            with patch.object(storage, '_active', guard):
                storage.pin_catalog_rows(rows)
                with closing(sqlite3.connect(guard.path)) as db:
                    pins = set(db.execute('SELECT bucket,object_key FROM pins').fetchall())
                self.assertEqual(pins, {('art', f'artwork/v1/poster/{digest}/'), ('art', f'artwork/v1/backdrop/{digest}/'),
                                        ('art', f'social/v1/{digest}/card.jpg')})
                with patch.object(storage._local, 'cleaning', True, create=True), patch.object(guard, 'pin_many') as pin:
                    storage.pin_catalog_rows(rows)
                    pin.assert_not_called()


if __name__ == '__main__':
    unittest.main()
