import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { useRatingSourcesContext } from "../prefs/ratingSourcesStore";
import { type AppLocation } from "../prefs/locations";

export function LocationMenu() {
  const { location, allLocations, syncing, setLocationPreference, error } =
    useRatingSourcesContext();
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleOutsidePointerDown(event: PointerEvent) {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (!menuRef.current?.contains(target)) {
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    window.addEventListener("pointerdown", handleOutsidePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("pointerdown", handleOutsidePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  async function handleLocationPick(nextLocation: AppLocation) {
    setStatusMessage(null);
    setIsSaving(true);
    const didSave = await setLocationPreference(nextLocation);
    setIsSaving(false);

    if (!didSave) {
      return;
    }

    setStatusMessage(`Location set to ${nextLocation}.`);
  }

  return (
    <div className="location-menu" ref={menuRef}>
      <button
        type="button"
        className={`location-menu-trigger${isOpen ? " is-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`Location: ${location}`}
        onClick={() => {
          setIsOpen((open) => !open);
        }}
      >
        <MapPin size={20} strokeWidth={2.75} color="#a66ae3"/>
      </button>

      {isOpen ? (
        <div className="location-menu-panel" role="menu" aria-label="Location chooser">
          <p className="location-menu-title">Location</p>
          <p className="location-menu-subtitle">{location}</p>

          <div className="location-menu-options">
            {allLocations.map((entry) => (
              <button
                key={entry}
                type="button"
                className={`location-menu-option${
                  location === entry ? " is-active" : ""
                }`}
                onClick={() => {
                  void handleLocationPick(entry);
                }}
                disabled={syncing || isSaving}
              >
                {entry}
              </button>
            ))}
          </div>

          {statusMessage ? (
            <p className="location-menu-feedback">{statusMessage}</p>
          ) : null}
          {error ? (
            <p className="location-menu-feedback location-menu-feedback--error">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
