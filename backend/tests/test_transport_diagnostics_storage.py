import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend.scraping.BaseCinema import BaseCinema


class TransportDiagnosticsStorageTests(unittest.TestCase):
    @patch('backend.utils.log.run_storage.RunArtifactStore')
    def test_records_transport_diagnostics_in_run_storage(self, store):
        scraper = SimpleNamespace(
            _snapshot_manifest_started=True, run_id=42, snapshot_id='snapshot',
            gathering_info={'hebrew_title': ['film']},
            _http_stats={'requests': 2, 'observed_retries': 1}, _coverage={'pages': 3},
        )
        BaseCinema._record_collection(scraper, 'requests', 0, 'successful')
        call = store.return_value.save_text_artifact.call_args.kwargs
        self.assertEqual(call['run_id'], 42)
        self.assertEqual(call['artifact_type'], 'scraper_transport')
        self.assertEqual(json.loads(call['text'])['requests'], 2)
        self.assertEqual(json.loads(call['text'])['coverage'], {'pages': 3})
        self.assertEqual(call['metadata']['outcome'], 'successful')
