"""Read Cinema City's public Wix movie and presentation collections over HTTP."""

from datetime import date, datetime
import re
from zoneinfo import ZoneInfo

import requests

from backend.scraping.utils.InitializeBaseCinema import CHROME_USER_AGENT
from backend.scraping.utils.ScrapeRequests import configure_scrape_session


BASE_URL = "https://www.cinema-city.co.il"
ACCESS_TOKENS_URL = f"{BASE_URL}/_api/v1/access-tokens"
COLLECTION_QUERY_URL = f"{BASE_URL}/_api/cloud-data/v2/items/query"
WIX_APP_ID_PATTERN = re.compile(r'"x-wix-grid-app-id"\s*:\s*"([^"]+)"')
PAGE_SIZE = 1000
JERUSALEM_TZ = ZoneInfo("Asia/Jerusalem")

EXCLUDED_TITLE_MARKERS = (
    "מדובב לרוסית",
    "בתרגום לצרפתית",
    "בתרגום לרוסית",
    "מתורגם לצרפתית",
    "מתורגם לרוסית",
)

KNOWN_VENUE_TYPES = {"", "לא מוגדר", "רגיל", "VIP", "Prime", "Lounge", "ONYX"}


def _response_json(response, description):
    response.raise_for_status()
    try:
        result = response.json()
    except (TypeError, ValueError) as error:
        raise ValueError(f"Cinema City {description} was not valid JSON") from error
    if not isinstance(result, dict):
        raise ValueError(f"Cinema City {description} had an unexpected JSON structure")
    return result


def _normalize_id(value, description):
    if value is None or isinstance(value, bool):
        raise ValueError(f"Cinema City {description} is missing")
    if isinstance(value, float):
        if not value.is_integer():
            raise ValueError(f"Cinema City {description} is not an integer identifier")
        value = int(value)
    result = str(value).strip()
    if not result:
        raise ValueError(f"Cinema City {description} is empty")
    if re.fullmatch(r"\d+\.0+", result):
        result = result.split(".", 1)[0]
    return result


def _local_date(value, description):
    if isinstance(value, dict):
        value = value.get("$date")
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Cinema City {description} is missing")
    try:
        return date.fromisoformat(value.strip()[:10])
    except ValueError as error:
        raise ValueError(f"Cinema City {description} is invalid: {value!r}") from error


def _event_datetime(value):
    if not isinstance(value, str):
        raise ValueError("Cinema City presentation is missing its date and time")
    normalized = value.strip()
    if not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?",
        normalized,
    ):
        raise ValueError(f"Cinema City presentation has an unexpected date/time: {value!r}")
    try:
        event_datetime = datetime.fromisoformat(normalized.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"Cinema City presentation has an invalid date/time: {value!r}") from error
    if event_datetime.tzinfo is None:
        return event_datetime.replace(tzinfo=JERUSALEM_TZ)
    return event_datetime.astimezone(JERUSALEM_TZ)


def _scrape_instant(scraper):
    scrape_time = getattr(scraper, "today_date", None)
    if not isinstance(scrape_time, datetime):
        raise ValueError("Cinema City scraper is missing its frozen scrape time")
    if scrape_time.tzinfo is None:
        return scrape_time.replace(tzinfo=JERUSALEM_TZ)
    return scrape_time.astimezone(JERUSALEM_TZ)


def _bootstrap_public_token(session, scraper):
    """Get the app id and site-issued public token without capturing token JSON."""
    stats = getattr(scraper, "_http_stats", None)
    # Count and retry the bootstrap GETs, but do not write the token response to
    # source artifacts. The public token is ephemeral and is only needed in the
    # Authorization header for the subsequent collection queries.
    configure_scrape_session(session, stats=stats, capture=False)
    session.headers.update({"User-Agent": CHROME_USER_AGENT})

    home = session.get(f"{BASE_URL}/", timeout=(10, 30))
    home.raise_for_status()
    app_match = WIX_APP_ID_PATTERN.search(home.text or "")
    if not app_match:
        raise ValueError("Cinema City homepage is missing its Wix app id")
    app_id = app_match.group(1)

    token_payload = _response_json(
        session.get(ACCESS_TOKENS_URL, timeout=(10, 30)),
        "public access-token response",
    )
    apps = token_payload.get("apps")
    if not isinstance(apps, dict):
        raise ValueError("Cinema City access-token response has no app token map")
    public_token = next(
        (
            app.get("accessToken")
            for app in apps.values()
            if isinstance(app, dict)
            and isinstance(app.get("accessToken"), str)
            and app["accessToken"].strip()
        ),
        None,
    )
    if not public_token:
        raise ValueError("Cinema City did not provide a public data token")

    # Start source-response capture only after the access-token response has
    # been consumed. Collection response artifacts contain source data, never
    # the token body.
    configure_scrape_session(session, stats=stats, retry_methods=("GET", "POST"))
    return app_id, public_token


def _query_collection(session, app_id, public_token, collection_name, *, require_total=False):
    offset = 0
    page_number = 0
    records = []
    source_ids = set()
    expected_total = None

    while True:
        page_number += 1
        sort_field = "externalId" if collection_name in {"SyncFeatures", "SyncPresentations"} else "_id"
        payload = {
            "dataCollectionId": collection_name,
            "query": {
                "paging": {"limit": PAGE_SIZE, "offset": offset},
                "sort": [{"fieldName": sort_field, "order": "ASC"}],
            },
            "referencedItemOptions": [],
            "returnTotalCount": True,
            "environment": "LIVE",
            "appId": app_id,
        }
        response = session.post(
            COLLECTION_QUERY_URL,
            json=payload,
            headers={"Authorization": public_token, "Content-Type": "application/json"},
            timeout=(10, 30),
        )
        result = _response_json(response, f"{collection_name} collection response")
        items = result.get("dataItems")
        paging = result.get("pagingMetadata")
        if not isinstance(items, list) or not isinstance(paging, dict):
            raise ValueError(f"Cinema City {collection_name} response is missing data or paging metadata")
        if not isinstance(paging.get("hasNext"), bool):
            raise ValueError(f"Cinema City {collection_name} response is missing hasNext paging evidence")
        page_total = paging.get("total")
        if page_total is None:
            if require_total:
                raise ValueError(f"Cinema City {collection_name} response is missing total-count paging evidence")
        elif isinstance(page_total, bool) or not isinstance(page_total, int) or page_total < 0:
            raise ValueError(f"Cinema City {collection_name} returned an invalid total count")
        elif expected_total is None:
            expected_total = page_total
        elif page_total != expected_total:
            raise ValueError(f"Cinema City {collection_name} total count changed during pagination")
        if paging.get("offset") is not None and paging["offset"] != offset:
            raise ValueError(f"Cinema City {collection_name} returned the wrong page offset")
        if paging["hasNext"] and not items:
            raise ValueError(f"Cinema City {collection_name} pagination stalled at offset {offset}")
        if len(items) > PAGE_SIZE:
            raise ValueError(f"Cinema City {collection_name} exceeded the requested page size")
        if expected_total is not None and len(records) + len(items) > expected_total:
            raise ValueError(f"Cinema City {collection_name} exceeded its reported total count")

        for item in items:
            if not isinstance(item, dict) or not isinstance(item.get("data"), dict):
                raise ValueError(f"Cinema City {collection_name} contains a malformed data item")
            source_id = item.get("id") or item["data"].get("_id")
            if source_id:
                source_id = _normalize_id(source_id, f"{collection_name} source row id")
                if source_id in source_ids:
                    raise ValueError(f"Cinema City {collection_name} pagination repeated a source row")
                source_ids.add(source_id)
            records.append(item["data"])

        if not paging["hasNext"]:
            if expected_total is not None and len(records) != expected_total:
                raise ValueError(
                    f"Cinema City {collection_name} pagination ended after {len(records)} rows; "
                    f"source reported {expected_total}"
                )
            break
        offset += len(items)
        if page_number > 100:
            raise ValueError(f"Cinema City {collection_name} pagination exceeded its safety limit")

    return records, page_number


def _screening_title(title):
    if not isinstance(title, str) or not title.strip():
        raise ValueError("Cinema City film has no Hebrew title")
    hebrew_title = title.strip()
    if any(marker in hebrew_title for marker in EXCLUDED_TITLE_MARKERS):
        return None

    dub_language = None
    if "מדובב לצרפתית" in hebrew_title:
        dub_language = "French"
        hebrew_title = re.sub(r"\s*[-–—־]?\s*מדובב לצרפתית\s*[-–—־]?\s*", "", hebrew_title).strip()
    elif "מדובב" in hebrew_title:
        dub_language = "Hebrew"
        hebrew_title = re.sub(r"\s*[-–—־]?\s*מדובב\s*[-–—־]?\s*", "", hebrew_title).strip()
    elif "אנגלית" in hebrew_title:
        hebrew_title = re.sub(r"\s*[-–—־]?\s*אנגלית\s*[-–—־]?\s*", "", hebrew_title).strip()

    if "HFR תלת מימד" in hebrew_title:
        tech_prefix = "3D HFR"
        hebrew_title = re.sub(r"\s*[-–—־]?\s*HFR תלת מימד\s*[-–—־]?\s*", "", hebrew_title).strip()
    elif "HFR" in hebrew_title:
        tech_prefix = "2D HFR"
        hebrew_title = re.sub(r"\s*[-–—־]?\s*HFR\s*[-–—־]?\s*", "", hebrew_title).strip()
    elif "תלת מימד" in hebrew_title:
        tech_prefix = "3D"
        hebrew_title = re.sub(r"\s*[-–—־]?\s*תלת מימד\s*[-–—־]?\s*", "", hebrew_title).strip()
    else:
        tech_prefix = "2D"
    if not hebrew_title:
        raise ValueError("Cinema City film title became empty after its screening suffix was removed")
    return hebrew_title, dub_language, tech_prefix


def collect_cinema_city(scraper):
    scraper._coverage = {
        "locations_expected": 0,
        "locations_validated": 0,
        "features_expected": 0,
        "features_referenced": 0,
        "presentations_expected": 0,
        "presentations_collected": 0,
        "presentations_skipped_by_title": 0,
        "presentations_skipped_expired": 0,
        "duplicate_event_ids_skipped": 0,
        "duplicate_showtime_options_skipped": 0,
        "collection_pages": {},
    }

    with requests.Session() as session:
        app_id, public_token = _bootstrap_public_token(session, scraper)
        locations, location_pages = _query_collection(session, app_id, public_token, "CityDynamicPage")
        features, feature_pages = _query_collection(session, app_id, public_token, "SyncFeatures")
        presentations, presentation_pages = _query_collection(session, app_id, public_token, "SyncPresentations")

    active_locations = {
        location.get("hebrewName", "").strip()
        for location in locations
        if isinstance(location.get("hebrewName"), str)
        and location.get("hebrewName", "").strip()
        and location.get("active") is True
        and location.get("hasPresentations") is True
    }
    if not active_locations:
        raise ValueError("Cinema City location collection contains no active presentation locations")
    scraper._coverage["locations_expected"] = len(active_locations)
    scraper._coverage["locations_validated"] = len(active_locations)
    scraper._coverage["features_expected"] = len(features)
    scraper._coverage["presentations_expected"] = len(presentations)
    scraper._coverage["collection_pages"] = {
        "CityDynamicPage": location_pages,
        "SyncFeatures": feature_pages,
        "SyncPresentations": presentation_pages,
    }

    feature_by_id = {}
    for feature in features:
        if feature.get("externalId") is None:
            continue
        feature_id = _normalize_id(feature.get("externalId"), "feature id")
        if feature_id in feature_by_id:
            raise ValueError(f"Cinema City feature catalog repeats feature id {feature_id}")
        feature_by_id[feature_id] = feature

    referenced_features = set()
    seen_events = set()
    seen_showtime_options = set()
    scrape_instant = _scrape_instant(scraper)
    for event in presentations:
        if event.get("externalId") is None:
            raise ValueError("Cinema City presentation has no ticket event id")
        event_id = _normalize_id(event.get("externalId"), "ticket event id")
        feature_id = _normalize_id(event.get("featureId"), "presentation feature id")
        feature = feature_by_id.get(feature_id)
        if feature is None:
            raise ValueError(f"Cinema City presentation references undiscovered feature {feature_id}")
        referenced_features.add(feature_id)

        location_name = event.get("locationName")
        if not isinstance(location_name, str) or location_name.strip() not in active_locations:
            raise ValueError(f"Cinema City presentation references an undiscovered location: {location_name!r}")

        # The current browser collector keeps one row per event id per film.
        event_key = (feature_id, event_id)
        if event_key in seen_events:
            scraper._coverage["duplicate_event_ids_skipped"] += 1
            continue
        seen_events.add(event_key)

        normalized = _screening_title(feature.get("name"))
        if normalized is None:
            scraper._coverage["presentations_skipped_by_title"] += 1
            continue
        hebrew_title, dub_language, tech_prefix = normalized

        additional_name = feature.get("additionalName")
        if additional_name is not None and not isinstance(additional_name, str):
            raise ValueError(f"Cinema City feature {feature_id} has an invalid English title")
        english_title = (additional_name or "").replace("\u200b", "").strip() or hebrew_title
        if not english_title:
            raise ValueError(f"Cinema City feature {feature_id} has no usable English title")

        duration = feature.get("duration")
        if duration is not None:
            if isinstance(duration, bool):
                raise ValueError(f"Cinema City feature {feature_id} has an invalid runtime")
            try:
                runtime_value = float(duration)
            except (TypeError, ValueError) as error:
                raise ValueError(f"Cinema City feature {feature_id} has an invalid runtime") from error
            if not runtime_value.is_integer():
                raise ValueError(f"Cinema City feature {feature_id} runtime is not a whole number of minutes")
            runtime = int(runtime_value)
        else:
            runtime = None

        rating = feature.get("ratingName")
        if rating is not None and not isinstance(rating, str):
            raise ValueError(f"Cinema City feature {feature_id} has an invalid rating")
        event_datetime = _event_datetime(event.get("dateTime"))
        showtime = event_datetime.strftime("%H:%M")
        date_of_showing = _local_date(event.get("businessDate"), "presentation business date").isoformat()

        base_showtech = event.get("venueTypeName")
        if base_showtech is None:
            base_showtech = ""
        if not isinstance(base_showtech, str):
            raise ValueError(f"Cinema City presentation {event_id} has an invalid room type")
        base_showtech = base_showtech.strip()
        if base_showtech not in KNOWN_VENUE_TYPES:
            raise ValueError(f"Cinema City presentation {event_id} has an unmapped room type: {base_showtech!r}")
        if base_showtech == "לא מוגדר":
            base_showtech = ""

        # Wix's browser selector exposes one option for a film/location/room/
        # date/time combination, even if SyncPresentations contains multiple
        # ticket event ids for it. Since the collection is ordered by event id,
        # retaining the first option matches the event id the page exposes.
        option_key = (feature_id, location_name.strip(), base_showtech, date_of_showing, showtime)
        # Wix can retain same-day presentations in its collection after the
        # browser selectors stop offering them. Compare the actual local start
        # instant, not businessDate, which can differ for after-midnight shows.
        if event_datetime <= scrape_instant:
            scraper._coverage["presentations_skipped_expired"] += 1
            continue
        if option_key in seen_showtime_options:
            scraper._coverage["duplicate_showtime_options_skipped"] += 1
            continue
        seen_showtime_options.add(option_key)

        scraper.showtime = showtime
        scraper.english_title = english_title
        scraper.hebrew_title = hebrew_title
        scraper.english_href = f"https://tickets.cinema-city.co.il/order/{event_id}?lang=en"
        scraper.hebrew_href = f"https://tickets.cinema-city.co.il/order/{event_id}?lang=he"
        scraper.screening_type = base_showtech or None
        scraper.screening_tech = f"{tech_prefix} {base_showtech}".strip()
        scraper.original_language = None
        scraper.dub_language = dub_language
        scraper.date_of_showing = date_of_showing
        scraper.release_year = None
        scraper.release_date = None
        scraper.directed_by = None
        scraper.runtime = runtime
        scraper.rating = rating
        scraper.screening_city = location_name.strip()
        scraper.appendToGatheringInfo()
        scraper._coverage["presentations_collected"] += 1

    scraper._coverage["features_referenced"] = len(referenced_features)
    accounted_presentations = sum(
        scraper._coverage[key]
        for key in (
            "presentations_collected",
            "presentations_skipped_by_title",
            "presentations_skipped_expired",
            "duplicate_event_ids_skipped",
            "duplicate_showtime_options_skipped",
        )
    )
    if accounted_presentations != scraper._coverage["presentations_expected"]:
        raise ValueError(
            "Cinema City presentation accounting is incomplete: "
            f"expected {scraper._coverage['presentations_expected']}, accounted for {accounted_presentations}"
        )

    if not presentations:
        scraper.confirmEmptySnapshot("Complete SyncPresentations collection returned no Cinema City events")
    elif not scraper._coverage["presentations_collected"]:
        scraper.confirmEmptySnapshot(
            "Complete SyncPresentations collection yielded no current Cinema City screenings; "
            f"expired={scraper._coverage['presentations_skipped_expired']}, "
            f"title_filtered={scraper._coverage['presentations_skipped_by_title']}"
        )


COMING_SOON_EXCLUDED_TITLE_MARKERS = (
    "מדובב לרוסית",
    "בתרגום לרוסית",
    "מדובב לצרפתית",
    "בתרגום לצרפתית",
    "מתורגם לצרפתית",
    "מתורגם לרוסית",
    "סינמה קידס",
    "cook",
    "מדובב",
    "hfr",
)


def _coming_soon_title(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Cinema City feature has no Hebrew title")
    title = value.strip()
    if any(marker in title.lower() for marker in COMING_SOON_EXCLUDED_TITLE_MARKERS):
        return None
    if "תלת מימד" in title:
        title = re.sub(r"\s*[-–—־]?\s*תלת מימד\s*[-–—־]?\s*", "", title).strip()
    elif "אנגלית" in title:
        title = re.sub(r"\s*[-–—־]?\s*אנגלית\s*[-–—־]?\s*", "", title).strip()
    if not title:
        raise ValueError("Cinema City coming-soon title became empty after removing its suffix")
    return title


def _coming_soon_runtime(value, feature_id):
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if isinstance(value, bool):
        raise ValueError(f"Cinema City feature {feature_id} has an invalid runtime")
    try:
        runtime_value = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"Cinema City feature {feature_id} has an invalid runtime") from error
    if not runtime_value.is_integer():
        raise ValueError(f"Cinema City feature {feature_id} runtime is not a whole number of minutes")
    return int(runtime_value)


def collect_cinema_city_coming_soon(scraper):
    scraper._coverage = {
        "features_expected": 0,
        "features_upcoming_expected": 0,
        "features_collected": 0,
        "features_skipped_before_today": 0,
        "features_skipped_with_presentations": 0,
        "features_skipped_by_title": 0,
        "collection_pages": 0,
    }

    with requests.Session() as session:
        app_id, public_token = _bootstrap_public_token(session, scraper)
        features, feature_pages = _query_collection(
            session, app_id, public_token, "SyncFeatures", require_total=True
        )

    today = scraper.today_date.date()
    scraper._coverage["features_expected"] = len(features)
    scraper._coverage["collection_pages"] = feature_pages
    seen_feature_ids = set()

    for feature in features:
        feature_id = _normalize_id(feature.get("externalId"), "coming-soon feature id")
        if feature_id in seen_feature_ids:
            raise ValueError(f"Cinema City feature catalog repeats feature id {feature_id}")
        seen_feature_ids.add(feature_id)

        # Validate release dates for the entire discovered catalog before using
        # them to decide which films are still coming soon.
        release_date = _local_date(feature.get("dateStarted"), f"feature {feature_id} release date")
        if "closestPresentationDateTime" not in feature:
            raise ValueError(f"Cinema City feature {feature_id} is missing presentation-status evidence")
        closest_presentation = feature.get("closestPresentationDateTime")
        if closest_presentation is not None:
            _local_date(closest_presentation, f"feature {feature_id} closest presentation date")
        if release_date < today:
            scraper._coverage["features_skipped_before_today"] += 1
            continue
        scraper._coverage["features_upcoming_expected"] += 1
        if closest_presentation is not None:
            scraper._coverage["features_skipped_with_presentations"] += 1
            continue

        title = _coming_soon_title(feature.get("name"))
        if title is None:
            scraper._coverage["features_skipped_by_title"] += 1
            continue

        additional_name = feature.get("additionalName")
        if additional_name is not None and not isinstance(additional_name, str):
            raise ValueError(f"Cinema City feature {feature_id} has an invalid English title")
        english_title = (additional_name or "").replace("\u200b", "").strip() or title

        rating = feature.get("ratingName")
        if rating is not None and not isinstance(rating, str):
            raise ValueError(f"Cinema City feature {feature_id} has an invalid rating")

        scraper.showtime = None
        scraper.english_title = english_title
        scraper.hebrew_title = title
        scraper.english_href = None
        scraper.hebrew_href = None
        scraper.screening_type = None
        scraper.screening_tech = None
        scraper.original_language = None
        scraper.dub_language = None
        scraper.date_of_showing = None
        scraper.release_year = None
        scraper.release_date = release_date.isoformat()
        scraper.directed_by = None
        scraper.runtime = _coming_soon_runtime(feature.get("duration"), feature_id)
        scraper.rating = rating
        scraper.screening_city = None
        scraper.appendToGatheringInfo()
        scraper._coverage["features_collected"] += 1

    accounted_features = sum(
        scraper._coverage[key]
        for key in (
            "features_collected",
            "features_skipped_before_today",
            "features_skipped_with_presentations",
            "features_skipped_by_title",
        )
    )
    if accounted_features != scraper._coverage["features_expected"]:
        raise ValueError(
            "Cinema City feature accounting is incomplete: "
            f"expected {scraper._coverage['features_expected']}, accounted for {accounted_features}"
        )

    if not features:
        scraper.confirmEmptySnapshot("Complete SyncFeatures catalog returned no Cinema City films")
    elif not scraper._coverage["features_collected"]:
        scraper.confirmEmptySnapshot(
            "Complete SyncFeatures catalog yielded no upcoming films after release-date and title filters"
        )
