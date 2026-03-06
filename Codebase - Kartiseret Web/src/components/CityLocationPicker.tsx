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
  "Ayalon": 9.5,
  "Kfar Saba" : 9.5,
};
const PRIMARY_CITY_COLLISION_PADDING = { x: 18, y: 14 };
const CITY_LABEL_NORTH_OFFSET = 0.00115;
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
  { name: "Ramat Gan", center: [34.8248, 32.0706], minZoom: 9.85, priority: 66 },
  { name: "Bnei Brak", center: [34.8334, 32.0836], minZoom: 10.1, priority: 50 },
  { name: "Lod", center: [34.8881, 31.951], minZoom: 9.85, priority: 58 },
  { name: "Ramla", center: [34.8675, 31.9316], minZoom: 9.95, priority: 54 },
  { name: "Yavne", center: [34.7386, 31.8781], minZoom: 10.05, priority: 46 },
  { name: "Ness Ziona", center: [34.7987, 31.9293], minZoom: 9.1, priority: 42 },
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
  labelCenter: [number, number];
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
        labelCenter: [center[0], center[1] + CITY_LABEL_NORTH_OFFSET],
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
  element.setAttribute("aria-hidden", String(!options.visible));
  element.tabIndex = options.visible ? 0 : -1;
  element.style.opacity = options.visible ? "1" : "0";
  element.style.visibility = options.visible ? "visible" : "hidden";
  element.style.pointerEvents =
    options.visible && !options.syncing ? "auto" : "none";
}

function styleSecondaryCityLabel(
  element: HTMLSpanElement,
  visible: boolean,
) {
  element.classList.toggle("is-hidden", !visible);
  element.setAttribute("aria-hidden", String(!visible));
  element.style.opacity = visible ? "1" : "0";
  element.style.visibility = visible ? "visible" : "hidden";
}

function styleTheaterDot(element: HTMLButtonElement, visible: boolean) {
  element.classList.toggle("is-visible", visible);
  element.setAttribute("aria-hidden", String(!visible));
  element.tabIndex = visible ? 0 : -1;
  element.style.opacity = visible ? "0.95" : "0";
  element.style.visibility = visible ? "visible" : "hidden";
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

function getPrimaryLayerLabel(zoom: number) {
  if (zoom < 7) {
    return "Layer: Jerusalem only";
  }

  if (zoom < 7.5) {
    return "Layer: 7.0";
  }

  if (zoom < 8) {
    return "Layer: 7.5";
  }

  if (zoom < 8.5) {
    return "Layer: 8.0";
  }

  if (zoom < 9) {
    return "Layer: 8.5";
  }

  if (zoom < 10) {
    return "Layer: 9.0";
  }

  return "Layer: 10+";
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
  const [zoomLevel, setZoomLevel] = useState(6.25);
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
      setZoomLevel((previousZoom) =>
        Math.abs(previousZoom - zoom) >= 0.01 ? zoom : previousZoom,
      );
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
      const visiblePrimaryCities = new Set<AppLocation>();
      let visibleSecondaryCount = 0;
 
      for (const [location, state] of labelElements) {
        const active = location === currentSelection;
        const visible = zoom >= state.minZoom;

        styleCityLabel(state.element, {
          active,
          syncing: syncingRef.current,
          visible,
        });

        if (!visible) {
          continue;
        }

        visiblePrimaryCities.add(location);

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

      for (const theaterMarker of theaterMarkers) {
        const visible = showTheatersRef.current;

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
          center: entry.labelCenter,
          priority: getCityPriority(entry),
          minZoom: getCityMinZoom(entry),
        });
        element.dataset.city = entry.location;
        element.dataset.minZoom = String(getCityMinZoom(entry));

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
        element.style.setProperty("--theater-dot-color", getTheaterDotColor(theater.chain));
        element.setAttribute(
          "aria-label",
          `${getTheaterDisplayName(theater)}, ${theater.address}`,
        );
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
        element.addEventListener("click", () => {
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
        <div className="theater-map-zoom-chip" aria-live="polite">
          <strong>{`Zoom ${zoomLevel.toFixed(2)}`}</strong>
          <span>{getPrimaryLayerLabel(zoomLevel)}</span>
        </div>

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
