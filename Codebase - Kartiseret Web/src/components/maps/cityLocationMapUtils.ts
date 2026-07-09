import { type Marker, type Offset, type PositionAnchor, LngLat, LngLatBounds, Map as MapLibreMap, Popup } from "maplibre-gl";
import { type Theater } from "../../data/theaters";

export const MAP_STYLE_URL =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
export const CITY_START_BOUNDS: [[number, number], [number, number]] = [
  [34.48, 31.18],
  [35.34, 33.02],
];
export const CITY_START_BOUNDS_MOBILE: [[number, number], [number, number]] = [
  [34.48, 31.06],
  [35.34, 32.9],
];
export const INITIAL_MAP_CENTER: [number, number] = [34.96, 32.15];
export const INITIAL_MAP_CENTER_MOBILE: [number, number] = [34.96, 32.03];
export const INITIAL_MAP_ZOOM = 2;
export const CITY_OPACITY_BASE = 0.01;
export const CITY_OPACITY_STEP = 0.085;
export const CITY_MAX_PRE_REVEAL_OPACITY = 0.9;
export const SELECTED_CITY_Z_INDEX = "200";
export const SEARCH_RESULT_Z_INDEX_OFFSET = 1000;
export const THEATER_MARKER_Z_INDEX = "10";
export const HOVERED_THEATER_MARKER_Z_INDEX = "1400";
export const THEATER_POPUP_EDGE_PADDING = 14;
export const THEATER_POPUP_OFFSET_Y = 14;
export const THEATER_POPUP_MIN_WIDTH = 180;
export const THEATER_POPUP_MAX_WIDTH = 320;
export const PRIMARY_CITY_COLLISION_PADDING = { x: 18, y: 14 };
export const THEATER_POPUP_ANCHOR_CANDIDATES: readonly PositionAnchor[] = [
  "top",
  "right",
  "left",
  "bottom",
  "top-right",
  "top-left",
  "bottom-right",
  "bottom-left",
];
export const THEATER_POPUP_OFFSET: Offset = {
  center: [0, 0],
  top: [0, THEATER_POPUP_OFFSET_Y],
  "top-left": [0, THEATER_POPUP_OFFSET_Y],
  "top-right": [0, THEATER_POPUP_OFFSET_Y],
  bottom: [0, -THEATER_POPUP_OFFSET_Y],
  "bottom-left": [0, -THEATER_POPUP_OFFSET_Y],
  "bottom-right": [0, -THEATER_POPUP_OFFSET_Y],
  left: [THEATER_POPUP_OFFSET_Y, 0],
  right: [-THEATER_POPUP_OFFSET_Y, 0],
};
export const CITY_LABEL_NORTH_OFFSET = 0.00615;
export const OVERVIEW_CENTER_TOLERANCE = 0.00035;
export const OVERVIEW_ZOOM_TOLERANCE = 0.04;
export const OVERVIEW_BEARING_TOLERANCE = 0.01;
export const OVERVIEW_PITCH_TOLERANCE = 0.01;
export const MAP_MAX_ZOOM = 16.5;
export const SINGLE_CITY_FOCUS_ZOOM = 11.6;
export const ROAD_LABEL_KEYWORDS = [
  "road",
  "street",
  "highway",
  "motorway",
  "route",
  "transport",
];
export const NON_ROAD_LABEL_KEYWORDS = [
  "place",
  "country",
  "state",
  "settlement",
  "city",
  "town",
  "village",
  "hamlet",
  "suburb",
  "neighbourhood",
  "neighborhood",
  "quarter",
  "poi",
  "airport",
  "marine",
  "water",
  "ocean",
  "sea",
  "mountain",
  "park",
  "natural",
  "transit",
  "rail",
  "admin",
  "boundary",
  "housenumber",
];
export const ENGLISH_LABEL_TEXT_FIELD = [
  "coalesce",
  ["get", "name_en"],
  ["get", "name:en"],
  ["get", "name:latin"],
  ["get", "name_int"],
  ["get", "name"],
] as const;
export const SECONDARY_CITIES: ReadonlyArray<{
  name: string;
  center: [number, number];
  minZoom: number;
  priority: number;
}> = [
  { name: "Acre", center: [35.0818, 32.924], minZoom: 9.35, priority: 72 },
  { name: "Safed", center: [35.496, 32.964], minZoom: 9.95, priority: 54 },
  { name: "Tiberias", center: [35.533, 32.794], minZoom: 9.55, priority: 76 },
  { name: "Nazareth", center: [35.2972, 32.6996], minZoom: 9.45, priority: 78 },
  { name: "Hadera", center: [34.9197, 32.434], minZoom: 9.9, priority: 52 },
  { name: "Kfar Yona", center: [34.935, 32.3166], minZoom: 9.8, priority: 46 },
  { name: "Holon", center: [34.7792, 32.0158], minZoom: 9.85, priority: 60 },
  { name: "Bat Yam", center: [34.7519, 32.023], minZoom: 9.95, priority: 56 },
  {
    name: "Ramat Gan",
    center: [34.8248, 32.0706],
    minZoom: 9.85,
    priority: 66,
  },
  {
    name: "Bnei Brak",
    center: [34.8334, 32.0836],
    minZoom: 10.1,
    priority: 50,
  },
  { name: "Lod", center: [34.8881, 31.951], minZoom: 9.85, priority: 58 },
  { name: "Ramla", center: [34.8675, 31.9316], minZoom: 9.95, priority: 54 },
  { name: "Yavne", center: [34.7386, 31.8781], minZoom: 10.05, priority: 46 },
  {
    name: "Ness Ziona",
    center: [34.7987, 31.9293],
    minZoom: 9.1,
    priority: 42,
  },
  { name: "Ramallah", center: [35.2045, 31.9038], minZoom: 9.75, priority: 72 },
  { name: "Bethlehem", center: [35.2034, 31.7054], minZoom: 9.9, priority: 64 },
  { name: "Hebron", center: [35.0998, 31.5326], minZoom: 9.85, priority: 68 },
  { name: "Jericho", center: [35.4581, 31.8702], minZoom: 10.1, priority: 40 },
  { name: "Nablus", center: [35.262, 32.2211], minZoom: 9.75, priority: 70 },
  { name: "Tulkarm", center: [35.0124, 32.3114], minZoom: 10, priority: 44 },
  {
    name: "Qalqilya",
    center: [34.9706, 32.1896],
    minZoom: 10.05,
    priority: 38,
  },
];

export type CityEntry = {
  location: string;
  center: [number, number];
  labelCenter: [number, number];
  searchTerms: string[];
  theaterCount: number;
  chains: string[];
  zoomLayer: number;
};

export type CityRevealConfig = {
  fallbackRevealZoom: number;
  opacityLayers: number[];
  zIndexByRevealZoom: Map<number, string>;
};

export type CityMarkerState = {
  element: HTMLButtonElement;
  surface: HTMLSpanElement;
  center: [number, number];
  priority: number;
  minZoom: number;
};

export type TheaterMarkerState = {
  marker: Marker;
  element: HTMLButtonElement;
  location: string;
  popup: Popup;
};

export type RectBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type SecondaryCityMarkerState = {
  element: HTMLSpanElement;
  center: [number, number];
  priority: number;
  minZoom: number;
};

export const THEATER_DOT_COLORS: Record<string, string> = {
  "Yes Planet": "#d9710f",
  "Cinema City": "#186bdf",
  "Lev Cinema": "#b50519",
  "Rav Hen": "#ab5306",
  "Hot Cinema": "#f06a87",
  MovieLand: "#a80371",
  Cinematheque: "#31a26d",
};

export function getFitPadding() {
  return window.innerWidth <= 720
    ? { top: 24, right: 18, bottom: 24, left: 18 }
    : { top: 30, right: 28, bottom: 30, left: 28 };
}

export function getStartBounds(): [[number, number], [number, number]] {
  return window.innerWidth <= 720
    ? CITY_START_BOUNDS_MOBILE
    : CITY_START_BOUNDS;
}

export function getInitialMapCenter(): [number, number] {
  return window.innerWidth <= 720
    ? INITIAL_MAP_CENTER_MOBILE
    : INITIAL_MAP_CENTER;
}

export function isMapAtStartingView(map: MapLibreMap) {
  const overviewCamera = map.cameraForBounds(getStartBounds(), {
    padding: getFitPadding(),
    maxZoom: 6.9,
  });

  if (!overviewCamera?.center || overviewCamera.zoom === undefined) {
    return false;
  }

  const overviewCenter = LngLat.convert(overviewCamera.center);
  const currentCenter = map.getCenter();

  return (
    Math.abs(currentCenter.lng - overviewCenter.lng) <=
      OVERVIEW_CENTER_TOLERANCE &&
    Math.abs(currentCenter.lat - overviewCenter.lat) <=
      OVERVIEW_CENTER_TOLERANCE &&
    Math.abs(map.getZoom() - overviewCamera.zoom) <= OVERVIEW_ZOOM_TOLERANCE &&
    Math.abs(map.getBearing() - (overviewCamera.bearing ?? 0)) <=
      OVERVIEW_BEARING_TOLERANCE &&
    Math.abs(map.getPitch()) <= OVERVIEW_PITCH_TOLERANCE
  );
}

export function buildBounds(
  points: readonly [number, number][],
): LngLatBounds | null {
  const [firstPoint, ...remainingPoints] = points;

  if (!firstPoint) {
    return null;
  }

  const bounds = new LngLatBounds(firstPoint, firstPoint);

  for (const point of remainingPoints) {
    bounds.extend(point);
  }

  return bounds;
}

export function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function getDistanceMeters(
  first: [number, number],
  second: [number, number],
) {
  const earthRadiusMeters = 6_371_000;
  const deltaLat = toRadians(second[1] - first[1]);
  const deltaLng = toRadians(second[0] - first[0]);
  const firstLat = toRadians(first[1]);
  const secondLat = toRadians(second[1]);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(firstLat) * Math.cos(secondLat) * Math.sin(deltaLng / 2) ** 2;

  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine));
}

export function getNearestCityLocation(
  point: [number, number],
  entries: readonly CityEntry[],
) {
  let nearestLocation: string | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const entry of entries) {
    const distance = getDistanceMeters(point, entry.center);

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestLocation = entry.location;
    }
  }

  return nearestLocation;
}

export function getGeolocationErrorMessage(error: GeolocationPositionError) {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "Location access was denied.";
    case error.POSITION_UNAVAILABLE:
      return "Your location could not be determined.";
    case error.TIMEOUT:
      return "Location lookup timed out.";
    default:
      return "Location lookup failed.";
  }
}

export function buildCityEntries(theaters: readonly Theater[]): CityEntry[] {
  const theatersByCity = new Map<string, Theater[]>();

  for (const theater of theaters) {
    const cityTheaters = theatersByCity.get(theater.city.name) ?? [];
    cityTheaters.push(theater);
    theatersByCity.set(theater.city.name, cityTheaters);
  }

  return [...theatersByCity.entries()]
    .sort(([leftLocation], [rightLocation]) =>
      leftLocation.localeCompare(rightLocation))
    .map(([location, cityTheaters]) => {
      const firstTheater = cityTheaters[0];
      const cityLatitude = firstTheater.city.latitude;
      const cityLongitude = firstTheater.city.longitude;

      return {
        location,
        center: [cityLongitude, cityLatitude - CITY_LABEL_NORTH_OFFSET],
        labelCenter: [cityLongitude, cityLatitude],
        searchTerms: [
          ...new Set(
            cityTheaters
              .flatMap((theater) => theater.city.altSpellings)
              .concat(location),
          ),
        ].map(normalizeCitySearchQuery),
        theaterCount: cityTheaters.length,
        chains: [
          ...new Set(cityTheaters.map((theater) => theater.chain)),
        ].sort(),
        zoomLayer: firstTheater.city.zoomLayer,
      };
    });
}

export function buildCityRevealConfig(
  entries: readonly CityEntry[],
): CityRevealConfig {
  const revealLayers = Array.from(
    new Set(entries.map((entry) => entry.zoomLayer)),
  ).sort((left, right) => left - right);
  const opacityLayers = revealLayers.filter((zoom) => zoom > 0);
  const fallbackRevealZoom = revealLayers.at(-1) ?? 0;

  return {
    fallbackRevealZoom,
    opacityLayers,
    zIndexByRevealZoom: new Map(
      revealLayers.map((zoom, index) => [zoom, String(100 - index)]),
    ),
  };
}

export function normalizeCitySearchQuery(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function cityMatchesSearchQuery(
  query: string,
  searchTerms: readonly string[],
) {
  if (!query) {
    return true;
  }

  const compactQuery = query.replace(/\s+/g, "");

  return searchTerms.some((searchTerm) => {
    const compactSearchTerm = searchTerm.replace(/\s+/g, "");

    return (
      searchTerm.includes(query) || compactSearchTerm.includes(compactQuery)
    );
  });
}

export function styleCityLabel(
  element: HTMLButtonElement,
  surface: HTMLSpanElement,
  options: {
    active: boolean;
    syncing: boolean;
    opacity: number;
    interactive: boolean;
    zIndex: string;
  },
) {
  element.classList.toggle("is-active", options.active);
  element.disabled = options.syncing;
  element.setAttribute("aria-pressed", String(options.active));
  element.setAttribute(
    "aria-disabled",
    String(options.syncing || !options.interactive),
  );
  element.setAttribute("aria-hidden", "false");
  element.tabIndex = !options.syncing && options.interactive ? 0 : -1;
  element.style.pointerEvents =
    !options.syncing && options.interactive ? "auto" : "none";
  element.style.zIndex = options.zIndex;
  // MapLibre rewrites opacity on the marker root while the camera moves.
  surface.style.opacity = String(options.opacity);
}

export function styleSecondaryCityLabel(
  element: HTMLSpanElement,
  visible: boolean,
) {
  element.classList.toggle("is-hidden", !visible);
  element.setAttribute("aria-hidden", String(!visible));
  element.style.opacity = visible ? "1" : "0";
  element.style.visibility = visible ? "visible" : "hidden";
}

export function styleTheaterDot(
  element: HTMLButtonElement,
  visible: boolean,
  hovered = false,
) {
  element.classList.toggle("is-visible", visible);
  element.classList.toggle("is-hovered", hovered);
  element.setAttribute("aria-hidden", String(!visible));
  element.tabIndex = visible ? 0 : -1;
  element.style.pointerEvents = visible ? "auto" : "none";
  element.style.zIndex = hovered
    ? HOVERED_THEATER_MARKER_Z_INDEX
    : THEATER_MARKER_Z_INDEX;
}

export function getTheaterPopupMaxWidth(map: MapLibreMap) {
  return `${Math.max(
    THEATER_POPUP_MIN_WIDTH,
    Math.min(
      THEATER_POPUP_MAX_WIDTH,
      map.getContainer().clientWidth - THEATER_POPUP_EDGE_PADDING * 2,
    ),
  )}px`;
}

export function parsePixelValue(value: string) {
  return Number.parseFloat(value.replace("px", ""));
}

export function getElementRectWithinMap(
  element: HTMLElement,
  mapRect: DOMRect,
): RectBounds | null {
  const rect = element.getBoundingClientRect();

  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  return {
    left: rect.left - mapRect.left,
    right: rect.right - mapRect.left,
    top: rect.top - mapRect.top,
    bottom: rect.bottom - mapRect.top,
  };
}

export function getRectOverlapArea(first: RectBounds, second: RectBounds) {
  const overlapWidth =
    Math.min(first.right, second.right) - Math.max(first.left, second.left);
  const overlapHeight =
    Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);

  if (overlapWidth <= 0 || overlapHeight <= 0) {
    return 0;
  }

  return overlapWidth * overlapHeight;
}

export function getTheaterPopupEstimatedSize(
  title: string,
  address: string,
  maxWidth: number,
) {
  const horizontalPadding = 26;
  const titleCharWidth = 11;
  const bodyCharWidth = 9;
  const desiredWidth = Math.max(
    THEATER_POPUP_MIN_WIDTH,
    Math.min(
      THEATER_POPUP_MAX_WIDTH,
      Math.max(title.length * titleCharWidth, address.length * bodyCharWidth) +
        horizontalPadding,
    ),
  );
  const width = Math.min(desiredWidth, maxWidth);
  const contentWidth = Math.max(1, width - horizontalPadding);
  const titleLines = Math.max(
    1,
    Math.ceil((title.length * titleCharWidth) / contentWidth),
  );
  const addressLines = Math.max(
    1,
    Math.ceil((address.length * bodyCharWidth) / contentWidth),
  );
  const height = 24 + titleLines * 20 + 6 + addressLines * 18;

  return { width, height };
}

export function getTheaterPopupRect(
  point: { x: number; y: number },
  size: { width: number; height: number },
  anchor: PositionAnchor,
): RectBounds {
  switch (anchor) {
    case "top":
      return {
        left: point.x - size.width / 2,
        right: point.x + size.width / 2,
        top: point.y + THEATER_POPUP_OFFSET_Y,
        bottom: point.y + THEATER_POPUP_OFFSET_Y + size.height,
      };
    case "bottom":
      return {
        left: point.x - size.width / 2,
        right: point.x + size.width / 2,
        top: point.y - THEATER_POPUP_OFFSET_Y - size.height,
        bottom: point.y - THEATER_POPUP_OFFSET_Y,
      };
    case "left":
      return {
        left: point.x + THEATER_POPUP_OFFSET_Y,
        right: point.x + THEATER_POPUP_OFFSET_Y + size.width,
        top: point.y - size.height / 2,
        bottom: point.y + size.height / 2,
      };
    case "right":
      return {
        left: point.x - THEATER_POPUP_OFFSET_Y - size.width,
        right: point.x - THEATER_POPUP_OFFSET_Y,
        top: point.y - size.height / 2,
        bottom: point.y + size.height / 2,
      };
    case "top-left":
      return {
        left: point.x,
        right: point.x + size.width,
        top: point.y + THEATER_POPUP_OFFSET_Y,
        bottom: point.y + THEATER_POPUP_OFFSET_Y + size.height,
      };
    case "top-right":
      return {
        left: point.x - size.width,
        right: point.x,
        top: point.y + THEATER_POPUP_OFFSET_Y,
        bottom: point.y + THEATER_POPUP_OFFSET_Y + size.height,
      };
    case "bottom-left":
      return {
        left: point.x,
        right: point.x + size.width,
        top: point.y - THEATER_POPUP_OFFSET_Y - size.height,
        bottom: point.y - THEATER_POPUP_OFFSET_Y,
      };
    case "bottom-right":
      return {
        left: point.x - size.width,
        right: point.x,
        top: point.y - THEATER_POPUP_OFFSET_Y - size.height,
        bottom: point.y - THEATER_POPUP_OFFSET_Y,
      };
    default:
      return {
        left: point.x - size.width / 2,
        right: point.x + size.width / 2,
        top: point.y + THEATER_POPUP_OFFSET_Y,
        bottom: point.y + THEATER_POPUP_OFFSET_Y + size.height,
      };
  }
}

export function getAutoTheaterPopupAnchor(
  point: { x: number; y: number },
  size: { width: number; height: number },
  mapWidth: number,
  mapHeight: number,
): PositionAnchor {
  const anchorParts: string[] = [];

  if (
    point.y + THEATER_POPUP_OFFSET_Y <
    size.height + THEATER_POPUP_EDGE_PADDING
  ) {
    anchorParts.push("top");
  } else if (point.y > mapHeight - size.height - THEATER_POPUP_EDGE_PADDING) {
    anchorParts.push("bottom");
  }

  if (point.x < size.width / 2 + THEATER_POPUP_EDGE_PADDING) {
    anchorParts.push("left");
  } else if (point.x > mapWidth - size.width / 2 - THEATER_POPUP_EDGE_PADDING) {
    anchorParts.push("right");
  }

  if (anchorParts.length === 0) {
    return "bottom";
  }

  return anchorParts.join("-") as PositionAnchor;
}

export function chooseTheaterPopupAnchor(options: {
  address: string;
  currentElement: HTMLButtonElement;
  labelElements: Map<string, CityMarkerState>;
  map: MapLibreMap;
  secondaryLabelElements: readonly SecondaryCityMarkerState[];
  theaterMarkers: readonly TheaterMarkerState[];
  title: string;
}): PositionAnchor | undefined {
  const mapRect = options.map.getContainer().getBoundingClientRect();
  const mapWidth = options.map.getContainer().clientWidth;
  const mapHeight = options.map.getContainer().clientHeight;
  const maxWidth = parsePixelValue(getTheaterPopupMaxWidth(options.map));
  const popupSize = getTheaterPopupEstimatedSize(
    options.title,
    options.address,
    maxWidth,
  );
  const point = options.map.project(
    new LngLat(
      Number(options.currentElement.dataset.lng),
      Number(options.currentElement.dataset.lat),
    ),
  );
  const obstacleRects: RectBounds[] = [];

  for (const state of options.labelElements.values()) {
    const rect = getElementRectWithinMap(state.element, mapRect);

    if (rect) {
      obstacleRects.push(rect);
    }
  }

  for (const state of options.secondaryLabelElements) {
    if (state.element.classList.contains("is-hidden")) {
      continue;
    }

    const rect = getElementRectWithinMap(state.element, mapRect);

    if (rect) {
      obstacleRects.push(rect);
    }
  }

  for (const theaterMarker of options.theaterMarkers) {
    if (
      theaterMarker.element === options.currentElement ||
      !theaterMarker.element.classList.contains("is-visible")
    ) {
      continue;
    }

    const rect = getElementRectWithinMap(theaterMarker.element, mapRect);

    if (rect) {
      obstacleRects.push(rect);
    }
  }

  const autoAnchor = getAutoTheaterPopupAnchor(
    point,
    popupSize,
    mapWidth,
    mapHeight,
  );
  let bestAnchor = autoAnchor;
  let bestScore = Number.POSITIVE_INFINITY;
  let autoScore = Number.POSITIVE_INFINITY;

  for (const [index, anchor] of THEATER_POPUP_ANCHOR_CANDIDATES.entries()) {
    const rect = getTheaterPopupRect(point, popupSize, anchor);
    const overflowX =
      Math.max(0, THEATER_POPUP_EDGE_PADDING - rect.left) +
      Math.max(0, rect.right - (mapWidth - THEATER_POPUP_EDGE_PADDING));
    const overflowY =
      Math.max(0, THEATER_POPUP_EDGE_PADDING - rect.top) +
      Math.max(0, rect.bottom - (mapHeight - THEATER_POPUP_EDGE_PADDING));
    const overlapArea = obstacleRects.reduce(
      (sum, obstacleRect) => sum + getRectOverlapArea(rect, obstacleRect),
      0,
    );
    const score = (overflowX + overflowY) * 10_000 + overlapArea + index * 100;

    if (anchor === autoAnchor) {
      autoScore = score;
    }

    if (score < bestScore) {
      bestScore = score;
      bestAnchor = anchor;
    }
  }

  if (bestAnchor === autoAnchor || bestScore >= autoScore) {
    return undefined;
  }

  return bestAnchor;
}

export function configureBaseLabels(map: MapLibreMap) {
  const layers = map.getStyle().layers ?? [];

  for (const layer of layers) {
    if (layer.type !== "symbol") {
      continue;
    }

    const layerId = layer.id.toLowerCase();
    const isRoadLabel = ROAD_LABEL_KEYWORDS.some((keyword) =>
      layerId.includes(keyword));
    const shouldHide = NON_ROAD_LABEL_KEYWORDS.some((keyword) =>
      layerId.includes(keyword));

    try {
      if (shouldHide && !isRoadLabel) {
        map.setLayoutProperty(layer.id, "visibility", "none");
        continue;
      }

      if (isRoadLabel) {
        map.setLayoutProperty(layer.id, "visibility", "visible");
      }

      if (map.getLayoutProperty(layer.id, "text-field") !== undefined) {
        map.setLayoutProperty(layer.id, "text-field", ENGLISH_LABEL_TEXT_FIELD);
      }
    } catch {
      continue;
    }
  }
}

export function normalizeTheaterChain(chain: string): string {
  const normalized = chain.trim().toLowerCase();

  if (normalized === "movieland" || normalized === "movie land") {
    return "MovieLand";
  }

  if (normalized === "ravhen" || normalized === "rav hen") {
    return "Rav Hen";
  }

  if (normalized.includes("cinematheque")) {
    return "Cinematheque";
  }

  return chain;
}

export function getCityMarkerZIndex(
  revealZoom: number,
  revealConfig: CityRevealConfig,
) {
  return (
    revealConfig.zIndexByRevealZoom.get(
      getEffectiveCityRevealZoom(revealZoom, revealConfig),
    ) ?? "1"
  );
}

export function getSearchCityMarkerZIndex(
  baseZIndex: string,
  isMatch: boolean,
) {
  const numericBaseZIndex = Number(baseZIndex);

  if (!Number.isFinite(numericBaseZIndex)) {
    return baseZIndex;
  }

  return String(
    numericBaseZIndex + (isMatch ? SEARCH_RESULT_Z_INDEX_OFFSET : 0),
  );
}

export function getEffectiveCityRevealZoom(
  revealZoom: number,
  revealConfig: CityRevealConfig,
) {
  return revealZoom > 0
    ? revealZoom
    : (revealConfig.opacityLayers[0] ?? revealZoom);
}

export function getCityLabelOpacity(
  zoom: number,
  revealZoom: number,
  selected: boolean,
  revealConfig: CityRevealConfig,
) {
  if (selected) {
    return 1;
  }

  const effectiveRevealZoom = getEffectiveCityRevealZoom(
    revealZoom,
    revealConfig,
  );

  if (zoom >= effectiveRevealZoom) {
    return 1;
  }

  let passedLayerCount = 0;

  for (const layerZoom of revealConfig.opacityLayers) {
    if (layerZoom >= effectiveRevealZoom) {
      break;
    }

    if (zoom >= layerZoom) {
      passedLayerCount += 1;
    }
  }

  return Math.min(
    CITY_OPACITY_BASE + passedLayerCount * CITY_OPACITY_STEP,
    CITY_MAX_PRE_REVEAL_OPACITY,
  );
}

export function isCityLabelRevealed(
  zoom: number,
  revealZoom: number,
  selected: boolean,
  revealConfig: CityRevealConfig,
) {
  if (selected) {
    return true;
  }

  return zoom >= getEffectiveCityRevealZoom(revealZoom, revealConfig);
}

export function getCityPriority(entry: CityEntry): number {
  const revealZoom = entry.zoomLayer;
  return (20 - revealZoom) * 10 + entry.theaterCount;
}

export function getMaxVisibleSecondaryCities(zoom: number): number {
  if (zoom < 8.65) {
    return 0;
  }

  return Number.POSITIVE_INFINITY;
}

export function getSecondaryCityCollisionPadding(zoom: number) {
  if (zoom < 9.6) {
    return { x: 20, y: 12 };
  }

  if (zoom < 10.2) {
    return { x: 16, y: 10 };
  }

  return { x: 12, y: 8 };
}

export function estimateCityBubbleSize(location: string, active: boolean) {
  const width = Math.max(112, location.length * 15 + 34) + (active ? 10 : 0);
  const height = active ? 48 : 42;

  return { width, height };
}

export function estimateSecondaryCityLabelSize(name: string) {
  return {
    width: Math.max(56, name.length * 8 + 12),
    height: 20,
  };
}

export function rectanglesOverlap(
  first: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  },
  second: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  },
) {
  return (
    first.left < second.right &&
    first.right > second.left &&
    first.top < second.bottom &&
    first.bottom > second.top
  );
}
