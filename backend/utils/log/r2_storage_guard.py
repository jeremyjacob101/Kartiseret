"""Target-scoped R2 storage watermarks, with a local shared upload fast path.

Inventory uses the existing bucket credentials. No analytics token, remote
counter, or extra service is needed. Reservations intentionally overcount failed
uploads and overwrites; only confirmed cleanup frees reserved space mid-job.
"""
from __future__ import annotations

from contextlib import closing
from pathlib import Path
import os
import re
import sqlite3
import threading
import time
from urllib.parse import urlsplit

from backend.utils.log.r2_budget import R2Budget, R2BudgetError, R2BudgetExceeded, initialize_job_budget

OVERHEAD_BYTES = 4096
CHECK_SECONDS = 300
CHECK_BYTES = 128 * 1024 * 1024
WATERMARKS = {'production': (6_000_000_000, 5_000_000_000), 'development': (2_000_000_000, 1_500_000_000)}
_active = None
_local = threading.local()


class R2StorageError(R2BudgetError):
    """Storage could not be confirmed; no new upload may be sent."""


class R2StorageFull(R2BudgetExceeded):
    """Safe cleanup could not recover enough storage for new uploads."""


def _pin_key(key):
    return key.rsplit('/', 1)[0] + '/' if key.startswith('artwork/v1/') else key


def retains(pins, bucket, key):
    return (bucket, key) in pins or (bucket, _pin_key(key)) in pins


def _size(value):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise R2StorageError('R2 inventory contains an unknown object or part size')
    return value


def _pages(client, operation, **params):
    seen, truncated = False, True
    for page in client.get_paginator(operation).paginate(**params):
        if not truncated or not isinstance(page, dict) or not isinstance(page.get('IsTruncated'), bool):
            raise R2StorageError('R2 storage inventory pagination is malformed')
        seen, truncated = True, page['IsTruncated']
        yield page
    if not seen or truncated:
        raise R2StorageError('R2 storage inventory did not finish every page')


def measure_buckets(buckets):
    """Count every prefix and pending multipart part in both selected buckets."""
    total = 0
    for client, bucket in buckets:
        for page in _pages(client, 'list_objects_v2', Bucket=bucket):
            if not isinstance(page.get('IsTruncated'), bool) or not isinstance(page.get('Contents', []), list):
                raise R2StorageError('R2 object inventory is incomplete')
            for item in page.get('Contents', []):
                if not isinstance(item, dict) or not isinstance(item.get('Key'), str):
                    raise R2StorageError('R2 object inventory is malformed')
                total += _size(item.get('Size')) + OVERHEAD_BYTES
        for page in _pages(client, 'list_multipart_uploads', Bucket=bucket):
            if not isinstance(page.get('IsTruncated'), bool) or not isinstance(page.get('Uploads', []), list):
                raise R2StorageError('R2 multipart inventory is incomplete')
            for upload in page.get('Uploads', []):
                if not isinstance(upload, dict) or not all(isinstance(upload.get(key), str) and upload[key] for key in ('Key', 'UploadId')):
                    raise R2StorageError('R2 multipart inventory is malformed')
                for parts in _pages(client, 'list_parts', Bucket=bucket, Key=upload['Key'], UploadId=upload['UploadId']):
                    if not isinstance(parts.get('IsTruncated'), bool) or not isinstance(parts.get('Parts', []), list):
                        raise R2StorageError('R2 part inventory is incomplete')
                    for part in parts.get('Parts', []):
                        if not isinstance(part, dict):
                            raise R2StorageError('R2 part inventory is malformed')
                        total += _size(part.get('Size')) + OVERHEAD_BYTES
    return total


class StorageGuard:
    def __init__(self, path, target, token, inventory, cleanup, *, high=None, low=None, clock=time.time):
        if target not in WATERMARKS or not token:
            raise R2StorageError('R2 storage guard requires the selected target and its active lease')
        prefix = f'KARTISERET_R2_STORAGE_{target.upper()}_'
        try:
            self.high = int(os.environ.get(prefix + 'HIGH_BYTES', WATERMARKS[target][0]) if high is None else high)
            self.low = int(os.environ.get(prefix + 'LOW_BYTES', WATERMARKS[target][1]) if low is None else low)
        except (ValueError, TypeError) as error:
            raise R2StorageError('R2 storage watermarks must be positive integer bytes') from error
        if not 0 < self.low < self.high < 2**63:
            raise R2StorageError('R2 storage watermarks require 0 < low < high')
        self.path, self.target, self.token = Path(path), target, token
        self.inventory, self.cleanup, self.clock = inventory, cleanup, clock

    def _connect(self):
        # Never silently recreate a missing shared guard in a worker process.
        # Pressure cleanup holds the write gate while scanning references. Give
        # concurrent upload threads room to wait; the job supervisor still owns
        # the hard lifetime and shutdown deadline.
        return sqlite3.connect(self.path.as_uri() + '?mode=rw', uri=True, timeout=300)

    def initialize(self):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('CREATE TABLE IF NOT EXISTS storage (id INTEGER PRIMARY KEY CHECK(id=1), target TEXT, token TEXT, high INTEGER, low INTEGER, used INTEGER, checked REAL, since_check INTEGER, blocked TEXT)')
            db.execute('CREATE TABLE IF NOT EXISTS pins (bucket TEXT, object_key TEXT, PRIMARY KEY(bucket,object_key))')
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT id FROM storage').fetchone():
                raise R2StorageError('R2 storage guard cannot be reset during a job')
            used = _size(self.inventory())
            db.execute('INSERT INTO storage VALUES (1,?,?,?,?,?,?,0,NULL)', (self.target, self.token, self.high, self.low, used, self.clock()))

    def reserve(self, payload_bytes=0, *, upload=True, allow_cleanup=True, bucket=None, key=None):
        """Reserve before sending. Normally only one short local transaction."""
        charge = _size(payload_bytes) + (OVERHEAD_BYTES if upload else 0)
        try:
            with closing(self._connect()) as db:
                db.execute('BEGIN IMMEDIATE')
                row = db.execute('SELECT target,token,high,low,used,checked,since_check,blocked FROM storage WHERE id=1').fetchone()
                if row is None or row[:4] != (self.target, self.token, self.high, self.low):
                    raise R2StorageError('R2 storage guard does not match this job and target')
                used, checked, since_check, blocked = row[4:]
                _size(used)
                _size(since_check)
                if blocked:
                    raise R2StorageFull('R2 storage guard already blocked uploads for this job; inspect its storage summary')
                now = self.clock()
                try:
                    if charge >= self.high:
                        raise R2StorageFull('A single R2 upload exceeds the target storage ceiling; upload blocked')
                    measured = None
                    if now < checked or now - checked >= CHECK_SECONDS or since_check + charge >= CHECK_BYTES:
                        # Keep all reservations, including writes still in flight.
                        measured = _size(self.inventory())
                        used = max(used, measured)
                        checked, since_check = now, 0
                    if used + charge >= self.high:
                        before = measured if measured is not None else _size(self.inventory())
                        used = max(used, before)
                        if allow_cleanup:
                            pins = set(db.execute('SELECT bucket,object_key FROM pins').fetchall())
                            _local.cleaning = True
                            try:
                                self.cleanup(pins)
                            finally:
                                _local.cleaning = False
                            after = _size(self.inventory())
                            # Only credit an observed reduction. This retains the
                            # headroom already reserved for in-flight uploads.
                            used = max(after, used - max(0, before - after))
                        checked, since_check = now, 0
                        if used + charge > self.low:
                            raise R2StorageFull(f'R2 {self.target} storage needs room: estimated {used} bytes, incoming {charge}, high {self.high}, recovery target {self.low}. Safe cleanup could not recover enough; uploads stopped.')
                    db.execute('UPDATE storage SET used=?,checked=?,since_check=? WHERE id=1', (used + charge, checked, since_check + charge))
                    if bucket and key:
                        db.execute('INSERT OR IGNORE INTO pins VALUES (?,?)', (bucket, _pin_key(key)))
                    db.commit()
                except Exception as error:
                    # Latch failure for every process while keeping reads and
                    # deletions available to operator recovery and finalization.
                    db.execute('UPDATE storage SET used=?,blocked=? WHERE id=1', (used, type(error).__name__))
                    db.commit()
                    raise
        except (R2StorageError, R2StorageFull):
            raise
        except Exception as error:
            raise R2StorageError('R2 storage could not be confirmed; upload blocked') from error

    def pin(self, bucket, key):
        """Protect assets reused by an unpublished workspace before reading."""
        self.pin_many({(bucket, _pin_key(key))})

    def pin_many(self, pins):
        if not pins:
            return
        try:
            with closing(self._connect()) as db, db:
                row = db.execute('SELECT target,token FROM storage WHERE id=1').fetchone()
                if row != (self.target, self.token):
                    raise R2StorageError('R2 storage references do not belong to this job')
                db.executemany('INSERT OR IGNORE INTO pins VALUES (?,?)', pins)
        except R2StorageError:
            raise
        except Exception as error:
            raise R2StorageError('R2 reused asset could not be protected for this job') from error

    def summary(self):
        with closing(self._connect()) as db:
            row = db.execute('SELECT used,high,low,blocked FROM storage WHERE id=1').fetchone()
        if row is None:
            raise R2StorageError('R2 storage preflight has not completed')
        return dict(zip(('estimated_bytes', 'high_bytes', 'low_bytes', 'blocked'), row))


def _guard(store=None):
    from backend.config.target_environment import BUCKETS, RUN_ARTIFACT_BUCKETS
    from backend.dataflow.utils.ArtworkStorage import ArtworkStorage
    from backend.utils.log.run_storage import RunArtifactStore, _r2_client
    from backend.utils.log.shared_cleanup import cleanup_r2_storage, _cleanup_apply_from_environment

    target = os.environ.get('KARTISERET_TARGET', '')
    store = store or RunArtifactStore()
    artwork = ArtworkStorage.from_environment()
    if target not in WATERMARKS or artwork is None or artwork.bucket != BUCKETS[target] or store.bucket != RUN_ARTIFACT_BUCKETS[target]:
        raise R2StorageError('R2 storage inventory must use both buckets from the selected target')
    token = os.environ.get('KARTISERET_ACTIVE_LEASE_TOKEN', '')
    budget = initialize_job_budget()
    buckets = ((artwork.client, artwork.bucket), (store.r2 or _r2_client(), store.bucket))
    def cleanup(pins):
        from backend.utils.log.shared_cleanup import lease_renewal_callback
        apply = _cleanup_apply_from_environment()
        report = cleanup_r2_storage(store, apply=apply, lease_guard=lease_renewal_callback(store, token), pins=pins)
        counts = ', '.join(f"{kind}: {result['deleted']} deleted" for kind, result in report.items())
        print(f'R2 storage pressure cleanup ({target}, apply={apply}): {counts}', flush=True)
    return StorageGuard(budget.path.with_name('r2-storage.sqlite3'), target, token, lambda: measure_buckets(buckets), cleanup)


def initialize_storage_guard(store):
    global _active
    _active = None
    guard = _guard(store)
    guard.initialize()
    _active = guard
    return guard


def storage_summary():
    if _active is None:
        return None
    return {"target": _active.target, **_active.summary()}


def _body_size(params):
    body = params.get('Body', b'')
    if isinstance(body, str):
        return len(body.encode('utf-8'))
    if isinstance(body, memoryview):
        return body.nbytes
    if isinstance(body, (bytes, bytearray)):
        return len(body)
    try:
        position = body.tell()
        body.seek(0, 2)
        size = body.tell() - position
        body.seek(position)
        return _size(size)
    except Exception as error:
        raise R2StorageError('R2 upload body must have a known size before sending') from error


def _current(required=False):
    global _active
    budget = R2Budget.from_environment()
    path = budget.path.with_name('r2-storage.sqlite3') if budget else None
    if path is None or not path.exists():
        if required:
            raise R2StorageError('R2 storage preflight must complete before uploads')
        return None
    if (_active is None or _active.path != path or _active.target != os.environ.get('KARTISERET_TARGET')
            or _active.token != os.environ.get('KARTISERET_ACTIVE_LEASE_TOKEN')):
        try:
            _active = _guard()
        except R2BudgetError:
            raise
        except Exception as error:
            raise R2StorageError('R2 storage guard could not load the selected target') from error
    return _active


def pin_catalog_rows(rows):
    """Retain cached catalog references across concurrent category publication."""
    if getattr(_local, 'cleaning', False) or not os.environ.get('KARTISERET_ACTIVE_LEASE_TOKEN'):
        return
    guard = _current()
    if guard is None:
        return
    pins = set()
    bucket = os.environ['R2_BUCKET']
    for row in rows:
        for field in ('en_poster', 'backdrop'):
            value = row.get(field)
            if isinstance(value, str):
                match = re.fullmatch(r'/api/images/v1/(poster|backdrop)/([a-f0-9]{64})/(185|342|780|1280)\.webp', urlsplit(value).path)
                if match:
                    pins.add((bucket, f'artwork/v1/{match[1]}/{match[2]}/'))
        fingerprint = row.get('social_preview_fingerprint')
        if isinstance(fingerprint, str) and re.fullmatch(r'[a-f0-9]{64}', fingerprint):
            pins.add((bucket, f'social/v1/{fingerprint}/card.jpg'))
    guard.pin_many(pins)


def install_storage_guard(client):

    def before_parameters(params, model, **_kwargs):
        if model.name in {'CopyObject', 'CreateMultipartUpload', 'UploadPart', 'UploadPartCopy', 'CompleteMultipartUpload'}:
            raise R2StorageError('This pipeline uses bounded PutObject uploads; unmeasured copy/multipart writes are blocked')
        if model.name in {'HeadObject', 'GetObject'}:
            if getattr(_local, 'cleaning', False):
                return
            guard = _current()
            if guard is not None:
                guard.pin(params['Bucket'], params['Key'])
            return
        if model.name != 'PutObject':
            return
        if getattr(_local, 'cleaning', False):
            raise R2StorageError('Storage pressure cleanup must not perform new uploads')
        # Keep the free-tier assumptions even if a bucket default changes.
        params.setdefault('StorageClass', 'STANDARD')
        if params['StorageClass'] != 'STANDARD':
            raise R2StorageError('Pipeline storage safeguards require Standard storage uploads')
        if params.get('Bucket') not in {os.environ.get('R2_BUCKET'), os.environ.get('RUN_ARTIFACTS_R2_BUCKET')}:
            raise R2StorageError('R2 upload bucket is outside the selected storage budget')
        _current(True).reserve(_body_size(params), bucket=params['Bucket'], key=params['Key'])
    client.meta.events.register_first('before-parameter-build.s3.*', before_parameters)
