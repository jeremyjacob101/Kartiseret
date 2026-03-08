import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Building2,
  Ban,
  LoaderCircle,
  Info,
  LocateFixed,
  Navigation,
  Search,
  X,
} from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  type IControl,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { loadTheaters, type Theater } from "../data/theaters";
import { ALL_LOCATIONS, type AppLocation } from "../prefs/locations";

const MAP_STYLE_URL =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const CITY_START_BOUNDS: [[number, number], [number, number]] = [
  [34.48, 31.18],
  [35.34, 33.02],
];
const INITIAL_MAP_CENTER: [number, number] = [34.96, 32.15];
const INITIAL_MAP_ZOOM = 2;
const DEFAULT_CITY_REVEAL_ZOOM = 10;
const CITY_REVEAL_ZOOM: Partial<Record<AppLocation, number>> = {
  Jerusalem: 0,
  "Beer Sheva": 6,
  "Tel Aviv": 6,
  Haifa: 6,
  Ashkelon: 7,
  Ashdod: 7.5,
  "Zichron Yaakov": 7.5,
  Carmiel: 7.5,
  Netanya: 7.5,
  Modiin: 7.5,
  Chadera: 8,
  Nahariya: 8,
  "Rishon Letzion": 8,
  Glilot: 8,
  "Kiryat Bialik": 8.5,
  Herziliya: 9,
  Rehovot: 9,
  Omer: 9,
  Ayalon: 9.5,
  "Kfar Saba": 9.5,
};
const CITY_OPACITY_BASE = 0.01;
const CITY_OPACITY_STEP = 0.085;
const CITY_MAX_PRE_REVEAL_OPACITY = 0.9;
const CITY_OPACITY_LAYERS = Array.from(
  new Set(
    [...Object.values(CITY_REVEAL_ZOOM), DEFAULT_CITY_REVEAL_ZOOM].filter(
      (zoom): zoom is number => typeof zoom === "number" && zoom > 0,
    ),
  ),
).sort((left, right) => left - right);
const CITY_REVEAL_LAYERS = Array.from(
  new Set([0, ...Object.values(CITY_REVEAL_ZOOM), DEFAULT_CITY_REVEAL_ZOOM]),
).sort((left, right) => left - right);
const CITY_Z_INDEX_BY_REVEAL_ZOOM = new Map(
  CITY_REVEAL_LAYERS.map((zoom, index) => [zoom, String(100 - index)]),
);
const FIRST_CITY_OPACITY_LAYER = CITY_OPACITY_LAYERS[0] ?? DEFAULT_CITY_REVEAL_ZOOM;
const SELECTED_CITY_Z_INDEX = "200";
const PRIMARY_CITY_COLLISION_PADDING = { x: 18, y: 14 };
const CITY_LABEL_NORTH_OFFSET = 0.00615;
const MAP_MAX_ZOOM = 16.5;
const SINGLE_CITY_FOCUS_ZOOM = 11.6;
const appLocationSet = new Set<string>(ALL_LOCATIONS);
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
  { name: "Afula", center: [35.2892, 32.6091], minZoom: 9.7, priority: 58 },
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
  location: AppLocation;
  center: [number, number];
  labelCenter: [number, number];
  theaterCount: number;
  chains: string[];
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
  location: AppLocation | null;
  popup: Popup;
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
  onPickLocation: (location: AppLocation) => Promise<void>;
  onClose?: () => void;
  syncing?: boolean;
};

const THEATER_DOT_COLORS: Record<string, string> = {
  "Yes Planet": "#d9710f",
  "Cinema City": "#186bdf",
  "Lev Cinema": "#b50519",
  "Rav Hen": "#ab5306",
  "Hot Cinema": "#f06a87",
  Movieland: "#a80371",
  Cinematheque: "#31a26d",
};

function isAppLocation(value: string): value is AppLocation {
  return appLocationSet.has(value);
}

function getFitPadding() {
  return window.innerWidth <= 720
    ? { top: 24, right: 18, bottom: 24, left: 18 }
    : { top: 30, right: 28, bottom: 30, left: 28 };
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
  let nearestLocation: AppLocation | null = null;
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

const RESET_CONTROL_ICON = renderToStaticMarkup(
  <LocateFixed size={18} strokeWidth={2.5} />,
);
const THEATERS_CONTROL_ICON = renderToStaticMarkup(
  <Building2 size={16} strokeWidth={2.5} />,
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
const NAVIGATION_CONTROL_ICON = renderToStaticMarkup(
  <Navigation size={16} strokeWidth={3} />,
);

class TheaterMapAttributionControl implements IControl {
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
    osmLink.href = "https://www.openstreetmap.org/copyright";
    osmLink.target = "_blank";
    osmLink.rel = "noopener noreferrer";
    osmLink.textContent = "OpenStreetMap contributors";

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
    this.setOpen(false);
    document.addEventListener("mousedown", this.handleDocumentMouseDown);
    document.addEventListener("keydown", this.handleDocumentKeyDown);

    return container;
  }

  onRemove() {
    document.removeEventListener("mousedown", this.handleDocumentMouseDown);
    document.removeEventListener("keydown", this.handleDocumentKeyDown);
    this.container?.remove();
    this.container = undefined;
    this.button = undefined;
  }

  private setOpen(isOpen: boolean) {
    this.isOpen = isOpen;
    this.container?.classList.toggle("is-open", isOpen);
    this.button?.setAttribute("aria-expanded", String(isOpen));
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

class TheaterMapTheatersControl implements IControl {
  private container?: HTMLDivElement;
  private button?: HTMLButtonElement;
  private isActive: boolean;
  private readonly onToggle: () => void;

  constructor(options: { active: boolean; onToggle: () => void }) {
    this.isActive = options.active;
    this.onToggle = options.onToggle;
  }

  onAdd() {
    const container = document.createElement("div");
    container.className =
      "maplibregl-ctrl maplibregl-ctrl-group theater-map-theaters-control";

    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "theater-map-action-button theater-map-action-button--theaters";
    button.addEventListener("click", this.onToggle);

    const icon = document.createElement("span");
    icon.className =
      "theater-map-action-glyph theater-map-action-glyph--theaters";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = THEATERS_CONTROL_ICON;

    button.append(icon);
    container.append(button);
    this.container = container;
    this.button = button;
    this.syncButton();

    return container;
  }

  onRemove() {
    this.container?.remove();
    this.container = undefined;
    this.button = undefined;
  }

  setActive(isActive: boolean) {
    this.isActive = isActive;
    this.syncButton();
  }

  private syncButton() {
    if (!this.button) {
      return;
    }

    this.button.setAttribute("aria-pressed", String(this.isActive));
    this.button.setAttribute(
      "aria-label",
      this.isActive ? "Hide theaters" : "Show theaters",
    );
    this.button.title = this.isActive ? "Hide theaters" : "Show theaters";
  }
}

class TheaterMapActionControl implements IControl {
  private container?: HTMLDivElement;
  private locateButton?: HTMLButtonElement;
  private locateGlyph?: HTMLSpanElement;
  private locateTooltip?: HTMLDivElement;
  private isLocatePending = false;
  private blockedLocateMessage: string | null;
  private readonly options: {
    blockedLocateMessage: string | null;
    onReset: () => void;
    onLocate: () => void;
  };

  constructor(options: {
    blockedLocateMessage: string | null;
    onReset: () => void;
    onLocate: () => void;
  }) {
    this.options = options;
    this.blockedLocateMessage = options.blockedLocateMessage;
  }

  onAdd() {
    const container = document.createElement("div");
    container.className = "maplibregl-ctrl theater-map-action-controls-wrap";

    const controlsGroup = document.createElement("div");
    controlsGroup.className =
      "maplibregl-ctrl-group theater-map-action-controls";

    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.className =
      "theater-map-action-button theater-map-action-button--reset";
    resetButton.setAttribute("aria-label", "Reset map view");
    resetButton.title = "Reset map view";
    resetButton.addEventListener("click", this.options.onReset);
    const resetIcon = document.createElement("span");
    resetIcon.className =
      "theater-map-action-glyph theater-map-action-glyph--reset";
    resetIcon.setAttribute("aria-hidden", "true");
    resetIcon.innerHTML = RESET_CONTROL_ICON;
    resetButton.append(resetIcon);

    const locateButton = document.createElement("button");
    locateButton.type = "button";
    locateButton.className =
      "theater-map-action-button theater-map-action-button--locate";
    locateButton.setAttribute("aria-label", "Find nearest city to my location");
    locateButton.addEventListener("click", (event) => {
      if (this.blockedLocateMessage || this.isLocatePending) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      this.options.onLocate();
    });
    const locateGlyph = document.createElement("span");
    locateGlyph.className = "theater-map-action-glyph";
    locateGlyph.setAttribute("aria-hidden", "true");
    locateGlyph.innerHTML = NAVIGATION_CONTROL_ICON;
    locateButton.append(locateGlyph);

    const locateTooltip = document.createElement("div");
    locateTooltip.className = "theater-map-action-tooltip";
    locateTooltip.setAttribute("aria-hidden", "true");

    const toggleTooltip = (visible: boolean) => {
      if (!this.blockedLocateMessage || !this.locateTooltip) {
        return;
      }

      this.locateTooltip.classList.toggle("is-visible", visible);
      this.locateTooltip.setAttribute("aria-hidden", String(!visible));
    };

    locateButton.addEventListener("mouseenter", () => {
      toggleTooltip(true);
    });
    locateButton.addEventListener("mouseleave", () => {
      toggleTooltip(false);
    });
    locateButton.addEventListener("focus", () => {
      toggleTooltip(true);
    });
    locateButton.addEventListener("blur", () => {
      toggleTooltip(false);
    });

    controlsGroup.append(resetButton, locateButton);
    container.append(controlsGroup, locateTooltip);
    this.container = container;
    this.locateButton = locateButton;
    this.locateGlyph = locateGlyph;
    this.locateTooltip = locateTooltip;
    this.syncLocateButton();

    return container;
  }

  onRemove() {
    this.container?.remove();
    this.container = undefined;
    this.locateButton = undefined;
    this.locateGlyph = undefined;
    this.locateTooltip = undefined;
  }

  setLocatePending(isPending: boolean) {
    this.isLocatePending = isPending;
    this.syncLocateButton();
  }

  setLocateBlocked(message: string | null) {
    this.blockedLocateMessage = message;
    this.syncLocateButton();
  }

  private syncLocateButton() {
    if (!this.locateButton || !this.locateGlyph || !this.locateTooltip) {
      return;
    }

    const isBlocked = this.blockedLocateMessage !== null;
    this.locateButton.disabled = false;
    this.locateButton.setAttribute("aria-busy", String(this.isLocatePending));
    this.locateButton.setAttribute(
      "aria-disabled",
      String(isBlocked || this.isLocatePending),
    );
    this.locateGlyph.innerHTML = isBlocked
      ? BLOCKED_LOCATE_ICON
      : NAVIGATION_CONTROL_ICON;
    this.locateTooltip.textContent =
      this.blockedLocateMessage ?? LOCATION_DISABLED_MESSAGE;
    this.locateTooltip.classList.remove("is-visible");
    this.locateTooltip.setAttribute("aria-hidden", "true");

    if (isBlocked) {
      this.locateButton.title = "";
      return;
    }

    this.locateButton.title = this.isLocatePending
      ? "Waiting for location access..."
      : "Find nearest city to my location";
  }
}

function buildCityEntries(theaters: readonly Theater[]): CityEntry[] {
  const theatersByCity = new Map<AppLocation, Theater[]>();

  for (const theater of theaters) {
    if (!isAppLocation(theater.city)) {
      continue;
    }

    const cityTheaters = theatersByCity.get(theater.city) ?? [];
    cityTheaters.push(theater);
    theatersByCity.set(theater.city, cityTheaters);
  }

  return ALL_LOCATIONS.flatMap((location) => {
    const cityTheaters = theatersByCity.get(location) ?? [];
    const points = cityTheaters.flatMap((theater) =>
      theater.lat !== null && theater.lng !== null
        ? ([[theater.lng, theater.lat]] as [number, number][])
        : [],
    );

    if (points.length === 0) {
      return [];
    }

    const center = points.reduce(
      (accumulator, [lng, lat]) => [
        accumulator[0] + lng / points.length,
        accumulator[1] + lat / points.length,
      ],
      [0, 0],
    ) as [number, number];

    return [
      {
        location,
        center,
        labelCenter: [center[0], center[1] + CITY_LABEL_NORTH_OFFSET],
        theaterCount: cityTheaters.length,
        chains: [
          ...new Set(cityTheaters.map((theater) => theater.chain)),
        ].sort(),
      },
    ];
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
) {
  element.classList.toggle("is-visible", visible);
  element.setAttribute("aria-hidden", String(!visible));
  element.tabIndex = visible ? 0 : -1;
  element.style.pointerEvents = visible ? "auto" : "none";
}

function configureBaseLabels(map: MapLibreMap) {
  const layers = map.getStyle().layers ?? [];

  for (const layer of layers) {
    if (layer.type !== "symbol") {
      continue;
    }

    const layerId = layer.id.toLowerCase();
    const isRoadLabel = ROAD_LABEL_KEYWORDS.some((keyword) =>
      layerId.includes(keyword),
    );
    const shouldHide = NON_ROAD_LABEL_KEYWORDS.some((keyword) =>
      layerId.includes(keyword),
    );

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
    return "Movieland";
  }

  if (normalized === "ravhen" || normalized === "rav hen") {
    return "Rav Hen";
  }

  if (normalized.includes("cinematheque")) {
    return "Cinematheque";
  }

  return chain;
}

function getTheaterDotColor(chain: string): string {
  return THEATER_DOT_COLORS[normalizeTheaterChain(chain)] ?? "#8c96a6";
}

function getTheaterDisplayName(theater: Theater): string {
  if (theater.address && !/\d/.test(theater.address)) {
    return theater.address;
  }

  return `${theater.chain} ${theater.city}`.trim();
}

function getCityMinZoom(entry: CityEntry): number {
  return CITY_REVEAL_ZOOM[entry.location] ?? DEFAULT_CITY_REVEAL_ZOOM;
}

function getCityMarkerZIndex(revealZoom: number) {
  return CITY_Z_INDEX_BY_REVEAL_ZOOM.get(getEffectiveCityRevealZoom(revealZoom)) ?? "1";
}

function getEffectiveCityRevealZoom(revealZoom: number) {
  return revealZoom > 0 ? revealZoom : FIRST_CITY_OPACITY_LAYER;
}

function getCityLabelOpacity(
  zoom: number,
  revealZoom: number,
  selected: boolean,
) {
  if (selected) {
    return 1;
  }

  const effectiveRevealZoom = getEffectiveCityRevealZoom(revealZoom);

  if (zoom >= effectiveRevealZoom) {
    return 1;
  }

  let passedLayerCount = 0;

  for (const layerZoom of CITY_OPACITY_LAYERS) {
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
) {
  if (selected) {
    return true;
  }

  return zoom >= getEffectiveCityRevealZoom(revealZoom);
}

function getCityPriority(entry: CityEntry): number {
  const revealZoom = getCityMinZoom(entry);
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

function estimateCityBubbleSize(location: AppLocation, active: boolean) {
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
  onPickLocation,
  onClose,
  syncing = false,
}: CityLocationPickerProps) {
  const [query, setQuery] = useState("");
  const [showTheaters, setShowTheaters] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [isMapLoading, setIsMapLoading] = useState(false);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [mapControlMessage, setMapControlMessage] = useState<string | null>(
    null,
  );
  const [theaters, setTheaters] = useState<Theater[]>([]);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const mapActionControlRef = useRef<TheaterMapActionControl | null>(null);
  const mapTheatersControlRef = useRef<TheaterMapTheatersControl | null>(null);
  const locateBlockedMessageRef = useRef<string | null>(
    typeof navigator === "undefined" ||
      typeof navigator.geolocation === "undefined"
      ? LOCATION_UNSUPPORTED_MESSAGE
      : null,
  );
  const onCloseRef = useRef(onClose);
  const currentLocationRef = useRef(currentLocation);
  const syncingRef = useRef(syncing);
  const showTheatersRef = useRef(showTheaters);
  const geolocationRequestRef = useRef(false);
  const cityLabelElementsRef = useRef(new Map<AppLocation, CityMarkerState>());
  const secondaryCityLabelElementsRef = useRef<SecondaryCityMarkerState[]>([]);
  const cityMarkersRef = useRef<Marker[]>([]);
  const theaterMarkersRef = useRef<TheaterMarkerState[]>([]);
  const scheduleVisibilitySyncRef = useRef<(() => void) | null>(null);

  const cityEntries = useMemo(() => buildCityEntries(theaters), [theaters]);
  const cityEntryMap = useMemo(
    () => new Map(cityEntries.map((entry) => [entry.location, entry] as const)),
    [cityEntries],
  );

  const fitStartingView = useCallback(
    (options: { animate?: boolean; duration?: number } = {}) => {
      const map = mapRef.current;

      if (!map) {
        return;
      }

      map.fitBounds(CITY_START_BOUNDS, {
        padding: getFitPadding(),
        duration: options.animate === false ? 0 : (options.duration ?? 720),
        easing: (progress) => 1 - (1 - progress) ** 3,
        maxZoom: 6.9,
        essential: true,
      });
    },
    [],
  );

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

  const handleLocationSelect = useCallback(
    async (nextLocation: AppLocation) => {
      fitLocations([nextLocation]);
      await onPickLocation(nextLocation);
    },
    [fitLocations, onPickLocation],
  );

  const setLocateBlockedMessage = useCallback((message: string | null) => {
    locateBlockedMessageRef.current = message;
    mapActionControlRef.current?.setLocateBlocked(message);
  }, []);

  const handleLocateNearestCity = useCallback(() => {
    if (geolocationRequestRef.current) {
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
  }, [cityEntries, handleLocationSelect, setLocateBlockedMessage]);

  useEffect(() => {
    let cancelled = false;

    void loadTheaters()
      .then((nextTheaters) => {
        if (cancelled) {
          return;
        }

        startTransition(() => {
          setTheaters(nextTheaters);
          setLoadState("ready");
          setLoadErrorMessage(null);
          setIsMapLoading(true);
        });
      })
      .catch((loadError: unknown) => {
        if (cancelled) {
          return;
        }

        setLoadErrorMessage(
          loadError instanceof Error
            ? loadError.message
            : "Could not load theaters from Supabase.",
        );
        setIsMapLoading(false);
        setLoadState("error");
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
    currentLocationRef.current = currentLocation;
    syncingRef.current = syncing;
    scheduleVisibilitySyncRef.current?.();
  }, [currentLocation, syncing]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

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
    showTheatersRef.current = showTheaters;
    mapTheatersControlRef.current?.setActive(showTheaters);
  }, [showTheaters]);

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
    scheduleVisibilitySyncRef.current?.();
  }, [showTheaters]);

  useEffect(() => {
    if (!mapContainerRef.current || cityEntries.length === 0) {
      return;
    }

    const map = new MapLibreMap({
      container: mapContainerRef.current,
      style: MAP_STYLE_URL,
      center: INITIAL_MAP_CENTER,
      zoom: INITIAL_MAP_ZOOM,
      maxZoom: MAP_MAX_ZOOM,
      renderWorldCopies: false,
      attributionControl: false,
    });
    const labelElements = new Map<AppLocation, CityMarkerState>();
    const secondaryLabelElements: SecondaryCityMarkerState[] = [];
    const markers: Marker[] = [];
    const theaterMarkers: TheaterMarkerState[] = [];
    const mapActionControl = new TheaterMapActionControl({
      blockedLocateMessage: locateBlockedMessageRef.current,
      onReset: () => {
        setMapControlMessage(null);
        fitStartingView();
      },
      onLocate: handleLocateNearestCity,
    });
    const mapTheatersControl = new TheaterMapTheatersControl({
      active: showTheatersRef.current,
      onToggle: () => {
        setShowTheaters((current) => !current);
      },
    });
    let visibilityFrame = 0;

    mapRef.current = map;
    mapActionControlRef.current = mapActionControl;
    mapTheatersControlRef.current = mapTheatersControl;
    cityLabelElementsRef.current = labelElements;
    secondaryCityLabelElementsRef.current = secondaryLabelElements;
    cityMarkersRef.current = markers;
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
    map.addControl(mapTheatersControl, "top-right");
    map.addControl(new TheaterMapAttributionControl(), "bottom-right");

    function syncMarkerVisibility() {
      const zoom = map.getZoom();
      const currentSelection = currentLocationRef.current;
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
        const active = location === currentSelection;
        const opacity = getCityLabelOpacity(zoom, state.minZoom, active);
        const interactive = isCityLabelRevealed(zoom, state.minZoom, active);

        styleCityLabel(state.element, state.surface, {
          active,
          syncing: syncingRef.current,
          opacity,
          interactive,
          zIndex: active ? SELECTED_CITY_Z_INDEX : getCityMarkerZIndex(state.minZoom),
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
          rectanglesOverlap(collisionRect, visibleRect),
        );
        const withinBudget = visibleSecondaryCount < maxVisibleSecondaryCities;
        const visible = inViewport && withinBudget && !collides;

        styleSecondaryCityLabel(state.element, visible);

        if (visible) {
          visibleRects.push(collisionRect);
          visibleSecondaryCount += 1;
        }
      }

      for (const theaterMarker of theaterMarkers) {
        const cityState = theaterMarker.location
          ? labelElements.get(theaterMarker.location)
          : undefined;
        const active = theaterMarker.location === currentSelection;
        const visible =
          showTheatersRef.current &&
          cityState !== undefined &&
          isCityLabelRevealed(zoom, cityState.minZoom, active);

        styleTheaterDot(theaterMarker.element, visible);

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

    function handleLoad() {
      configureBaseLabels(map);

      for (const entry of cityEntries) {
        const revealZoom = getCityMinZoom(entry);
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
          opacity: getCityLabelOpacity(map.getZoom(), revealZoom, active),
          interactive: isCityLabelRevealed(map.getZoom(), revealZoom, active),
          zIndex: active ? SELECTED_CITY_Z_INDEX : getCityMarkerZIndex(revealZoom),
        });
        element.addEventListener("click", () => {
          if (syncingRef.current) {
            return;
          }

          void handleLocationSelect(entry.location);
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
        if (theater.lat === null || theater.lng === null) {
          continue;
        }

        const element = document.createElement("button");
        element.type = "button";
        element.className = "theater-map-theater-dot";
        element.style.zIndex = "10";
        element.style.setProperty(
          "--theater-dot-color",
          getTheaterDotColor(theater.chain),
        );
        element.setAttribute(
          "aria-label",
          `${getTheaterDisplayName(theater)}, ${theater.address}`,
        );
        const surface = document.createElement("span");
        surface.className = "theater-map-theater-dot-surface";
        surface.setAttribute("aria-hidden", "true");
        element.append(surface);
        styleTheaterDot(element, false);

        const popupContent = document.createElement("div");
        popupContent.className = "theater-map-theater-popup";

        const title = document.createElement("strong");
        title.className = "theater-map-theater-popup-title";
        title.textContent = getTheaterDisplayName(theater);
        popupContent.appendChild(title);

        const address = document.createElement("span");
        address.className = "theater-map-theater-popup-link";
        address.textContent = theater.address;
        popupContent.appendChild(address);

        const popup = new Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 14,
          anchor: "top",
          className: "theater-map-theater-popup-shell",
        }).setDOMContent(popupContent);

        const canShowTheaterPopup = () =>
          element.classList.contains("is-visible");

        element.addEventListener("mouseenter", () => {
          if (!canShowTheaterPopup()) {
            return;
          }

          popup.setLngLat([theater.lng!, theater.lat!]).addTo(map);
        });
        element.addEventListener("mouseleave", () => {
          popup.remove();
        });
        element.addEventListener("focus", () => {
          if (!canShowTheaterPopup()) {
            return;
          }

          popup.setLngLat([theater.lng!, theater.lat!]).addTo(map);
        });
        element.addEventListener("blur", () => {
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
          location: isAppLocation(theater.city) ? theater.city : null,
          popup,
        });
      }

      map.on("moveend", scheduleSyncMarkerVisibility);
      map.on("zoomend", scheduleSyncMarkerVisibility);
      map.on("move", scheduleSyncMarkerVisibility);
      map.on("zoom", scheduleSyncMarkerVisibility);
      map.on("resize", scheduleSyncMarkerVisibility);
      syncMarkerVisibility();
      window.requestAnimationFrame(() => {
        fitStartingView({ duration: 1000 });
      });
      theaterMarkersRef.current = theaterMarkers;
      setIsMapLoading(false);
    }

    map.once("load", handleLoad);

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
      mapActionControlRef.current = null;
      mapTheatersControlRef.current = null;
      geolocationRequestRef.current = false;
      setIsMapLoading(false);
      map.remove();
      mapRef.current = null;
    };
  }, [
    cityEntries,
    fitStartingView,
    handleLocateNearestCity,
    handleLocationSelect,
    theaters,
  ]);

  return (
    <div className={["theater-map-panel", className].filter(Boolean).join(" ")}>
      <div className="theater-map-panel-bar" />

      <div className="theater-map-canvas-shell">
        <div className="theater-map-canvas" ref={mapContainerRef} />
        <div className="theater-map-current-chip theater-map-current-chip--overlay">
          {currentLocation}
        </div>
        {mapControlMessage ? (
          <div className="theater-map-control-message" aria-live="polite">
            {mapControlMessage}
          </div>
        ) : null}

        {loadState === "loading" || isMapLoading ? (
          <div className="theater-map-state">
            <LoaderCircle className="theater-map-spinner" size={22} />
            <p>Loading city map...</p>
          </div>
        ) : loadState === "error" ? (
          <div className="theater-map-state theater-map-state--error">
            <p>
              {loadErrorMessage ?? "Could not load theaters from Supabase."}
            </p>
          </div>
        ) : null}
      </div>

      <label className="theater-map-search-field">
        <div className="theater-map-search-input-shell">
          <Search size={17} />
          <input
            ref={searchInputRef}
            type="search"
            name="city-search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Search any city in your theater list"
          />
        </div>
      </label>
    </div>
  );
}
