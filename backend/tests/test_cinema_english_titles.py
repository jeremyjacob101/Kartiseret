from unittest import TestCase
from collections import defaultdict
from types import SimpleNamespace

from backend.scraping.utils.EnglishTitles import english_title_or_empty
from backend.scraping.utils.FormatAndAppend import AppendToInfo
from backend.dataflow.nowplayings.utils.NowPlayingsHelpers import NowPlayingsHelpers
from backend.dataflow.utils.DataflowHelpers import DataflowHelpers
import test_raw_cleaning_scope as scope
import test_tmdb_publication as publication


class TitleMapping(NowPlayingsHelpers, DataflowHelpers):
    def __init__(self, rows):
        self.main_table_rows = rows


class CinemaEnglishTitleTests(TestCase):
    def test_source_english_is_kept_and_hebrew_is_not_used(self):
        self.assertEqual(english_title_or_empty(' Matchmaking 3 '), 'Matchmaking 3')
        self.assertEqual(english_title_or_empty('תמונות יפואיות 2'), '')
        self.assertEqual(english_title_or_empty(''), '')
        self.assertEqual(english_title_or_empty('1917', '1917'), '1917')
        self.assertEqual(english_title_or_empty('2', 'תמונות יפואיות 2'), '')
        self.assertEqual(english_title_or_empty('Название 2'), '')

    def test_scraper_appends_missing_english_without_changing_hebrew(self):
        row = SimpleNamespace(
            CINEMA_NAME='Hot Cinema', english_title='תמונות יפואיות 2',
            hebrew_title='תמונות יפואיות 2', gathering_info=defaultdict(list),
            showtime='20:00', english_href='', hebrew_href='', screening_type='',
            screening_tech='', original_language='', dub_language='', date_of_showing='',
            release_year=None, release_date=None, directed_by='', runtime=None,
            rating='', screening_city='', run_id=1,
        )
        for name in ('fixScreeningType', 'fixScreeningTech', 'fixCinemaName', 'fixLanguage', 'fixRating'):
            setattr(row, name, lambda: None)
        AppendToInfo.appendToGatheringInfo(row)
        self.assertEqual(row.gathering_info['english_title'], [''])
        self.assertEqual(row.gathering_info['hebrew_title'], ['תמונות יפואיות 2'])

    def test_yes_planet_fills_all_cinemas_and_preserves_source_titles(self):
        rows = [
            {'cinema': 'Yes Planet', 'hebrew_title': 'תמונות יפואיות 2', 'english_title': 'Jaffa 2'},
            *[{'cinema': c, 'hebrew_title': 'תמונות יפואיות 2', 'english_title': ''} for c in ('Cinema City', 'Hot Cinema', 'MovieLand', 'Lev Cinema', 'Rav Hen')],
            {'cinema': 'Rav Hen', 'hebrew_title': 'תמונות יפואיות 2', 'english_title': 'תמונות יפואיות 2'},
            {'cinema': 'Hot Cinema', 'hebrew_title': 'תמונות יפואיות 2', 'english_title': 'Actual English'},
        ]
        TitleMapping(rows).applyYesPlanetHebrewToRavHenEnglish()
        self.assertEqual([row['english_title'] for row in rows[1:7]], ['Jaffa 2'] * 6)
        self.assertEqual(rows[-1]['english_title'], 'Actual English')

    def test_missing_and_conflicting_mappings_remain_unresolved(self):
        rows = [
            {'cinema': 'Yes Planet', 'hebrew_title': 'שם', 'english_title': 'One'},
            {'cinema': 'Yes Planet', 'hebrew_title': 'שם', 'english_title': 'Two'},
            {'cinema': 'MovieLand', 'hebrew_title': 'שם', 'english_title': 'שם'},
            {'cinema': 'Cinema City', 'hebrew_title': 'אחר', 'english_title': ''},
            {'cinema': 'Yes Planet', 'hebrew_title': 'תמונות 2', 'english_title': '2'},
            {'cinema': 'Rav Hen', 'hebrew_title': 'תמונות 2', 'english_title': 'תמונות 2'},
        ]
        TitleMapping(rows).applyYesPlanetHebrewToRavHenEnglish()
        self.assertEqual([r['english_title'] for r in rows[2:]], ['', '', '', ''])

    def test_clean_preserves_unresolved_raw_rows_and_maps_yes_planet(self):
        for path, table in [('nowplayings.NowPlayingsClean', 'allShowtimes'), ('comingsoons.ComingSoonsClean', 'allSoons')]:
            with self.subTest(table=table):
                rows = [scope.raw(snapshot_id='yp', cinema='Yes Planet', hebrew_title='שם', english_title='English title'),
                        scope.raw(snapshot_id='rh', cinema='Rav Hen', hebrew_title='שם', english_title='שם'),
                        scope.raw(snapshot_id='ml', cinema='MovieLand', hebrew_title='חסר', english_title='חסר 2')]
                case = scope.RawCleaningScopeTests()
                flow = case.build(path, table, rows, [], mapping=False)
                try:
                    flow.logic()
                    stored = {r['id']: r for r in flow.supabase.tables[table]}
                    self.assertEqual(stored[rows[1]['id']]['english_title'], 'english title')
                    self.assertEqual(stored[rows[2]['id']]['english_title'], '')
                    self.assertFalse(stored[rows[2]['id']]['cleaned'])
                finally:
                    case.doCleanups()

    def test_missing_title_is_not_searched_or_marked_added_and_can_retry(self):
        for path in ('nowplayings.NowPlayingsTmdb', 'comingsoons.ComingSoonsTmdb'):
            with self.subTest(flow=path):
                case = publication.PublicationTests()
                case.setUp()
                try:
                    flow = case.build_flow(path, [publication.raw_row('missing', '')])
                    case.install_snapshot(flow, flow.supabase.tables[flow.MAIN_TABLE_NAME])
                    calls = []
                    original = flow.tmdbGet
                    def tracked(request_path, params=None, **kwargs):
                        calls.append((request_path, params))
                        return original(request_path, params, **kwargs)
                    flow.tmdbGet = tracked
                    flow.logic()
                    self.assertFalse(flow.supabase.tables[flow.MAIN_TABLE_NAME][0]['added'])
                    self.assertFalse(any(path == 'search/movie' for path, _ in calls))
                    self.assertFalse(flow.supabase.tables[flow.MOVING_TO_TABLE_NAME])
                    flow.supabase.tables[flow.MAIN_TABLE_NAME][0]['english_title'] = 'Alpha'
                    retry = case.build_flow(path, [], database=flow.supabase)
                    retry.logic()
                    self.assertTrue(flow.supabase.tables[flow.MAIN_TABLE_NAME][0]['added'])
                    self.assertEqual(flow.supabase.tables[flow.MOVING_TO_TABLE_NAME][0]['tmdb_id'], 101)
                finally:
                    case.doCleanups()
