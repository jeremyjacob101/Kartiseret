import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, List, Search } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { Map as MapLibreMap, Marker, NavigationControl, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { loadTheaters, type Theater } from "../../data/theaters";
import { type AppLocation } from "../../prefs/definitions/locations";
import { INITIAL_MAP_ZOOM, MAP_MAX_ZOOM, MAP_STYLE_URL, PRIMARY_CITY_COLLISION_PADDING, SECONDARY_CITIES, SELECTED_CITY_Z_INDEX, SINGLE_CITY_FOCUS_ZOOM, THEATER_DOT_COLORS, THEATER_MARKER_Z_INDEX, THEATER_POPUP_OFFSET, buildBounds, buildCityEntries, buildCityRevealConfig, chooseTheaterPopupAnchor, cityMatchesSearchQuery, configureBaseLabels, estimateCityBubbleSize, estimateSecondaryCityLabelSize, getCityLabelOpacity, getCityMarkerZIndex, getCityPriority, getFitPadding, getGeolocationErrorMessage, getInitialMapCenter, getMaxVisibleSecondaryCities, getNearestCityLocation, getSearchCityMarkerZIndex, getSecondaryCityCollisionPadding, getStartBounds, getTheaterPopupMaxWidth, isCityLabelRevealed, isMapAtStartingView, normalizeCitySearchQuery, normalizeTheaterChain, rectanglesOverlap, styleCityLabel, styleSecondaryCityLabel, styleTheaterDot, type CityMarkerState, type SecondaryCityMarkerState, type TheaterMarkerState } from "./cityLocationMapUtils";

const THEATER_MARKER_ICON = renderToStaticMarkup(
  <Clapperboard size={16} strokeWidth={2.5} />,
);
import { LOCATION_DISABLED_MESSAGE, LOCATION_UNSUPPORTED_MESSAGE, TheaterMapActionControl, TheaterMapAttributionControl, TheaterMapCloseControl } from "./theaterMapControls";
import "./CityLocationPicker.layout.css";
import "./CityLocationPicker.markers.css";
import "./CityLocationPicker.controls.css";

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
