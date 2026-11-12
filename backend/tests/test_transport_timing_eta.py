from io import StringIO
import re
from time import sleep
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import Mock, patch

from rich.console import Console

from backend.config import runners
from backend.scraping.BaseCinema import BaseCinema
from backend.scraping.nowplayings.MovieLand import MovieLand
from backend.utils.console.progressBars import RichRunUI, RunResult, TransportColumn


class TransportTimingEtaTests(TestCase):
    def test_initial_eta_uses_preferred_transport_and_keeps_dataflow_legacy(self):
        class BrowserCinema(BaseCinema):
            DEFAULT_SCRAPE_MODE = 'selenium'
        flow = type('Dataflow', (), {})
        observed = []
        def load(client, names, machine, weekday, *, transport):
            observed.append((names, transport))
            return {name: 5 for name in names}
        with patch.dict('os.environ', {'SUPABASE_URL': 'https://example.test', 'SUPABASE_SERVICE_ROLE_KEY': 'test', 'RUNNER_MACHINE': 'm5_mac'}), patch.object(runners, 'create_client'), patch.object(runners, 'load_recent_averages', side_effect=load):
            estimates = runners._average_times([MovieLand, BrowserCinema, flow])
        self.assertEqual(observed, [(['MovieLand'], 'requests'), (['BrowserCinema'], 'selenium'), (['Dataflow'], 'legacy')])
        self.assertEqual(estimates, {'MovieLand': 5, 'BrowserCinema': 5, 'Dataflow': 5})

    def test_new_requests_bucket_never_uses_legacy_or_selenium_history(self):
        with patch.object(runners, '_average_times') as load:
            self.assertEqual(runners._transport_estimate(MovieLand, 'requests', 0, {}, {}), 60)
        load.assert_not_called()

    def test_fallback_prefers_its_combined_history_and_caches_lookup(self):
        cache = {}
        with patch.object(runners, '_average_times', return_value={'MovieLand': 45}) as load:
            for elapsed in (2, 4):
                self.assertEqual(runners._transport_estimate(MovieLand, 'requests_selenium_fallback', elapsed, {'MovieLand': 5}, cache), 45)
        load.assert_called_once_with([MovieLand], transport='requests_selenium_fallback')

    def test_cold_fallback_adds_failed_http_elapsed_to_browser_estimate(self):
        with patch.object(runners, '_average_times', side_effect=[{}, {'MovieLand': 80}]):
            estimate = runners._transport_estimate(MovieLand, 'requests_selenium_fallback', 7, {}, {})
        self.assertEqual(estimate, 87)

    def test_ui_replaces_item_duration_when_transport_changes(self):
        spec = SimpleNamespace(total_strategy='max', count_label='Scrapers', overall_task_name='Scrape', get_item_name=lambda cls: cls.__name__)
        ui = RichRunUI(spec, 'test', [MovieLand], lambda cls: 5, use_live=False, console=Console(file=StringIO()))
        ui.set_item_estimate(MovieLand, 45)
        self.assertEqual(ui.est_by_item[MovieLand], 45)
        self.assertEqual(ui.status.tasks[ui.status_task_id_by_item[MovieLand]].total, 45)

    def test_ui_marks_requests_selenium_and_fallback_rows(self):
        spec = SimpleNamespace(total_strategy='max', count_label='Scrapers', overall_task_name='Scrape', show_transport=True, get_item_name=lambda cls: cls.__name__)
        output = StringIO()
        ui = RichRunUI(spec, 'test', [MovieLand], lambda cls: 5, use_live=False, console=Console(file=output, width=120))
        ui.start_item(MovieLand)

        for transport, marker in (('requests', '·R·'), ('selenium', '·S·'), ('requests_selenium_fallback', '·S·')):
            with self.subTest(transport=transport):
                output.seek(0)
                output.truncate(0)
                ui.set_item_transport(MovieLand, transport)
                ui.console.print(ui.renderable)
                self.assertIn(marker + ' (1) MovieLand', output.getvalue())

    def test_finished_transport_uses_outcome_color(self):
        for transport in ('requests', 'selenium', 'requests_selenium_fallback'):
            for ok, color in ((True, 'green'), (False, 'red')):
                spec = SimpleNamespace(total_strategy='max', count_label='Scrapers', overall_task_name='Scrape', show_transport=True, get_item_name=lambda cls: cls.__name__)
                ui = RichRunUI(spec, 'test', [MovieLand], lambda cls: 5, use_live=False, console=Console(file=StringIO()))
                ui.start_item(MovieLand)
                ui.set_item_transport(MovieLand, transport)
                ui.finish_item(MovieLand, RunResult('MovieLand', 3, ok))
                task = ui.status.tasks[ui.status_task_id_by_item[MovieLand]]
                self.assertEqual(TransportColumn().render(task).style, f'bold {color}')

    def test_dataflow_rows_do_not_show_transport_markers(self):
        spec = SimpleNamespace(total_strategy='sum', count_label='Dataflows', overall_task_name='Dataflow', get_item_name=lambda cls: cls.__name__)
        output = StringIO()
        ui = RichRunUI(spec, 'test', [MovieLand], lambda cls: 5, use_live=False, console=Console(file=output, width=120))
        ui.start_item(MovieLand)
        ui.console.print(ui.renderable)
        self.assertIn('(1) MovieLand', output.getvalue())
        self.assertNotIn('·R·', output.getvalue())
        self.assertNotIn('·S·', output.getvalue())

    def test_scheduler_updates_fallback_eta_while_scrape_is_still_running(self):
        def run(spec, cls, key, run_id, attempt):
            spec.on_transport_change(cls, 'requests_selenium_fallback', 2)
            sleep(.3)
            return RunResult(cls.__name__, .3, True, attempt)
        def estimates(classes, *, transport=None, weekday=None):
            return {'MovieLand': 45 if transport else 5}
        with patch.object(runners, '_average_times', side_effect=estimates), patch.object(runners, '_run_attempt', side_effect=run), patch.object(RichRunUI, 'set_item_estimate', autospec=True) as update:
            self.assertTrue(runners._run_scheduled_scrapes([('allShowtimes', MovieLand)], 1, console=Console(file=StringIO())))
        self.assertTrue(any(call.args[1:] == (MovieLand, 45) for call in update.call_args_list))

    def test_scheduled_scrapes_marks_the_selected_transport(self):
        def run(spec, cls, key, run_id, attempt):
            spec.on_transport_change(cls, 'requests_selenium_fallback', 2)
            sleep(.3)
            return RunResult(cls.__name__, .3, True, attempt)
        def estimates(classes, *, transport=None, weekday=None):
            return {'MovieLand': 45 if transport else 5}
        with patch.object(runners, '_average_times', side_effect=estimates), patch.object(runners, '_run_attempt', side_effect=run), patch.object(RichRunUI, 'set_item_transport', autospec=True) as update:
            self.assertTrue(runners._run_scheduled_scrapes([('allShowtimes', MovieLand)], 1, console=Console(file=StringIO())))
        self.assertTrue(any(call.args[1:] == (MovieLand, 'requests_selenium_fallback') for call in update.call_args_list))

    def test_rungroup_marks_the_selected_transport(self):
        def run(spec, cls, key, run_id, attempt, request_context=None):
            spec.on_transport_change(cls, 'selenium', 1)
            return RunResult(cls.__name__, 1, True, attempt)
        with patch.object(runners, 'RUNNING_NON_INTERACTIVE', False), patch.object(runners, '_average_times', return_value={'MovieLand': 5}), patch.object(runners, '_run_attempt', side_effect=run), patch.object(RichRunUI, 'set_item_transport', autospec=True) as update:
            result = runners.runGroup('cinema', 'allShowtimes', 1, classes_override=[MovieLand], ui_parent=Mock(), console=Console(file=StringIO()), return_results=True)
        self.assertEqual(result, {MovieLand: True})
        self.assertTrue(any(call.args[1:] == (MovieLand, 'selenium') for call in update.call_args_list))

    def test_fallback_uses_captured_weekday_even_after_calendar_rollover(self):
        with patch.object(runners, '_average_times', return_value={'MovieLand': 45}) as load:
            self.assertEqual(runners._transport_estimate(MovieLand, 'requests_selenium_fallback', 2, {}, {}, weekday='sunday', preferred_weekday='sunday'), 45)
        load.assert_called_once_with([MovieLand], transport='requests_selenium_fallback', weekday='sunday')

    def test_new_attempt_after_midnight_does_not_reuse_previous_days_estimate(self):
        with patch.object(runners, '_average_times', return_value={'MovieLand': 9}) as load:
            result = runners._transport_estimate(MovieLand, 'requests', 0, {'MovieLand': 5}, {}, weekday='tuesday', preferred_weekday='monday')
        self.assertEqual(result, 9)
        load.assert_called_once_with([MovieLand], transport='requests', weekday='tuesday')
