import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LoaderCircle, LocateFixed, Search } from "lucide-react";
import {
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
const ALWAYS_VISIBLE_CITIES = new Set<AppLocation>([
  "Beer Sheva",
  "Haifa",
  "Jerusalem",
  "Tel Aviv",
]);
const JERUSALEM_ONLY_MAX_ZOOM = 6.35;
const ANCHOR_CITIES_ONLY_MAX_ZOOM = 8.55;
const MID_CITY_MIN_ZOOM = 9.4;
const DETAIL_CITY_MIN_ZOOM = 10.05;
const OTHER_CITY_MIN_ZOOM = 9.75;
const MAP_MAX_ZOOM = 16.5;
const SINGLE_CITY_FOCUS_ZOOM = 11.6;
const MID_ZOOM_CITIES = new Set<AppLocation>([
  "Ashdod",
  "Ashkelon",
  "Carmiel",
  "Chadera",
  "Kiryat Bialik",
  "Netanya",
  "Omer",
  "Rishon Letzion",
  "Zichron Yaakov",
]);
const DETAIL_ZOOM_CITIES = new Set<AppLocation>([
  "Ayalon",
  "Even Yehuda",
  "Givataim",
  "Glilot",
  "Herziliya",
  "Kfar Saba",
  "Kiryat Ono",
  "Modiin",
  "Petach Tikvah",
  "Raanana",
  "Ramat Hasharon",
  "Rehovot",
]);
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
  { name: "Ramat Gan", center: [34.8248, 32.0706], minZoom: 9.85, priority: 66 },
  { name: "Bnei Brak", center: [34.8334, 32.0836], minZoom: 10.1, priority: 50 },
  { name: "Lod", center: [34.8881, 31.951], minZoom: 9.85, priority: 58 },
  { name: "Ramla", center: [34.8675, 31.9316], minZoom: 9.95, priority: 54 },
  { name: "Yavne", center: [34.7386, 31.8781], minZoom: 10.05, priority: 46 },
  { name: "Ness Ziona", center: [34.7987, 31.9293], minZoom: 10.1, priority: 42 },
  { name: "Ramallah", center: [35.2045, 31.9038], minZoom: 9.75, priority: 72 },
  { name: "Bethlehem", center: [35.2034, 31.7054], minZoom: 9.9, priority: 64 },
  { name: "Hebron", center: [35.0998, 31.5326], minZoom: 9.85, priority: 68 },
  { name: "Jericho", center: [35.4581, 31.8702], minZoom: 10.1, priority: 40 },
  { name: "Nablus", center: [35.262, 32.2211], minZoom: 9.75, priority: 70 },
  { name: "Tulkarm", center: [35.0124, 32.3114], minZoom: 10, priority: 44 },
  { name: "Qalqilya", center: [34.9706, 32.1896], minZoom: 10.05, priority: 38 },
];

type CityEntry = {
  location: AppLocation;
  center: [number, number];
  theaterCount: number;
  chains: string[];
};

type CityMarkerState = {
  element: HTMLButtonElement;
  center: [number, number];
  priority: number;
  minZoom: number;
};

type TheaterMarkerState = {
  marker: Marker;
  element: HTMLButtonElement;
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
        theaterCount: cityTheaters.length,
        chains: [...new Set(cityTheaters.map((theater) => theater.chain))].sort(),
      },
    ];
  });
}

function styleCityLabel(
  element: HTMLButtonElement,
  options: {
    active: boolean;
    syncing: boolean;
    visible: boolean;
  },
) {
  element.classList.toggle("is-active", options.active);
  element.classList.toggle("is-hidden", !options.visible);
  element.disabled = options.syncing;
  element.setAttribute("aria-pressed", String(options.active));
  element.setAttribute("aria-disabled", String(options.syncing));
  element.tabIndex = options.visible ? 0 : -1;
}

function styleSecondaryCityLabel(
  element: HTMLSpanElement,
  visible: boolean,
) {
  element.classList.toggle("is-hidden", !visible);
  element.setAttribute("aria-hidden", String(!visible));
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
  if (ALWAYS_VISIBLE_CITIES.has(entry.location)) {
    return 0;
  }

  if (DETAIL_ZOOM_CITIES.has(entry.location)) {
    return DETAIL_CITY_MIN_ZOOM;
  }

  if (MID_ZOOM_CITIES.has(entry.location)) {
    return MID_CITY_MIN_ZOOM;
  }

  return OTHER_CITY_MIN_ZOOM;
}

function getCityPriority(entry: CityEntry): number {
  let priority = entry.theaterCount * 10;

  if (entry.location === "Jerusalem") {
    priority += 600;
  } else if (ALWAYS_VISIBLE_CITIES.has(entry.location)) {
    priority += 400;
  }

  if (MID_ZOOM_CITIES.has(entry.location)) {
    priority += 90;
  }

  if (DETAIL_ZOOM_CITIES.has(entry.location)) {
    priority += 20;
  }

  return priority;
}

function getMaxVisibleCities(zoom: number): number {
  if (zoom < JERUSALEM_ONLY_MAX_ZOOM) {
    return 1;
  }

  if (zoom < ANCHOR_CITIES_ONLY_MAX_ZOOM) {
    return 4;
  }

  if (zoom < MID_CITY_MIN_ZOOM) {
    return 5;
  }

  if (zoom < DETAIL_CITY_MIN_ZOOM) {
    return 8;
  }

  return 12;
}

function getMaxVisibleSecondaryCities(zoom: number): number {
  if (zoom < 9.35) {
    return 0;
  }

  if (zoom < 9.9) {
    return 6;
  }

  if (zoom < 10.4) {
    return 10;
  }

  return 14;
}

function getCityCollisionPadding(zoom: number) {
  if (zoom < ANCHOR_CITIES_ONLY_MAX_ZOOM) {
    return { x: 60, y: 34 };
  }

  if (zoom < MID_CITY_MIN_ZOOM) {
    return { x: 44, y: 28 };
  }

  if (zoom < DETAIL_CITY_MIN_ZOOM) {
    return { x: 30, y: 22 };
  }

  return { x: 18, y: 14 };
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

function isPrimaryCityAllowedAtZoom(location: AppLocation, zoom: number, minZoom: number) {
  if (zoom < JERUSALEM_ONLY_MAX_ZOOM) {
    return location === "Jerusalem";
  }

  if (zoom < ANCHOR_CITIES_ONLY_MAX_ZOOM) {
    return ALWAYS_VISIBLE_CITIES.has(location);
  }

  return zoom >= minZoom;
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
  syncing = false,
}: CityLocationPickerProps) {
  const [query, setQuery] = useState("");
  const [showTheaters, setShowTheaters] = useState(true);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [isMapLoading, setIsMapLoading] = useState(false);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [theaters, setTheaters] = useState<Theater[]>([]);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const currentLocationRef = useRef(currentLocation);
  const syncingRef = useRef(syncing);
  const showTheatersRef = useRef(showTheaters);
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

  const fitStartingView = useCallback((options: { animate?: boolean } = {}) => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    map.fitBounds(CITY_START_BOUNDS, {
      padding: getFitPadding(),
      duration: options.animate === false ? 0 : 720,
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

  const handleLocationSelect = useCallback(
    async (nextLocation: AppLocation) => {
      fitLocations([nextLocation]);
      await onPickLocation(nextLocation);
    },
    [fitLocations, onPickLocation],
  );

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
    showTheatersRef.current = showTheaters;
  }, [showTheaters]);

  useEffect(() => {
    const map = mapRef.current;

    for (const theaterMarker of theaterMarkersRef.current) {
      theaterMarker.element.classList.toggle("is-visible", showTheaters);

      if (!showTheaters) {
        theaterMarker.popup.remove();
        theaterMarker.marker.remove();
        continue;
      }

      if (map && !theaterMarker.marker.getElement().isConnected) {
        theaterMarker.marker.addTo(map);
      }
    }
  }, [showTheaters]);

  useEffect(() => {
    if (!mapContainerRef.current || cityEntries.length === 0) {
      return;
    }

    const map = new MapLibreMap({
      container: mapContainerRef.current,
      style: MAP_STYLE_URL,
      center: [34.96, 32.15],
      zoom: 6.25,
      maxZoom: MAP_MAX_ZOOM,
      renderWorldCopies: false,
      attributionControl: {
        compact: true,
      },
    });
    const labelElements = new Map<AppLocation, CityMarkerState>();
    const secondaryLabelElements: SecondaryCityMarkerState[] = [];
    const markers: Marker[] = [];
    const theaterMarkers: TheaterMarkerState[] = [];
    let visibilityFrame = 0;

    mapRef.current = map;
    cityLabelElementsRef.current = labelElements;
    secondaryCityLabelElementsRef.current = secondaryLabelElements;
    cityMarkersRef.current = markers;
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");

    function syncMarkerVisibility() {
      const zoom = map.getZoom();
      const currentSelection = currentLocationRef.current;
      const mapWidth = map.getContainer().clientWidth;
      const mapHeight = map.getContainer().clientHeight;
      const maxVisibleCities = getMaxVisibleCities(zoom);
      const maxVisibleSecondaryCities = getMaxVisibleSecondaryCities(zoom);
      const collisionPadding = getCityCollisionPadding(zoom);
      const secondaryCollisionPadding = getSecondaryCityCollisionPadding(zoom);
      const visibleRects: Array<{
        left: number;
        right: number;
        top: number;
        bottom: number;
      }> = [];
      let visibleCount = 0;
      let visibleSecondaryCount = 0;
      const candidates: Array<{
        location: AppLocation;
        state: CityMarkerState;
      }> = [];

      for (const [location, state] of labelElements) {
        const active = location === currentSelection;
        const baseVisible = isPrimaryCityAllowedAtZoom(
          location,
          zoom,
          state.minZoom,
        );

        if (!baseVisible) {
          styleCityLabel(state.element, {
            active,
            syncing: syncingRef.current,
            visible: false,
          });
          continue;
        }

        candidates.push({
          location,
          state,
        });
      }

      candidates.sort((left, right) => {
        const leftActive = left.location === currentSelection;
        const rightActive = right.location === currentSelection;

        if (leftActive !== rightActive) {
          return leftActive ? -1 : 1;
        }

        return right.state.priority - left.state.priority;
      });

      for (const candidate of candidates) {
        const active = candidate.location === currentSelection;
        const point = map.project(candidate.state.center);
        const size = estimateCityBubbleSize(candidate.location, active);
        const collisionRect = {
          left: point.x - size.width / 2 - collisionPadding.x,
          right: point.x + size.width / 2 + collisionPadding.x,
          top: point.y - size.height / 2 - collisionPadding.y,
          bottom: point.y + size.height / 2 + collisionPadding.y,
        };
        const inViewport =
          collisionRect.right >= 0 &&
          collisionRect.left <= mapWidth &&
          collisionRect.bottom >= 0 &&
          collisionRect.top <= mapHeight;
        const collides = visibleRects.some((visibleRect) =>
          rectanglesOverlap(collisionRect, visibleRect),
        );
        const withinBudget = visibleCount < maxVisibleCities;
        const visible = inViewport && withinBudget && !collides;

        styleCityLabel(candidate.state.element, {
          active,
          syncing: syncingRef.current,
          visible,
        });

        if (visible) {
          visibleRects.push(collisionRect);
          visibleCount += 1;
        }
      }

      const secondaryCandidates = secondaryLabelElements
        .filter((state) => zoom >= state.minZoom)
        .sort((left, right) => right.priority - left.priority);

      for (const state of secondaryCandidates) {
        const point = map.project(state.center);
        const size = estimateSecondaryCityLabelSize(state.element.textContent ?? "");
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
        const element = document.createElement("button");
        element.type = "button";
        element.className = "theater-map-city-label";
        element.style.zIndex = "30";
        element.textContent = entry.location.toUpperCase();
        element.setAttribute("aria-label", `Select ${entry.location}`);
        styleCityLabel(element, {
          active: entry.location === currentLocationRef.current,
          syncing: syncingRef.current,
          visible: false,
        });
        element.addEventListener("click", () => {
          if (syncingRef.current) {
            return;
          }

          void handleLocationSelect(entry.location);
        });
        labelElements.set(entry.location, {
          element,
          center: entry.center,
          priority: getCityPriority(entry),
          minZoom: getCityMinZoom(entry),
        });

        markers.push(
          new Marker({
            element,
            anchor: "center",
          })
            .setLngLat(entry.center)
            .addTo(map),
        );
      }

      for (const city of SECONDARY_CITIES) {
        const element = document.createElement("span");
        element.className = "theater-map-secondary-city-label";
        element.style.zIndex = "20";
        element.textContent = city.name;
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
        element.style.setProperty("--theater-dot-color", getTheaterDotColor(theater.chain));
        element.classList.toggle("is-visible", showTheatersRef.current);
        element.setAttribute(
          "aria-label",
          `${getTheaterDisplayName(theater)}, ${theater.address}`,
        );

        const popupContent = document.createElement("div");
        popupContent.className = "theater-map-theater-popup";

        const title = document.createElement("strong");
        title.className = "theater-map-theater-popup-title";
        title.textContent = getTheaterDisplayName(theater);
        popupContent.appendChild(title);

        const link = document.createElement("a");
        link.className = "theater-map-theater-popup-link";
        link.href = theater.location;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = theater.address;
        popupContent.appendChild(link);

        const popup = new Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 14,
          anchor: "top",
          className: "theater-map-theater-popup-shell",
        }).setDOMContent(popupContent);

        element.addEventListener("mouseenter", () => {
          if (!showTheatersRef.current) {
            return;
          }

          popup.setLngLat([theater.lng!, theater.lat!]).addTo(map);
        });
        element.addEventListener("mouseleave", () => {
          popup.remove();
        });
        element.addEventListener("focus", () => {
          if (!showTheatersRef.current) {
            return;
          }

          popup.setLngLat([theater.lng!, theater.lat!]).addTo(map);
        });
        element.addEventListener("blur", () => {
          popup.remove();
        });

        const marker = new Marker({
          element,
          anchor: "center",
        }).setLngLat([theater.lng, theater.lat]);

        if (showTheatersRef.current) {
          marker.addTo(map);
        }

        theaterMarkers.push({
          marker,
          element,
          popup,
        });
      }

      map.on("move", scheduleSyncMarkerVisibility);
      map.on("zoom", scheduleSyncMarkerVisibility);
      map.on("moveend", scheduleSyncMarkerVisibility);
      map.on("zoomend", scheduleSyncMarkerVisibility);
      map.on("resize", scheduleSyncMarkerVisibility);
      scheduleSyncMarkerVisibility();
      fitStartingView({ animate: false });
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

      map.off("move", scheduleSyncMarkerVisibility);
      map.off("zoom", scheduleSyncMarkerVisibility);
      map.off("moveend", scheduleSyncMarkerVisibility);
      map.off("zoomend", scheduleSyncMarkerVisibility);
      map.off("resize", scheduleSyncMarkerVisibility);
      scheduleVisibilitySyncRef.current = null;
      cityMarkersRef.current = [];
      secondaryCityLabelElementsRef.current = [];
      theaterMarkersRef.current = [];
      labelElements.clear();
      cityLabelElementsRef.current = new Map();
      setIsMapLoading(false);
      map.remove();
      mapRef.current = null;
    };
  }, [cityEntries, fitStartingView, handleLocationSelect, theaters]);

  return (
    <div className={["theater-map-panel", className].filter(Boolean).join(" ")}>
      <div className="theater-map-panel-bar">
        <div className="theater-map-current-city">
          <span className="theater-map-current-chip">Current city<strong>{" "}{currentLocation}</strong></span>
          
        </div>

        <div className="theater-map-panel-actions">
          <label className="theater-map-toggle">
            <input
              type="checkbox"
              checked={showTheaters}
              onChange={(event) => {
                setShowTheaters(event.target.checked);
              }}
            />
            <span>Show theaters</span>
          </label>

          <button
            type="button"
            className="theater-map-toolbar-button"
            disabled={cityEntries.length === 0}
            onClick={() => {
              fitStartingView();
            }}
          >
            <LocateFixed size={16} />
            <span>Reset view</span>
          </button>
        </div>
      </div>

      <div className="theater-map-canvas-shell">
        <div className="theater-map-canvas" ref={mapContainerRef} />

        {loadState === "loading" || isMapLoading ? (
          <div className="theater-map-state">
            <LoaderCircle className="theater-map-spinner" size={22} />
            <p>Loading city map...</p>
          </div>
        ) : loadState === "error" ? (
          <div className="theater-map-state theater-map-state--error">
            <p>{loadErrorMessage ?? "Could not load theaters from Supabase."}</p>
          </div>
        ) : null}
      </div>

      <div className="theater-map-search-panel">
        <label className="theater-map-search-field">
          <span className="theater-map-search-label">Search cities</span>
          <div className="theater-map-search-input-shell">
            <Search size={17} />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Search any city in your theater list"
            />
          </div>
        </label>
      </div>
    </div>
  );
}
