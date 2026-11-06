"""One fail-closed heartbeat and mutation gate per logical job."""
from __future__ import annotations

from contextlib import contextmanager
import os
import signal
import threading
import time

from backend.utils.log.cloudflare_storage import LeaseLostError
from backend.utils.log.expiring_lease import ExpiringLeaseStore

_active = None
_retired = False
_local = threading.local()
TOKEN_ENV = 'KARTISERET_ACTIVE_LEASE_TOKEN'


@contextmanager
def control_request():
    previous = getattr(_local, 'control', False)
    _local.control = True
    try:
        yield
    finally:
        _local.control = previous


class LeaseSession:
    def __init__(self, d1, token, *, interval=10, terminate=None):
        self.store = ExpiringLeaseStore(d1)
        self.token = token
        self.interval = interval
        self.failed = threading.Event()
        self.failure_lock = threading.Lock()
        self.closed = threading.Event()
        self.parent = os.getppid()
        self.deadline = float(os.environ.get('KARTISERET_JOB_STARTED_WALL', time.time())) + 18000
        self.terminate = terminate or (lambda: os.kill(os.getpid(), signal.SIGTERM))
        self.thread = threading.Thread(target=self._heartbeat, name='target-lease', daemon=True)

    def _fail(self, error):
        with self.failure_lock:
            first = not self.failed.is_set()
            self.failed.set()
        if first:
            # Local output only: reporting must never issue another storage write.
            import sys
            try:
                from backend.utils.log.cloudflare_storage import write_recovery_envelope
                write_recovery_envelope('lease_failures', self.token, {
                    'target': os.environ.get('KARTISERET_TARGET'),
                    'status': 'unconfirmed', 'error_type': type(error).__name__,
                })
            except Exception:
                pass
            print('Target lease could not be confirmed; stopping job.', file=sys.stderr, flush=True)
            self.terminate()
        raise LeaseLostError('Target ownership is unconfirmed; job stopped') from error

    def verify(self):
        if self.failed.is_set() or self.closed.is_set():
            raise LeaseLostError('Target lease session is no longer active')
        try:
            if time.time() >= self.deadline:
                raise LeaseLostError('Five-hour job lifetime exceeded')
            if os.environ.get('KARTISERET_LEASE_WORKER') == 'true' and os.getppid() != self.parent:
                raise LeaseLostError('Job supervisor disappeared')
            with control_request():
                self.store.verify(self.token)
        except Exception as error:
            self._fail(error)

    def _heartbeat(self):
        while not self.closed.wait(self.interval):
            try:
                self.verify()
                with control_request():
                    self.store.renew(self.token)
            except Exception as error:
                if not self.failed.is_set():
                    try:
                        self._fail(error)
                    except LeaseLostError:
                        pass
                return

    def start(self):
        self.thread.start()
        return self

    def stop(self):
        self.closed.set()
        self.thread.join(timeout=12)
        if self.thread.is_alive():
            raise LeaseLostError('Heartbeat did not stop; lease must expire')


def activate(d1, token):
    global _active, _retired
    if _active is not None:
        raise LeaseLostError('Cannot replace an active job lease')
    from backend.utils.log.cloudflare_storage import D1Client
    if isinstance(d1, D1Client):
        from copy import copy
        d1 = copy(d1)
        d1.timeout = 5
    _retired = False
    _active = LeaseSession(d1, token)
    os.environ[TOKEN_ENV] = token
    _active.start()
    from backend.config.job_control import report_event
    report_event('lease_token', token=token)


def deactivate(token):
    global _active, _retired
    if _active is not None and _active.token == token:
        session = _active
        session.stop()
        _active = None
        _retired = True
        os.environ.pop(TOKEN_ENV, None)
        return not session.failed.is_set()
    return True


def before_mutation():
    if getattr(_local, 'control', False):
        return
    if _retired:
        raise LeaseLostError("Job lease has already been released")
    if _active is not None:
        _active.verify()
    elif os.environ.get(TOKEN_ENV):
        # Storage-capable subprocesses inherit ownership, never mint a new lease.
        from backend.utils.log.cloudflare_storage import D1Client
        with control_request():
            client = D1Client.from_environment()
            client.timeout = 5
            ExpiringLeaseStore(client).verify(os.environ[TOKEN_ENV])


def create_client(*args, **kwargs):
    from supabase import create_client as factory
    client = factory(*args, **kwargs)
    def check(request):
        if request.method not in {'GET', 'HEAD', 'OPTIONS'}:
            before_mutation()
    client.postgrest.session.event_hooks.setdefault('request', []).append(check)
    return client


def reconcile_predecessor(store):
    run_id = getattr(store, 'predecessor_run_id', None)
    if not isinstance(run_id, int):
        return
    from backend.utils.log.cloudflare_storage import write_recovery_envelope
    write_recovery_envelope('run_finalization', str(run_id), {
        'run_id': run_id, 'status': 'unconfirmed', 'reason': 'expired_lease_takeover',
    })
    rows = store.d1.execute('SELECT run_id FROM run_logs WHERE run_id = ?', (run_id,)).rows
    if rows:
        store.mark_run_unconfirmed(run_id, 'expired_lease_takeover', release_lease=False)
    client = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY'])
    result = client.table('utilRunLogs').update({'successful': False, 'running_now': False}).eq('run_id', run_id).execute()
    if not result.data:
        raise LeaseLostError('Predecessor finalization was not confirmed; new work refused')
    store.d1.execute("UPDATE run_locks SET predecessor_run_id = NULL WHERE id = 1 AND lease_token = ?", (_active.token,))
    store.predecessor_run_id = None


def run_cli(main, module):
    import sys
    from backend.config.job_control import report_event
    if os.environ.get('KARTISERET_LEASE_WORKER') == 'true':
        try:
            result = main()
            code = result if isinstance(result, int) else 0
        except SystemExit as error:
            code = error.code if isinstance(error.code, int) else (0 if error.code is None else 1)
        report_event('run_complete', successful=code == 0)
        return code
    from backend.config.job_supervisor import run_managed_process
    return run_managed_process([sys.executable, '-m', module, *sys.argv[1:]],
                               env={'KARTISERET_LEASE_WORKER': 'true'}).exit_code
