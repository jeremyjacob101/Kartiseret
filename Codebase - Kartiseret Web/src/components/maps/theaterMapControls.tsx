import { Ban, Info, Locate, LocateFixed, MapPin, X } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { type IControl } from "maplibre-gl";

export const LOCATION_DISABLED_MESSAGE =
  "Location services are disabled for this site.";
export const LOCATION_UNSUPPORTED_MESSAGE =
  "Location services are not available in this browser.";

const OVERVIEW_CONTROL_ICON = renderToStaticMarkup(
  <Locate size={18} strokeWidth={2.5} />,
);
const FOCUS_SELECTED_CITY_CONTROL_ICON = renderToStaticMarkup(
  <LocateFixed size={18} strokeWidth={2.5} />,
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

export class TheaterMapAttributionControl implements IControl {
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

export class TheaterMapCloseControl implements IControl {
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

export class TheaterMapActionControl implements IControl {
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
