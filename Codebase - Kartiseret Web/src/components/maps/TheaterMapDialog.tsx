import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapPin } from "lucide-react";
import { loadCityLocationPicker, preloadCityLocationPicker } from "./loadCityLocationPicker";
import { useUserPreferencesContext } from "../../prefs/useUserPreferences";
import { type AppLocation } from "../../prefs/definitions/locations";
import "./TheaterMapDialog.css";

const OPEN_TRANSITION_MS = 420;
const INLINE_ICON_HANDOFF_LEAD_MS = 80;
const FLY_ICON_FADE_OUT_MS = 140;

type FlightRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type FlyingMapIconState = {
  arrived: boolean;
  rect: FlightRect;
};

const CityLocationPicker = lazy(async () => {
  const module = await loadCityLocationPicker();

  return { default: module.CityLocationPicker };
});

function CityLocationPickerLoading() {
  return (
    <div className="theater-map-panel theater-map-panel--loading" role="status">
      <div className="theater-map-loading-shell">
        <button
          type="button"
          className="theater-map-loading-pin"
          tabIndex={-1}
          aria-hidden="true"
        >
          <MapPin size={20} strokeWidth={2.75} />
        </button>
        <p>Loading city map...</p>
      </div>
    </div>
  );
}

function toFlightRect(rect?: DOMRect | null): FlightRect | null {
  if (!rect) {
    return null;
  }

  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

export function TheaterMapDialog({
  className,
  triggerLabel,
  triggerTabIndex,
}: {
  className?: string;
  triggerLabel?: string;
  triggerTabIndex?: number;
}) {
  const { location, syncing, setLocationPreference, error } =
    useUserPreferencesContext();
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isDialogVisible, setIsDialogVisible] = useState(false);
  const [showMapPinButton, setShowMapPinButton] = useState(false);
  const [flyingMapIcon, setFlyingMapIcon] = useState<FlyingMapIconState | null>(
    null,
  );
  const [mapIconAnchor, setMapIconAnchor] = useState<HTMLButtonElement | null>(
    null,
  );
  const triggerButtonRef = useRef<HTMLButtonElement | null>(null);
  const triggerFlightOriginRef = useRef<HTMLSpanElement | null>(null);
  const pendingFlightOriginRef = useRef<FlightRect | null>(null);
  const openAnimationStartedRef = useRef(false);
  const flightStartFrameRef = useRef<number | null>(null);
  const flightEndFrameRef = useRef<number | null>(null);
  const flightHandoffTimeoutRef = useRef<number | null>(null);
  const flightCleanupTimeoutRef = useRef<number | null>(null);

  const clearPinFlightAnimation = useCallback(() => {
    if (flightStartFrameRef.current !== null) {
      window.cancelAnimationFrame(flightStartFrameRef.current);
      flightStartFrameRef.current = null;
    }

    if (flightEndFrameRef.current !== null) {
      window.cancelAnimationFrame(flightEndFrameRef.current);
      flightEndFrameRef.current = null;
    }

    if (flightHandoffTimeoutRef.current !== null) {
      window.clearTimeout(flightHandoffTimeoutRef.current);
      flightHandoffTimeoutRef.current = null;
    }

    if (flightCleanupTimeoutRef.current !== null) {
      window.clearTimeout(flightCleanupTimeoutRef.current);
      flightCleanupTimeoutRef.current = null;
    }
  }, []);

  const handleLocationPick = useCallback(
    async (nextLocation: AppLocation) => {
      setStatusMessage(null);
      const didSave = await setLocationPreference(nextLocation);

      if (!didSave) {
        return;
      }

      setStatusMessage(`City set to ${nextLocation}.`);
    },
    [setLocationPreference],
  );

  const finishCloseDialog = useCallback(() => {
    clearPinFlightAnimation();
    openAnimationStartedRef.current = false;
    pendingFlightOriginRef.current = null;
    setMapIconAnchor(null);
    setFlyingMapIcon(null);
    setShowMapPinButton(false);
    setIsDialogVisible(false);
    setIsClosing(false);
    setIsOpen(false);
  }, [clearPinFlightAnimation]);

  const handleCloseDialog = useCallback(() => {
    if (!isOpen || isClosing) {
      return;
    }

    clearPinFlightAnimation();
    setIsClosing(true);

    const originRect = toFlightRect(mapIconAnchor?.getBoundingClientRect());
    const targetRect = toFlightRect(
      (
        triggerFlightOriginRef.current ?? triggerButtonRef.current
      )?.getBoundingClientRect(),
    );

    if (!originRect || !targetRect) {
      setShowMapPinButton(false);
      setIsDialogVisible(false);
      flightCleanupTimeoutRef.current = window.setTimeout(() => {
        finishCloseDialog();
      }, 320);
      return;
    }

    setFlyingMapIcon({
      arrived: true,
      rect: originRect,
    });

    flightStartFrameRef.current = window.requestAnimationFrame(() => {
      setIsDialogVisible(false);
      setShowMapPinButton(false);
      flightEndFrameRef.current = window.requestAnimationFrame(() => {
        setFlyingMapIcon({
          arrived: false,
          rect: targetRect,
        });
      });
    });

    flightCleanupTimeoutRef.current = window.setTimeout(() => {
      finishCloseDialog();
    }, OPEN_TRANSITION_MS);
  }, [
    clearPinFlightAnimation,
    finishCloseDialog,
    isClosing,
    isOpen,
    mapIconAnchor,
  ]);

  useLayoutEffect(() => {
    if (
      !isOpen ||
      isClosing ||
      !mapIconAnchor ||
      openAnimationStartedRef.current
    ) {
      return;
    }

    openAnimationStartedRef.current = true;

    const targetRect = toFlightRect(mapIconAnchor.getBoundingClientRect());
    const originRect = pendingFlightOriginRef.current;

    if (!targetRect) {
      flightStartFrameRef.current = window.requestAnimationFrame(() => {
        setIsDialogVisible(true);
        setShowMapPinButton(true);
        pendingFlightOriginRef.current = null;
      });
      return;
    }

    if (!originRect) {
      flightStartFrameRef.current = window.requestAnimationFrame(() => {
        setIsDialogVisible(true);
        setShowMapPinButton(true);
        pendingFlightOriginRef.current = null;
      });
      return;
    }

    setFlyingMapIcon({
      arrived: false,
      rect: originRect,
    });

    flightStartFrameRef.current = window.requestAnimationFrame(() => {
      setIsDialogVisible(true);
      flightEndFrameRef.current = window.requestAnimationFrame(() => {
        const latestTargetRect =
          toFlightRect(mapIconAnchor.getBoundingClientRect()) ?? targetRect;

        setFlyingMapIcon({
          arrived: true,
          rect: latestTargetRect,
        });
      });
    });

    flightHandoffTimeoutRef.current = window.setTimeout(
      () => {
        setShowMapPinButton(true);
      },
      Math.max(0, OPEN_TRANSITION_MS - INLINE_ICON_HANDOFF_LEAD_MS),
    );

    flightCleanupTimeoutRef.current = window.setTimeout(() => {
      setFlyingMapIcon(null);
      pendingFlightOriginRef.current = null;
    }, OPEN_TRANSITION_MS + FLY_ICON_FADE_OUT_MS);
  }, [clearPinFlightAnimation, isClosing, isOpen, mapIconAnchor]);

  useEffect(() => clearPinFlightAnimation, [clearPinFlightAnimation]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        handleCloseDialog();
      }
    }

    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [handleCloseDialog, isOpen]);

  const dialog = isOpen ? (
    <>
      <div
        className={`theater-map-backdrop${isDialogVisible ? " is-visible" : ""}`}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            handleCloseDialog();
          }
        }}
      >
        <div
          className={`theater-map-dialog${isDialogVisible ? " is-visible" : ""}`}
          role="dialog"
          aria-modal="true"
        >
          <Suspense fallback={<CityLocationPickerLoading />}>
            <CityLocationPicker
              currentLocation={location}
              feedbackMessage={error ?? statusMessage}
              mapPinAnchorRef={setMapIconAnchor}
              onPickLocation={handleLocationPick}
              onClose={handleCloseDialog}
              showMapPinButton={showMapPinButton}
              syncing={syncing}
            />
          </Suspense>
        </div>
      </div>
      {flyingMapIcon ? (
        <div
          className={`theater-map-fly-icon${
            flyingMapIcon.arrived ? " is-arrived" : ""
          }${showMapPinButton ? " is-handoff" : ""}`}
          style={{
            height: `${flyingMapIcon.rect.height}px`,
            left: `${flyingMapIcon.rect.left}px`,
            top: `${flyingMapIcon.rect.top}px`,
            width: `${flyingMapIcon.rect.width}px`,
          }}
          aria-hidden="true"
        >
          <MapPin size={20} strokeWidth={2.75} />
        </div>
      ) : null}
    </>
  ) : null;

  return (
    <div className="theater-map-trigger-shell">
      <button
        ref={triggerButtonRef}
        type="button"
        className={[
          triggerLabel
            ? "theater-map-trigger theater-map-trigger--labeled"
            : "location-menu-trigger theater-map-trigger",
          className,
          isOpen && !isClosing ? "is-open" : null,
        ]
          .filter(Boolean)
          .join(" ")}
        tabIndex={triggerTabIndex}
        aria-haspopup="dialog"
        aria-expanded={isOpen && !isClosing}
        aria-label={`Open city selector. Current city: ${location}`}
        onFocus={preloadCityLocationPicker}
        onPointerDown={preloadCityLocationPicker}
        onPointerEnter={preloadCityLocationPicker}
        onClick={() => {
          preloadCityLocationPicker();
          clearPinFlightAnimation();
          openAnimationStartedRef.current = false;
          pendingFlightOriginRef.current = toFlightRect(
            (
              triggerFlightOriginRef.current ?? triggerButtonRef.current
            )?.getBoundingClientRect(),
          );
          setMapIconAnchor(null);
          setFlyingMapIcon(null);
          setShowMapPinButton(false);
          setIsClosing(false);
          setIsDialogVisible(false);
          setStatusMessage(null);
          setIsOpen(true);
        }}
      >
        {triggerLabel ? (
          <>
            <span
              ref={triggerFlightOriginRef}
              className="theater-map-trigger-icon"
            >
              <MapPin
                size={20}
                strokeWidth={2.75}
                className="app-accent-icon"
              />
            </span>
            <span className="theater-map-trigger-label">{triggerLabel}</span>
          </>
        ) : (
          <span
            ref={triggerFlightOriginRef}
            className="theater-map-trigger-icon"
          >
            <MapPin size={20} strokeWidth={2.75} className="app-accent-icon" />
          </span>
        )}
      </button>
      {dialog ? createPortal(dialog, document.body) : null}
    </div>
  );
}
