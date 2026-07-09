import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ban, Clapperboard, Info, List, Locate, LocateFixed, MapPin, Search, X } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { type IControl, type Offset, type PositionAnchor, LngLat, LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { loadTheaters, type Theater } from "../data/theaters";
import { type AppLocation } from "../prefs/definitions/locations";

const MAP_STYLE_URL =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const CITY_START_BOUNDS: [[number, number], [number, number]] = [
  [34.48, 31.18],
  [35.34, 33.02],
];
const CITY_START_BOUNDS_MOBILE: [[number, number], [number, number]] = [
  [34.48, 31.06],
  [35.34, 32.9],
];
const INITIAL_MAP_CENTER: [number, number] = [34.96, 32.15];
const INITIAL_MAP_CENTER_MOBILE: [number, number] = [34.96, 32.03];
const INITIAL_MAP_ZOOM = 2;
const CITY_OPACITY_BASE = 0.01;
const CITY_OPACITY_STEP = 0.085;
const CITY_MAX_PRE_REVEAL_OPACITY = 0.9;
const SELECTED_CITY_Z_INDEX = "200";
const SEARCH_RESULT_Z_INDEX_OFFSET = 1000;
const THEATER_MARKER_Z_INDEX = "10";
const HOVERED_THEATER_MARKER_Z_INDEX = "1400";
const THEATER_POPUP_EDGE_PADDING = 14;
const THEATER_POPUP_OFFSET_Y = 14;
const THEATER_POPUP_MIN_WIDTH = 180;
const THEATER_POPUP_MAX_WIDTH = 320;
const PRIMARY_CITY_COLLISION_PADDING = { x: 18, y: 14 };
const THEATER_POPUP_ANCHOR_CANDIDATES: readonly PositionAnchor[] = [
  "top",
  "right",
  "left",
  "bottom",
  "top-right",
  "top-left",
  "bottom-right",
  "bottom-left",
];
const THEATER_POPUP_OFFSET: Offset = {
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
const CITY_LABEL_NORTH_OFFSET = 0.00615;
const OVERVIEW_CENTER_TOLERANCE = 0.00035;
const OVERVIEW_ZOOM_TOLERANCE = 0.04;
const OVERVIEW_BEARING_TOLERANCE = 0.01;
const OVERVIEW_PITCH_TOLERANCE = 0.01;
const MAP_MAX_ZOOM = 16.5;
const SINGLE_CITY_FOCUS_ZOOM = 11.6;
const ROAD_LABEL_KEYWORDS = [
  "road",
  "street",
  "highway",
  "motorway",
  "route",
  "transport",
];
const NON_ROAD_LABEL_KEYWORDS = [
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
const ENGLISH_LABEL_TEXT_FIELD = [
  "coalesce",
  ["get", "name_en"],
  ["get", "name:en"],
  ["get", "name:latin"],
  ["get", "name_int"],
  ["get", "name"],
] as const;
const SECONDARY_CITIES: ReadonlyArray<{
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

type CityEntry = {
  location: string;
  center: [number, number];
  labelCenter: [number, number];
  searchTerms: string[];
  theaterCount: number;
  chains: string[];
  zoomLayer: number;
};

type CityRevealConfig = {
  fallbackRevealZoom: number;
  opacityLayers: number[];
  zIndexByRevealZoom: Map<number, string>;
};

type CityMarkerState = {
  element: HTMLButtonElement;
  surface: HTMLSpanElement;
  center: [number, number];
  priority: number;
  minZoom: number;
};

type TheaterMarkerState = {
  marker: Marker;
  element: HTMLButtonElement;
  location: string;
  popup: Popup;
};

type RectBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type SecondaryCityMarkerState = {
  element: HTMLSpanElement;
  center: [number, number];
  priority: number;
  minZoom: number;
};

export type CityLocationPickerProps = {
  className?: string;
  currentLocation: AppLocation;
  feedbackMessage?: string | null;
  mapPinAnchorRef?: (element: HTMLButtonElement | null) => void;
  onPickLocation: (location: AppLocation) => Promise<void>;
  onClose?: () => void;
  showMapPinButton?: boolean;
  syncing?: boolean;
};

const THEATER_DOT_COLORS: Record<string, string> = {
  "Yes Planet": "#d9710f",
  "Cinema City": "#186bdf",
  "Lev Cinema": "#b50519",
  "Rav Hen": "#ab5306",
  "Hot Cinema": "#f06a87",
  MovieLand: "#a80371",
  Cinematheque: "#31a26d",
};

function getFitPadding() {
  return window.innerWidth <= 720
    ? { top: 24, right: 18, bottom: 24, left: 18 }
    : { top: 30, right: 28, bottom: 30, left: 28 };
}

function getStartBounds(): [[number, number], [number, number]] {
  return window.innerWidth <= 720
    ? CITY_START_BOUNDS_MOBILE
    : CITY_START_BOUNDS;
}

function getInitialMapCenter(): [number, number] {
  return window.innerWidth <= 720
    ? INITIAL_MAP_CENTER_MOBILE
    : INITIAL_MAP_CENTER;
}

function isMapAtStartingView(map: MapLibreMap) {
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

function buildBounds(points: readonly [number, number][]): LngLatBounds | null {
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

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function getDistanceMeters(first: [number, number], second: [number, number]) {
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

function getNearestCityLocation(
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

function getGeolocationErrorMessage(error: GeolocationPositionError) {
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

const LOCATION_DISABLED_MESSAGE =
  "Location services are disabled for this site.";
const LOCATION_UNSUPPORTED_MESSAGE =
  "Location services are not available in this browser.";

const OVERVIEW_CONTROL_ICON = renderToStaticMarkup(
  <Locate size={18} strokeWidth={2.5} />,
);
const FOCUS_SELECTED_CITY_CONTROL_ICON = renderToStaticMarkup(
  <LocateFixed size={18} strokeWidth={2.5} />,
);
const THEATER_MARKER_ICON = renderToStaticMarkup(
  <Clapperboard size={16} strokeWidth={2.5} />,
);
const BLOCKED_LOCATE_ICON = renderToStaticMarkup(
  <Ban size={16} strokeWidth={2.5} />,
);
const CLOSE_CONTROL_ICON = renderToStaticMarkup(
  <X size={16} strokeWidth={3.5} />,
);
const INFO_CONTROL_ICON = renderToStaticMarkup(
  <Info size={16} strokeWidth={3} />,
);
const MAP_PIN_CONTROL_ICON = renderToStaticMarkup(
  <MapPin size={16} strokeWidth={2.75} />,
);

class TheaterMapAttributionControl implements IControl {
  private closeTimeoutId?: number;
  private container?: HTMLDivElement;
  private button?: HTMLButtonElement;
  private isOpen = false;

  private readonly handleDocumentMouseDown = (event: MouseEvent) => {
    if (!this.container?.contains(event.target as Node)) {
      this.setOpen(false);
    }
  };

  private readonly handleDocumentKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      this.setOpen(false);
    }
  };

  onAdd() {
    const container = document.createElement("div");
    container.className = "maplibregl-ctrl theater-map-attribution-control";

    const buttonShell = document.createElement("div");
    buttonShell.className =
      "maplibregl-ctrl-group theater-map-attribution-button-shell";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "theater-map-attribution-button";
    button.setAttribute("aria-label", "Map attribution");
    button.setAttribute("aria-expanded", "false");
    button.title = "Map attribution";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.setOpen(!this.isOpen);
    });

    const icon = document.createElement("span");
    icon.className = "theater-map-action-glyph theater-map-action-glyph--info";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = INFO_CONTROL_ICON;
    button.append(icon);
    buttonShell.append(button);

    const panel = document.createElement("div");
    panel.className = "theater-map-attribution-panel";

    const cartoLink = document.createElement("a");
    cartoLink.href = "https://carto.com/";
    cartoLink.target = "_blank";
    cartoLink.rel = "noopener noreferrer";
    cartoLink.textContent = "CARTO";

    const osmLink = document.createElement("a");
    osmLink.href = "https://www.openstreetmap.org/";
    osmLink.target = "_blank";
    osmLink.rel = "noopener noreferrer";
    osmLink.textContent = "OpenStreetMap";

    const separator = document.createElement("span");
    separator.className = "theater-map-attribution-separator";
    separator.setAttribute("aria-hidden", "true");
    separator.textContent = "|";

    panel.append(
      document.createTextNode("© "),
      cartoLink,
      separator,
      document.createTextNode("© "),
      osmLink,
    );

    container.append(buttonShell, panel);
    this.container = container;
    this.button = button;
    this.setOpen(true);
    document.addEventListener("mousedown", this.handleDocumentMouseDown);
    document.addEventListener("keydown", this.handleDocumentKeyDown);

    return container;
  }

  onRemove() {
    this.clearCloseTimeout();
    document.removeEventListener("mousedown", this.handleDocumentMouseDown);
    document.removeEventListener("keydown", this.handleDocumentKeyDown);
    this.container?.remove();
    this.container = undefined;
    this.button = undefined;
  }

  private setOpen(isOpen: boolean) {
    this.clearCloseTimeout();
    this.isOpen = isOpen;
    this.container?.classList.toggle("is-open", isOpen);
    this.button?.setAttribute("aria-expanded", String(isOpen));

    if (isOpen) {
      this.closeTimeoutId = window.setTimeout(() => {
        this.setOpen(false);
      }, 5000);
    }
  }

  private clearCloseTimeout() {
    if (this.closeTimeoutId !== undefined) {
      window.clearTimeout(this.closeTimeoutId);
      this.closeTimeoutId = undefined;
    }
  }
}

class TheaterMapCloseControl implements IControl {
  private container?: HTMLDivElement;
  private readonly onClose: () => void;

  constructor(onClose: () => void) {
    this.onClose = onClose;
  }

  onAdd() {
    const container = document.createElement("div");
    container.className =
      "maplibregl-ctrl maplibregl-ctrl-group theater-map-close-control";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "theater-map-close-button";
    button.setAttribute("aria-label", "Close map");
    button.title = "Close map";
    button.addEventListener("click", this.onClose);

    const icon = document.createElement("span");
    icon.className = "theater-map-action-glyph theater-map-action-glyph--close";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = CLOSE_CONTROL_ICON;

    button.append(icon);
    container.append(button);
    this.container = container;

    return container;
  }

  onRemove() {
    this.container?.remove();
    this.container = undefined;
  }
}

class TheaterMapActionControl implements IControl {
  private container?: HTMLDivElement;
  private viewButton?: HTMLButtonElement;
  private viewGlyph?: HTMLSpanElement;
  private mapPinButton?: HTMLButtonElement;
  private mapPinGlyph?: HTMLSpanElement;
  private mapPinTooltip?: HTMLDivElement;
  private isLocatePending = false;
  private blockedLocateMessage: string | null;
  private isOverview = false;
  private selectedLocationLabel: string;
  private showMapPinButton: boolean;
  private readonly options: {
    blockedLocateMessage: string | null;
    onLocate: () => void;
    onMapPinAnchorChange?: (element: HTMLButtonElement | null) => void;
    onResetToOverview: () => void;
    onZoomToSelectedCity: () => void;
    selectedLocationLabel: string;
    showMapPinButton: boolean;
  };

  constructor(options: {
    blockedLocateMessage: string | null;
    onLocate: () => void;
    onMapPinAnchorChange?: (element: HTMLButtonElement | null) => void;
    onResetToOverview: () => void;
    onZoomToSelectedCity: () => void;
    selectedLocationLabel: string;
    showMapPinButton: boolean;
  }) {
    this.options = options;
    this.blockedLocateMessage = options.blockedLocateMessage;
    this.selectedLocationLabel = options.selectedLocationLabel;
    this.showMapPinButton = options.showMapPinButton;
  }

  onAdd() {
    const container = document.createElement("div");
    container.className = "maplibregl-ctrl theater-map-action-controls-wrap";

    const controlsGroup = document.createElement("div");
    controlsGroup.className =
      "maplibregl-ctrl-group theater-map-action-controls";

    const viewButton = document.createElement("button");
    viewButton.type = "button";
    viewButton.className =
      "theater-map-action-button theater-map-action-button--view";
    viewButton.addEventListener("click", () => {
      if (this.isOverview) {
        this.options.onZoomToSelectedCity();
        return;
      }

      this.options.onResetToOverview();
    });
    const viewGlyph = document.createElement("span");
    viewGlyph.className =
      "theater-map-action-glyph theater-map-action-glyph--reset";
    viewGlyph.setAttribute("aria-hidden", "true");
    viewButton.append(viewGlyph);

    const mapPinButton = document.createElement("button");
    mapPinButton.type = "button";
    mapPinButton.className =
      "theater-map-action-button theater-map-action-button--locate";
    mapPinButton.addEventListener("click", (event) => {
      if (this.blockedLocateMessage || this.isLocatePending) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      this.options.onLocate();
    });
    const mapPinGlyph = document.createElement("span");
    mapPinGlyph.className =
      "theater-map-action-glyph theater-map-action-glyph--map-pin";
    mapPinGlyph.setAttribute("aria-hidden", "true");
    mapPinButton.append(mapPinGlyph);

    const mapPinTooltip = document.createElement("div");
    mapPinTooltip.className = "theater-map-action-tooltip";
    mapPinTooltip.setAttribute("aria-hidden", "true");

    const toggleTooltip = (visible: boolean) => {
      if (!this.blockedLocateMessage || !this.mapPinTooltip) {
        return;
      }

      this.mapPinTooltip.classList.toggle("is-visible", visible);
      this.mapPinTooltip.setAttribute("aria-hidden", String(!visible));
    };

    mapPinButton.addEventListener("mouseenter", () => {
      toggleTooltip(true);
    });
    mapPinButton.addEventListener("mouseleave", () => {
      toggleTooltip(false);
    });
    mapPinButton.addEventListener("focus", () => {
      toggleTooltip(true);
    });
    mapPinButton.addEventListener("blur", () => {
      toggleTooltip(false);
    });

    controlsGroup.append(viewButton, mapPinButton);
    container.append(controlsGroup, mapPinTooltip);
    this.container = container;
    this.viewButton = viewButton;
    this.viewGlyph = viewGlyph;
    this.mapPinButton = mapPinButton;
    this.mapPinGlyph = mapPinGlyph;
    this.mapPinTooltip = mapPinTooltip;
    this.syncViewButton();
    this.syncMapPinButton();
    this.options.onMapPinAnchorChange?.(mapPinButton);

    return container;
  }

  onRemove() {
    this.options.onMapPinAnchorChange?.(null);
    this.container?.remove();
    this.container = undefined;
    this.viewButton = undefined;
    this.viewGlyph = undefined;
    this.mapPinButton = undefined;
    this.mapPinGlyph = undefined;
    this.mapPinTooltip = undefined;
  }

  setLocatePending(isPending: boolean) {
    this.isLocatePending = isPending;
    this.syncMapPinButton();
  }

  setLocateBlocked(message: string | null) {
    this.blockedLocateMessage = message;
    this.syncMapPinButton();
  }

  setOverviewState(isOverview: boolean) {
    this.isOverview = isOverview;
    this.syncViewButton();
  }

  setSelectedLocation(locationLabel: string) {
    this.selectedLocationLabel = locationLabel;
    this.syncViewButton();
  }

  setMapPinVisible(isVisible: boolean) {
    this.showMapPinButton = isVisible;
    this.syncMapPinButton();
  }

  private syncViewButton() {
    if (!this.viewButton || !this.viewGlyph) {
      return;
    }

    const selectedLocationLabel =
      this.selectedLocationLabel.trim() || "selected city";
    const label = this.isOverview
      ? `Zoom to ${selectedLocationLabel}`
      : "Return to full map view";

    this.viewGlyph.innerHTML = this.isOverview
      ? FOCUS_SELECTED_CITY_CONTROL_ICON
      : OVERVIEW_CONTROL_ICON;
    this.viewButton.setAttribute("aria-label", label);
    this.viewButton.title = label;
  }

  private syncMapPinButton() {
    if (!this.mapPinButton || !this.mapPinGlyph || !this.mapPinTooltip) {
      return;
    }

    const isBlocked = this.blockedLocateMessage !== null;
    this.mapPinButton.disabled = false;
    this.mapPinButton.classList.toggle("is-hidden", !this.showMapPinButton);
    this.mapPinButton.setAttribute("aria-busy", String(this.isLocatePending));
    this.mapPinButton.setAttribute(
      "aria-disabled",
      String(!this.showMapPinButton || isBlocked || this.isLocatePending),
    );
    this.mapPinButton.setAttribute(
      "aria-hidden",
      String(!this.showMapPinButton),
    );
    this.mapPinButton.setAttribute(
      "aria-label",
      this.isLocatePending
        ? "Waiting for location access"
        : "Find nearest city to my location",
    );
    this.mapPinButton.tabIndex = this.showMapPinButton ? 0 : -1;
    this.mapPinGlyph.innerHTML = isBlocked
      ? BLOCKED_LOCATE_ICON
      : MAP_PIN_CONTROL_ICON;
    this.mapPinTooltip.textContent =
      this.blockedLocateMessage ?? LOCATION_DISABLED_MESSAGE;
    this.mapPinTooltip.classList.remove("is-visible");
    this.mapPinTooltip.setAttribute("aria-hidden", "true");

    if (!this.showMapPinButton || isBlocked) {
      this.mapPinButton.title = "";
      return;
    }

    this.mapPinButton.title = this.isLocatePending
      ? "Waiting for location access..."
      : "Find nearest city to my location";
  }
}
function buildCityEntries(theaters: readonly Theater[]): CityEntry[] {
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

function buildCityRevealConfig(
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

function normalizeCitySearchQuery(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function cityMatchesSearchQuery(query: string, searchTerms: readonly string[]) {
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

function styleCityLabel(
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

function styleSecondaryCityLabel(element: HTMLSpanElement, visible: boolean) {
  element.classList.toggle("is-hidden", !visible);
  element.setAttribute("aria-hidden", String(!visible));
  element.style.opacity = visible ? "1" : "0";
  element.style.visibility = visible ? "visible" : "hidden";
}

function styleTheaterDot(
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

function getTheaterPopupMaxWidth(map: MapLibreMap) {
  return `${Math.max(
    THEATER_POPUP_MIN_WIDTH,
    Math.min(
      THEATER_POPUP_MAX_WIDTH,
      map.getContainer().clientWidth - THEATER_POPUP_EDGE_PADDING * 2,
    ),
  )}px`;
}

function parsePixelValue(value: string) {
  return Number.parseFloat(value.replace("px", ""));
}

function getElementRectWithinMap(
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

function getRectOverlapArea(first: RectBounds, second: RectBounds) {
  const overlapWidth =
    Math.min(first.right, second.right) - Math.max(first.left, second.left);
  const overlapHeight =
    Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);

  if (overlapWidth <= 0 || overlapHeight <= 0) {
    return 0;
  }

  return overlapWidth * overlapHeight;
}

function getTheaterPopupEstimatedSize(
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

function getTheaterPopupRect(
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

function getAutoTheaterPopupAnchor(
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

function chooseTheaterPopupAnchor(options: {
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

function configureBaseLabels(map: MapLibreMap) {
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

function normalizeTheaterChain(chain: string): string {
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

function getCityMarkerZIndex(
  revealZoom: number,
  revealConfig: CityRevealConfig,
) {
  return (
    revealConfig.zIndexByRevealZoom.get(
      getEffectiveCityRevealZoom(revealZoom, revealConfig),
    ) ?? "1"
  );
}

function getSearchCityMarkerZIndex(baseZIndex: string, isMatch: boolean) {
  const numericBaseZIndex = Number(baseZIndex);

  if (!Number.isFinite(numericBaseZIndex)) {
    return baseZIndex;
  }

  return String(
    numericBaseZIndex + (isMatch ? SEARCH_RESULT_Z_INDEX_OFFSET : 0),
  );
}

function getEffectiveCityRevealZoom(
  revealZoom: number,
  revealConfig: CityRevealConfig,
) {
  return revealZoom > 0
    ? revealZoom
    : (revealConfig.opacityLayers[0] ?? revealZoom);
}

function getCityLabelOpacity(
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

function isCityLabelRevealed(
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

function getCityPriority(entry: CityEntry): number {
  const revealZoom = entry.zoomLayer;
  return (20 - revealZoom) * 10 + entry.theaterCount;
}

function getMaxVisibleSecondaryCities(zoom: number): number {
  if (zoom < 8.65) {
    return 0;
  }

  return Number.POSITIVE_INFINITY;
}

function getSecondaryCityCollisionPadding(zoom: number) {
  if (zoom < 9.6) {
    return { x: 20, y: 12 };
  }

  if (zoom < 10.2) {
    return { x: 16, y: 10 };
  }

  return { x: 12, y: 8 };
}

function estimateCityBubbleSize(location: string, active: boolean) {
  const width = Math.max(112, location.length * 15 + 34) + (active ? 10 : 0);
  const height = active ? 48 : 42;

  return { width, height };
}

function estimateSecondaryCityLabelSize(name: string) {
  return {
    width: Math.max(56, name.length * 8 + 12),
    height: 20,
  };
}

function rectanglesOverlap(
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

export function CityLocationPicker({
  className,
  currentLocation,
  mapPinAnchorRef,
  onPickLocation,
  onClose,
  showMapPinButton = true,
  syncing = false,
}: CityLocationPickerProps) {
  const [query, setQuery] = useState("");
  const [isCityListOpen, setIsCityListOpen] = useState(false);
  const [optimisticLocation, setOptimisticLocation] =
    useState<AppLocation | null>(null);
  const [mapControlMessage, setMapControlMessage] = useState<string | null>(
    null,
  );
  const [theaters, setTheaters] = useState<Theater[]>([]);
  const [isBaseMapReady, setIsBaseMapReady] = useState(false);
  const cityListWrapRef = useRef<HTMLDivElement | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const mapActionControlRef = useRef<TheaterMapActionControl | null>(null);
  const mapPinAnchorRefRef = useRef(mapPinAnchorRef);
  const locateBlockedMessageRef = useRef<string | null>(
    typeof navigator === "undefined" ||
      typeof navigator.geolocation === "undefined"
      ? LOCATION_UNSUPPORTED_MESSAGE
      : null,
  );
  const onCloseRef = useRef(onClose);
  const currentLocationRef = useRef(currentLocation);
  const syncingRef = useRef(syncing);
  const showMapPinButtonRef = useRef(showMapPinButton);
  const geolocationRequestRef = useRef(false);
  const cityLabelElementsRef = useRef(new Map<string, CityMarkerState>());
  const secondaryCityLabelElementsRef = useRef<SecondaryCityMarkerState[]>([]);
  const cityMarkersRef = useRef<Marker[]>([]);
  const theaterMarkersRef = useRef<TheaterMarkerState[]>([]);
  const scheduleVisibilitySyncRef = useRef<(() => void) | null>(null);
  const focusSelectedLocationRef = useRef<(() => void) | null>(null);
  const handleLocateNearestCityRef = useRef<(() => void) | null>(null);
  const searchZoomOutTimeoutRef = useRef<number | null>(null);
  const searchQueryRef = useRef("");
  const normalizedQuery = useMemo(
    () => normalizeCitySearchQuery(query),
    [query],
  );
  const displayedCurrentLocation = optimisticLocation ?? currentLocation;

  const clearPendingSearchZoomOut = useCallback(() => {
    if (searchZoomOutTimeoutRef.current !== null) {
      window.clearTimeout(searchZoomOutTimeoutRef.current);
      searchZoomOutTimeoutRef.current = null;
    }
  }, []);

  const clearSearchQuery = useCallback(() => {
    clearPendingSearchZoomOut();
    searchQueryRef.current = "";
    setQuery("");
    searchInputRef.current?.focus({ preventScroll: true });
  }, [clearPendingSearchZoomOut]);

  const cityEntries = useMemo(() => buildCityEntries(theaters), [theaters]);
  const isTheaterMapDataReady = cityEntries.length > 0;
  const cityRevealConfig = useMemo(
    () => buildCityRevealConfig(cityEntries),
    [cityEntries],
  );
  const cityEntryMap = useMemo(
    () => new Map(cityEntries.map((entry) => [entry.location, entry] as const)),
    [cityEntries],
  );
  const availableCityLocations = useMemo(
    () =>
      cityEntries
        .map((entry) => entry.location)
        .sort((left, right) => left.localeCompare(right)),
    [cityEntries],
  );
  const matchingSearchLocations = useMemo(
    () =>
      normalizedQuery
        ? cityEntries.flatMap((entry) =>
            cityMatchesSearchQuery(normalizedQuery, entry.searchTerms)
              ? [entry.location]
              : [])
        : [],
    [cityEntries, normalizedQuery],
  );

  const fitStartingView = useCallback((
    options: { animate?: boolean; duration?: number } = {},
  ) => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    map.fitBounds(getStartBounds(), {
      padding: getFitPadding(),
      duration: options.animate === false ? 0 : (options.duration ?? 720),
      easing: (progress) => 1 - (1 - progress) ** 3,
      maxZoom: 6.9,
      essential: true,
    });
  }, []);

  const fitLocations = useCallback(
    (
      locations: readonly AppLocation[],
      options: {
        animate?: boolean;
      } = {},
    ) => {
      const map = mapRef.current;

      if (!map || locations.length === 0) {
        return;
      }

      const points = locations.flatMap((location) => {
        const center = cityEntryMap.get(location)?.center;
        return center ? [center] : [];
      });
      const [firstPoint] = points;

      if (!firstPoint) {
        return;
      }

      if (points.length === 1) {
        map.easeTo({
          center: firstPoint,
          zoom: SINGLE_CITY_FOCUS_ZOOM,
          duration: options.animate === false ? 0 : 720,
          essential: true,
        });
        return;
      }

      const bounds = buildBounds(points);

      if (!bounds) {
        return;
      }

      map.fitBounds(bounds, {
        padding: getFitPadding(),
        duration: options.animate === false ? 0 : 720,
        maxZoom: 8.3,
        essential: true,
      });
    },
    [cityEntryMap],
  );

  const focusLocation = useCallback(
    (
      location: AppLocation,
      options: {
        clearSearch?: boolean;
      } = {},
    ) => {
      if (options.clearSearch) {
        clearPendingSearchZoomOut();
        searchQueryRef.current = "";
        setQuery("");
      }

      scheduleVisibilitySyncRef.current?.();
      fitLocations([location]);
    },
    [clearPendingSearchZoomOut, fitLocations],
  );

  const handleLocationSelect = useCallback(
    async (
      nextLocation: AppLocation,
      options: {
        clearSearch?: boolean;
      } = {},
    ) => {
      const previousLocation = currentLocationRef.current;

      if (options.clearSearch) {
        clearPendingSearchZoomOut();
        searchQueryRef.current = "";
        setQuery("");
      }

      setOptimisticLocation(nextLocation);
      currentLocationRef.current = nextLocation;
      scheduleVisibilitySyncRef.current?.();
      fitLocations([nextLocation]);
      onCloseRef.current?.();

      try {
        await onPickLocation(nextLocation);
      } catch (error) {
        setOptimisticLocation(null);
        currentLocationRef.current = previousLocation;
        scheduleVisibilitySyncRef.current?.();
        throw error;
      }
    },
    [clearPendingSearchZoomOut, fitLocations, onPickLocation],
  );

  const setLocateBlockedMessage = useCallback((message: string | null) => {
    locateBlockedMessageRef.current = message;
    mapActionControlRef.current?.setLocateBlocked(message);
  }, []);

  const handleLocateNearestCity = useCallback(() => {
    if (geolocationRequestRef.current) {
      return;
    }

    if (!isTheaterMapDataReady) {
      setMapControlMessage("Loading theater locations...");
      return;
    }

    if (
      typeof navigator === "undefined" ||
      typeof navigator.geolocation === "undefined"
    ) {
      setLocateBlockedMessage(LOCATION_UNSUPPORTED_MESSAGE);
      return;
    }

    geolocationRequestRef.current = true;
    setMapControlMessage(null);
    setLocateBlockedMessage(null);
    mapActionControlRef.current?.setLocatePending(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nearestLocation = getNearestCityLocation(
          [position.coords.longitude, position.coords.latitude],
          cityEntries,
        );

        if (!nearestLocation) {
          geolocationRequestRef.current = false;
          mapActionControlRef.current?.setLocatePending(false);
          setMapControlMessage(
            "Could not match your location to a supported city.",
          );
          return;
        }

        void handleLocationSelect(nearestLocation)
          .then(() => {
            setMapControlMessage(null);
          })
          .catch(() => {
            setMapControlMessage("Could not update the selected city.");
          })
          .finally(() => {
            geolocationRequestRef.current = false;
            mapActionControlRef.current?.setLocatePending(false);
          });
      },
      (error) => {
        geolocationRequestRef.current = false;
        mapActionControlRef.current?.setLocatePending(false);
        if (error.code === error.PERMISSION_DENIED) {
          setLocateBlockedMessage(LOCATION_DISABLED_MESSAGE);
          setMapControlMessage(null);
          return;
        }

        setLocateBlockedMessage(null);
        setMapControlMessage(getGeolocationErrorMessage(error));
      },
      {
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 300_000,
      },
    );
  }, [
    cityEntries,
    handleLocationSelect,
    isTheaterMapDataReady,
    setLocateBlockedMessage,
  ]);

  useEffect(() => {
    focusSelectedLocationRef.current = () => {
      setMapControlMessage(null);
      focusLocation(currentLocationRef.current, {
        clearSearch: searchQueryRef.current.length > 0,
      });
    };
  }, [focusLocation]);

  useEffect(() => {
    handleLocateNearestCityRef.current = handleLocateNearestCity;
  }, [handleLocateNearestCity]);

  useEffect(() => {
    let cancelled = false;

    void loadTheaters()
      .then((nextTheaters) => {
        if (cancelled) {
          return;
        }

        startTransition(() => {
          setTheaters(nextTheaters);
        });
      })
      .catch((loadError: unknown) => {
        if (cancelled) {
          return;
        }

        console.error("Could not load theaters from Supabase.", loadError);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    searchInputRef.current?.setAttribute(
      "aria-label",
      "Search any city in your theater list",
    );
  }, []);

  useEffect(() => {
    const focusFrame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
    };
  }, []);

  useEffect(() => {
    searchQueryRef.current = normalizedQuery;
    scheduleVisibilitySyncRef.current?.();
  }, [normalizedQuery]);

  useEffect(() => clearPendingSearchZoomOut, [clearPendingSearchZoomOut]);

  useEffect(() => {
    let clearOptimisticFrame = 0;

    if (optimisticLocation !== null && currentLocation === optimisticLocation) {
      clearOptimisticFrame = window.requestAnimationFrame(() => {
        setOptimisticLocation(null);
      });
    }

    currentLocationRef.current = optimisticLocation ?? currentLocation;
    syncingRef.current = syncing;
    scheduleVisibilitySyncRef.current?.();

    return () => {
      if (clearOptimisticFrame !== 0) {
        window.cancelAnimationFrame(clearOptimisticFrame);
      }
    };
  }, [currentLocation, optimisticLocation, syncing]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    mapPinAnchorRefRef.current = mapPinAnchorRef;
  }, [mapPinAnchorRef]);

  useEffect(() => {
    showMapPinButtonRef.current = showMapPinButton;
    mapActionControlRef.current?.setMapPinVisible(showMapPinButton);
  }, [showMapPinButton]);

  useEffect(() => {
    mapActionControlRef.current?.setSelectedLocation(displayedCurrentLocation);
  }, [displayedCurrentLocation]);

  useEffect(() => {
    if (!isCityListOpen) {
      return;
    }

    function handleDocumentMouseDown(event: MouseEvent) {
      if (!cityListWrapRef.current?.contains(event.target as Node)) {
        setIsCityListOpen(false);
      }
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsCityListOpen(false);
      }
    }

    document.addEventListener("mousedown", handleDocumentMouseDown);
    document.addEventListener("keydown", handleDocumentKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [isCityListOpen]);

  useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      typeof navigator.geolocation === "undefined"
    ) {
      setLocateBlockedMessage(LOCATION_UNSUPPORTED_MESSAGE);
      return;
    }

    if (typeof navigator.permissions?.query !== "function") {
      return;
    }

    let isCancelled = false;
    let permissionStatus: PermissionStatus | null = null;

    const syncPermissionState = () => {
      if (isCancelled || !permissionStatus) {
        return;
      }

      setLocateBlockedMessage(
        permissionStatus.state === "denied" ? LOCATION_DISABLED_MESSAGE : null,
      );
    };

    void navigator.permissions
      .query({ name: "geolocation" })
      .then((status) => {
        if (isCancelled) {
          return;
        }

        permissionStatus = status;
        syncPermissionState();
        permissionStatus.addEventListener("change", syncPermissionState);
      })
      .catch(() => {
        // Ignore Permissions API failures and rely on runtime geolocation errors.
      });

    return () => {
      isCancelled = true;
      permissionStatus?.removeEventListener("change", syncPermissionState);
    };
  }, [setLocateBlockedMessage]);

  useEffect(() => {
    if (!mapControlMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setMapControlMessage(null);
    }, 4200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [mapControlMessage]);

  useEffect(() => {
    if (!mapContainerRef.current) {
      return;
    }

    setIsBaseMapReady(false);
    const map = new MapLibreMap({
      container: mapContainerRef.current,
      style: MAP_STYLE_URL,
      center: getInitialMapCenter(),
      zoom: INITIAL_MAP_ZOOM,
      maxZoom: MAP_MAX_ZOOM,
      renderWorldCopies: false,
      attributionControl: false,
    });
    const mapActionControl = new TheaterMapActionControl({
      blockedLocateMessage: locateBlockedMessageRef.current,
      onLocate: () => {
        handleLocateNearestCityRef.current?.();
      },
      onMapPinAnchorChange: (element) => {
        mapPinAnchorRefRef.current?.(element);
      },
      onResetToOverview: () => {
        setMapControlMessage(null);
        fitStartingView();
      },
      onZoomToSelectedCity: () => {
        focusSelectedLocationRef.current?.();
      },
      selectedLocationLabel: currentLocationRef.current,
      showMapPinButton: showMapPinButtonRef.current,
    });

    mapRef.current = map;
    mapActionControlRef.current = mapActionControl;
    mapActionControl.setSelectedLocation(currentLocationRef.current);
    mapActionControl.setMapPinVisible(showMapPinButtonRef.current);
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    if (onCloseRef.current) {
      map.addControl(
        new TheaterMapCloseControl(() => {
          onCloseRef.current?.();
        }),
        "top-right",
      );
    }
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(mapActionControl, "top-right");
    map.addControl(new TheaterMapAttributionControl(), "top-left");
    let fitFrame = 0;

    function syncOverviewState() {
      mapActionControl.setOverviewState(isMapAtStartingView(map));
    }

    function markBaseMapReady() {
      setIsBaseMapReady(true);
    }

    function handleLoad() {
      configureBaseLabels(map);
      map.once("idle", markBaseMapReady);
      fitFrame = window.requestAnimationFrame(() => {
        fitFrame = 0;
        fitStartingView({ duration: 1000 });
        syncOverviewState();
      });
    }

    map.once("load", handleLoad);
    map.on("moveend", syncOverviewState);
    map.on("zoomend", syncOverviewState);

    return () => {
      map.off("load", handleLoad);
      map.off("idle", markBaseMapReady);
      map.off("moveend", syncOverviewState);
      map.off("zoomend", syncOverviewState);
      if (fitFrame !== 0) {
        window.cancelAnimationFrame(fitFrame);
      }
      scheduleVisibilitySyncRef.current = null;
      mapActionControlRef.current = null;
      geolocationRequestRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, [fitStartingView]);

  useEffect(() => {
    const currentMap = mapRef.current;

    if (!currentMap || !isBaseMapReady || cityEntries.length === 0) {
      return;
    }

    const map: MapLibreMap = currentMap;
    const labelElements = new Map<string, CityMarkerState>();
    const secondaryLabelElements: SecondaryCityMarkerState[] = [];
    const markers: Marker[] = [];
    const theaterMarkers: TheaterMarkerState[] = [];
    const mapActionControl = mapActionControlRef.current;
    let visibilityFrame = 0;

    cityLabelElementsRef.current = labelElements;
    secondaryCityLabelElementsRef.current = secondaryLabelElements;
    cityMarkersRef.current = markers;

    function syncMarkerVisibility() {
      const zoom = map.getZoom();
      const currentSelection = currentLocationRef.current;
      const searchQuery = searchQueryRef.current;
      mapActionControl?.setOverviewState(isMapAtStartingView(map));
      const searchActive = searchQuery.length > 0;
      const searchMatchCount = searchActive
        ? cityEntries.reduce(
            (count, entry) =>
              count +
              (cityMatchesSearchQuery(searchQuery, entry.searchTerms) ? 1 : 0),
            0,
          )
        : 0;
      const prioritizeSearchResults =
        searchActive &&
        searchMatchCount > 0 &&
        searchMatchCount < cityEntries.length;
      const mapWidth = map.getContainer().clientWidth;
      const mapHeight = map.getContainer().clientHeight;
      const maxVisibleSecondaryCities = getMaxVisibleSecondaryCities(zoom);
      const secondaryCollisionPadding = getSecondaryCityCollisionPadding(zoom);
      const visibleRects: Array<{
        left: number;
        right: number;
        top: number;
        bottom: number;
      }> = [];
      let visibleSecondaryCount = 0;

      for (const [location, state] of labelElements) {
        const isSelected = location === currentSelection;
        const searchMatch = cityMatchesSearchQuery(
          searchQuery,
          cityEntryMap.get(location)?.searchTerms ?? [
            normalizeCitySearchQuery(location),
          ],
        );
        const active = searchActive ? false : isSelected;
        const opacity = searchActive
          ? searchMatch
            ? 1
            : 0.1
          : getCityLabelOpacity(zoom, state.minZoom, active, cityRevealConfig);
        const interactive = searchActive
          ? searchMatch
          : isCityLabelRevealed(zoom, state.minZoom, active, cityRevealConfig);
        const defaultZIndex =
          active && !searchActive
            ? SELECTED_CITY_Z_INDEX
            : getCityMarkerZIndex(state.minZoom, cityRevealConfig);

        styleCityLabel(state.element, state.surface, {
          active,
          syncing: syncingRef.current,
          opacity,
          interactive,
          zIndex: prioritizeSearchResults
            ? getSearchCityMarkerZIndex(defaultZIndex, searchMatch)
            : defaultZIndex,
        });

        const point = map.project(state.center);
        const size = estimateCityBubbleSize(location, active);
        const collisionRect = {
          left: point.x - size.width / 2 - PRIMARY_CITY_COLLISION_PADDING.x,
          right: point.x + size.width / 2 + PRIMARY_CITY_COLLISION_PADDING.x,
          top: point.y - size.height / 2 - PRIMARY_CITY_COLLISION_PADDING.y,
          bottom: point.y + size.height / 2 + PRIMARY_CITY_COLLISION_PADDING.y,
        };
        const inViewport =
          collisionRect.right >= 0 &&
          collisionRect.left <= mapWidth &&
          collisionRect.bottom >= 0 &&
          collisionRect.top <= mapHeight;

        if (inViewport) {
          visibleRects.push(collisionRect);
        }
      }

      const secondaryCandidates = secondaryLabelElements
        .filter((state) => zoom >= state.minZoom)
        .sort((left, right) => right.priority - left.priority);

      for (const state of secondaryCandidates) {
        const point = map.project(state.center);
        const size = estimateSecondaryCityLabelSize(
          state.element.textContent ?? "",
        );
        const collisionRect = {
          left: point.x - size.width / 2 - secondaryCollisionPadding.x,
          right: point.x + size.width / 2 + secondaryCollisionPadding.x,
          top: point.y - size.height / 2 - secondaryCollisionPadding.y,
          bottom: point.y + size.height / 2 + secondaryCollisionPadding.y,
        };
        const inViewport =
          collisionRect.right >= 0 &&
          collisionRect.left <= mapWidth &&
          collisionRect.bottom >= 0 &&
          collisionRect.top <= mapHeight;
        const collides = visibleRects.some((visibleRect) =>
          rectanglesOverlap(collisionRect, visibleRect));
        const withinBudget = visibleSecondaryCount < maxVisibleSecondaryCities;
        const visible = inViewport && withinBudget && !collides;

        styleSecondaryCityLabel(state.element, visible);

        if (visible) {
          visibleRects.push(collisionRect);
          visibleSecondaryCount += 1;
        }
      }

      for (const theaterMarker of theaterMarkers) {
        const cityState = labelElements.get(theaterMarker.location);
        const active = theaterMarker.location === currentSelection;
        const visible =
          cityState !== undefined &&
          isCityLabelRevealed(
            zoom,
            cityState.minZoom,
            active,
            cityRevealConfig,
          );

        styleTheaterDot(
          theaterMarker.element,
          visible,
          theaterMarker.element.matches(":hover, :focus-visible, :focus"),
        );

        if (!visible) {
          theaterMarker.popup.remove();
          continue;
        }
      }
    }

    function scheduleSyncMarkerVisibility() {
      if (visibilityFrame !== 0) {
        return;
      }

      visibilityFrame = window.requestAnimationFrame(() => {
        visibilityFrame = 0;
        syncMarkerVisibility();
      });
    }

    scheduleVisibilitySyncRef.current = scheduleSyncMarkerVisibility;

    function addMapMarkers() {
      for (const entry of cityEntries) {
        const revealZoom = entry.zoomLayer;
        const active = entry.location === currentLocationRef.current;
        const element = document.createElement("button");
        element.type = "button";
        element.className = "theater-map-city-label";
        element.setAttribute("aria-label", `Select ${entry.location}`);
        const surface = document.createElement("span");
        surface.className = "theater-map-city-label-surface";
        surface.textContent = entry.location.toUpperCase();
        element.append(surface);
        styleCityLabel(element, surface, {
          active,
          syncing: syncingRef.current,
          opacity: 0,
          interactive: false,
          zIndex: active
            ? SELECTED_CITY_Z_INDEX
            : getCityMarkerZIndex(revealZoom, cityRevealConfig),
        });
        element.addEventListener("click", () => {
          if (syncingRef.current) {
            return;
          }

          void handleLocationSelect(entry.location, {
            clearSearch: searchQueryRef.current.length > 0,
          });
        });
        labelElements.set(entry.location, {
          element,
          surface,
          center: entry.labelCenter,
          priority: getCityPriority(entry),
          minZoom: revealZoom,
        });
        element.dataset.city = entry.location;
        element.dataset.minZoom = String(revealZoom);

        markers.push(
          new Marker({
            element,
            anchor: "center",
          })
            .setLngLat(entry.labelCenter)
            .addTo(map),
        );
      }

      for (const city of SECONDARY_CITIES) {
        const element = document.createElement("span");
        element.className = "theater-map-secondary-city-label";
        element.style.zIndex = "20";
        element.textContent = city.name;
        element.dataset.minZoom = String(city.minZoom);
        styleSecondaryCityLabel(element, false);
        secondaryLabelElements.push({
          element,
          center: city.center,
          priority: city.priority,
          minZoom: city.minZoom,
        });

        markers.push(
          new Marker({
            element,
            anchor: "center",
          })
            .setLngLat(city.center)
            .addTo(map),
        );
      }

      for (const theater of theaters) {
        const element = document.createElement("button");
        element.type = "button";
        element.className = "theater-map-theater-dot";
        element.style.zIndex = THEATER_MARKER_Z_INDEX;
        element.style.setProperty(
          "--theater-dot-color",
          THEATER_DOT_COLORS[normalizeTheaterChain(theater.chain)] ?? "#8c96a6",
        );
        element.setAttribute(
          "aria-label",
          `${theater.theaterName}, ${theater.address}`,
        );
        element.dataset.lng = String(theater.lng);
        element.dataset.lat = String(theater.lat);
        const surface = document.createElement("span");
        surface.className = "theater-map-theater-dot-surface";
        surface.setAttribute("aria-hidden", "true");
        surface.innerHTML = THEATER_MARKER_ICON;
        element.append(surface);
        styleTheaterDot(element, false);

        const popupContent = document.createElement("div");
        popupContent.className = "theater-map-theater-popup";

        const title = document.createElement("strong");
        title.className = "theater-map-theater-popup-title";
        title.textContent = theater.theaterName;
        popupContent.appendChild(title);

        const address = document.createElement("span");
        address.className = "theater-map-theater-popup-link";
        address.textContent = theater.address;
        popupContent.appendChild(address);

        const popup = new Popup({
          closeButton: false,
          closeOnClick: false,
          offset: THEATER_POPUP_OFFSET,
          className: "theater-map-theater-popup-shell",
        }).setDOMContent(popupContent);

        const canShowTheaterPopup = () =>
          element.classList.contains("is-visible");

        element.addEventListener("mouseenter", () => {
          if (!canShowTheaterPopup()) {
            return;
          }

          styleTheaterDot(element, true, true);
          popup.setMaxWidth(getTheaterPopupMaxWidth(map));
          popup.options.anchor = chooseTheaterPopupAnchor({
            address: theater.address,
            currentElement: element,
            labelElements,
            map,
            secondaryLabelElements,
            theaterMarkers,
            title: theater.theaterName,
          });
          popup.setLngLat([theater.lng, theater.lat]).addTo(map);
        });
        element.addEventListener("mouseleave", () => {
          styleTheaterDot(element, canShowTheaterPopup(), false);
          popup.remove();
        });
        element.addEventListener("focus", () => {
          if (!canShowTheaterPopup()) {
            return;
          }

          styleTheaterDot(element, true, true);
          popup.setMaxWidth(getTheaterPopupMaxWidth(map));
          popup.options.anchor = chooseTheaterPopupAnchor({
            address: theater.address,
            currentElement: element,
            labelElements,
            map,
            secondaryLabelElements,
            theaterMarkers,
            title: theater.theaterName,
          });
          popup.setLngLat([theater.lng, theater.lat]).addTo(map);
        });
        element.addEventListener("blur", () => {
          styleTheaterDot(element, canShowTheaterPopup(), false);
          popup.remove();
        });
        element.addEventListener("click", () => {
          if (!canShowTheaterPopup()) {
            return;
          }

          window.open(theater.location, "_blank", "noopener,noreferrer");
        });

        const marker = new Marker({
          element,
          anchor: "center",
        })
          .setLngLat([theater.lng, theater.lat])
          .addTo(map);

        theaterMarkers.push({
          marker,
          element,
          location: theater.city.name,
          popup,
        });
      }

      map.on("moveend", scheduleSyncMarkerVisibility);
      map.on("zoomend", scheduleSyncMarkerVisibility);
      map.on("move", scheduleSyncMarkerVisibility);
      map.on("zoom", scheduleSyncMarkerVisibility);
      map.on("resize", scheduleSyncMarkerVisibility);
      scheduleSyncMarkerVisibility();
      theaterMarkersRef.current = theaterMarkers;
    }

    addMapMarkers();

    return () => {
      for (const marker of markers) {
        marker.remove();
      }

      for (const theaterMarker of theaterMarkers) {
        theaterMarker.popup.remove();
        theaterMarker.marker.remove();
      }

      if (visibilityFrame !== 0) {
        window.cancelAnimationFrame(visibilityFrame);
      }

      map.off("moveend", scheduleSyncMarkerVisibility);
      map.off("zoomend", scheduleSyncMarkerVisibility);
      map.off("move", scheduleSyncMarkerVisibility);
      map.off("zoom", scheduleSyncMarkerVisibility);
      map.off("resize", scheduleSyncMarkerVisibility);
      scheduleVisibilitySyncRef.current = null;
      cityMarkersRef.current = [];
      secondaryCityLabelElementsRef.current = [];
      theaterMarkersRef.current = [];
      labelElements.clear();
      cityLabelElementsRef.current = new Map();
    };
  }, [
    cityEntryMap,
    cityEntries,
    cityRevealConfig,
    handleLocationSelect,
    isBaseMapReady,
    theaters,
  ]);

  return (
    <div
      className={[
        "theater-map-panel",
        !isBaseMapReady ? "is-loading-base-map" : null,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="theater-map-panel-bar" />

      <div className="theater-map-canvas-shell">
        <div className="theater-map-canvas" ref={mapContainerRef} />
        {mapControlMessage ? (
          <div className="theater-map-control-message" aria-live="polite">
            {mapControlMessage}
          </div>
        ) : isBaseMapReady && !isTheaterMapDataReady ? (
          <div className="theater-map-control-message" aria-live="polite">
            Loading theater locations...
          </div>
        ) : null}

        <div className="theater-map-search-row theater-map-search-row--overlay">
          <div className="theater-map-city-list-wrap" ref={cityListWrapRef}>
            <button
              type="button"
              className="theater-map-search-action-button theater-map-city-list-button"
              aria-expanded={isCityListOpen}
              aria-haspopup="listbox"
              aria-label="Open city list"
              disabled={!isTheaterMapDataReady}
              onClick={() => {
                setIsCityListOpen((current) => !current);
              }}
            >
              <List size={18} strokeWidth={2.6} />
            </button>

            {isCityListOpen ? (
              <div
                className="theater-map-city-list-panel"
                role="listbox"
                aria-label="Select a city"
              >
                {availableCityLocations.map((location) => {
                  const isSelected =
                    location === (optimisticLocation ?? currentLocation);

                  return (
                    <button
                      key={location}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`theater-map-city-list-option${
                        isSelected ? " is-selected" : ""
                      }`}
                      onClick={() => {
                        setIsCityListOpen(false);

                        if (location === currentLocationRef.current) {
                          focusLocation(location, {
                            clearSearch: searchQueryRef.current.length > 0,
                          });
                          return;
                        }

                        void handleLocationSelect(location, {
                          clearSearch: searchQueryRef.current.length > 0,
                        });
                      }}
                    >
                      {location}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div className="theater-map-current-chip theater-map-current-chip--search">
            {displayedCurrentLocation}
          </div>

          <label className="theater-map-search-field">
            <div className="theater-map-search-input-shell">
              <Search size={17} />
              <input
                ref={searchInputRef}
                type="search"
                name="city-search"
                value={query}
                disabled={!isTheaterMapDataReady}
                onKeyDown={(event) => {
                  if (
                    event.key !== "Enter" ||
                    !normalizedQuery ||
                    matchingSearchLocations.length !== 1 ||
                    syncingRef.current
                  ) {
                    return;
                  }

                  event.preventDefault();
                  void handleLocationSelect(matchingSearchLocations[0], {
                    clearSearch: true,
                  });
                }}
                onChange={(event) => {
                  const nextQuery = event.target.value;
                  const nextNormalizedQuery =
                    normalizeCitySearchQuery(nextQuery);

                  clearPendingSearchZoomOut();
                  setQuery(nextQuery);

                  if (!nextNormalizedQuery) {
                    return;
                  }

                  searchZoomOutTimeoutRef.current = window.setTimeout(() => {
                    if (searchQueryRef.current !== nextNormalizedQuery) {
                      return;
                    }

                    fitStartingView({ duration: 420 });
                    searchZoomOutTimeoutRef.current = null;
                  }, 120);
                }}
                placeholder="Search"
              />
              {query ? (
                <button
                  type="button"
                  className="theater-map-search-clear"
                  aria-label="Clear city search"
                  onClick={() => {
                    clearSearchQuery();
                  }}
                >
                  <span
                    className="theater-map-search-clear-icon"
                    aria-hidden="true"
                  />
                </button>
              ) : null}
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}
