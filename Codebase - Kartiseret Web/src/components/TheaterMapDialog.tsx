import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MapPin } from "lucide-react";
import { CityLocationPicker } from "./CityLocationPicker";
import { useRatingSourcesContext } from "../prefs/ratingSourcesStore";
import { type AppLocation } from "../prefs/locations";

export function TheaterMapDialog() {
  const { location, syncing, setLocationPreference, error } =
    useRatingSourcesContext();
  const [isOpen, setIsOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

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

  const handleCloseDialog = useCallback(() => {
    setIsOpen(false);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  const dialog = isOpen ? (
    <div
      className="theater-map-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          handleCloseDialog();
        }
      }}
    >
      <div className="theater-map-dialog" role="dialog" aria-modal="true">
        <CityLocationPicker
          currentLocation={location}
          feedbackMessage={statusMessage ?? error}
          onPickLocation={handleLocationPick}
          onClose={handleCloseDialog}
          syncing={syncing}
        />
      </div>
    </div>
  ) : null;

  return (
    <div className="theater-map-trigger-shell">
      <button
        type="button"
        className={`location-menu-trigger theater-map-trigger${
          isOpen ? " is-open" : ""
        }`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={`Open city selector. Current city: ${location}`}
        onClick={() => {
          setStatusMessage(null);
          setIsOpen(true);
        }}
      >
        <MapPin size={20} strokeWidth={2.75} color="#a66ae3" />
      </button>
      {dialog ? createPortal(dialog, document.body) : null}
    </div>
  );
}
