import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCATION_DISABLED_MESSAGE, TheaterMapActionControl, TheaterMapAttributionControl, TheaterMapCloseControl } from "../src/components/maps/theaterMapControls";

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("theater map attribution control", () => {
  it("starts open, exposes provider links, toggles, and closes from outside input", () => {
    const control = new TheaterMapAttributionControl();
    const container = control.onAdd();
    document.body.append(container);
    const button = container.querySelector("button");

    expect(container).toHaveClass("is-open");
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(
      container.querySelector('a[href="https://carto.com/"]'),
    ).toHaveTextContent("CARTO");
    expect(
      container.querySelector('a[href="https://www.openstreetmap.org/"]'),
    ).toHaveTextContent("OpenStreetMap");

    button?.click();
    expect(container).not.toHaveClass("is-open");
    button?.click();
    expect(container).toHaveClass("is-open");
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(container).not.toHaveClass("is-open");
  });

  it("auto-closes after five seconds and cleans up its listeners", () => {
    vi.useFakeTimers();
    const control = new TheaterMapAttributionControl();
    const container = control.onAdd();
    document.body.append(container);

    vi.advanceTimersByTime(4_999);
    expect(container).toHaveClass("is-open");
    vi.advanceTimersByTime(1);
    expect(container).not.toHaveClass("is-open");

    control.onRemove();
    expect(container.isConnected).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
});

describe("theater map close control", () => {
  it("calls the close callback and removes its DOM node", () => {
    const onClose = vi.fn();
    const control = new TheaterMapCloseControl(onClose);
    const container = control.onAdd();
    document.body.append(container);

    container.querySelector<HTMLButtonElement>("button")?.click();
    expect(onClose).toHaveBeenCalledOnce();
    control.onRemove();
    expect(container.isConnected).toBe(false);
  });
});

describe("theater map action control", () => {
  it("switches between overview and selected-city actions", () => {
    const onResetToOverview = vi.fn();
    const onZoomToSelectedCity = vi.fn();
    const control = new TheaterMapActionControl({
      blockedLocateMessage: null,
      onLocate: vi.fn(),
      onResetToOverview,
      onZoomToSelectedCity,
      selectedLocationLabel: "Haifa",
      showMapPinButton: true,
    });
    const container = control.onAdd();
    document.body.append(container);
    const viewButton = container.querySelector<HTMLButtonElement>(
      ".theater-map-action-button--view",
    );

    expect(viewButton).toHaveAttribute("aria-label", "Return to full map view");
    viewButton?.click();
    expect(onResetToOverview).toHaveBeenCalledOnce();

    control.setOverviewState(true);
    expect(viewButton).toHaveAttribute("aria-label", "Zoom to Haifa");
    viewButton?.click();
    expect(onZoomToSelectedCity).toHaveBeenCalledOnce();

    control.setSelectedLocation("   ");
    expect(viewButton).toHaveAttribute("aria-label", "Zoom to selected city");
  });

  it("supports locate, pending, blocked, and hidden states without losing the anchor", () => {
    const onLocate = vi.fn();
    const onAnchorChange = vi.fn();
    const control = new TheaterMapActionControl({
      blockedLocateMessage: null,
      onLocate,
      onMapPinAnchorChange: onAnchorChange,
      onResetToOverview: vi.fn(),
      onZoomToSelectedCity: vi.fn(),
      selectedLocationLabel: "Jerusalem",
      showMapPinButton: true,
    });
    const container = control.onAdd();
    document.body.append(container);
    const mapPinButton = container.querySelector<HTMLButtonElement>(
      ".theater-map-action-button--locate",
    );
    const tooltip = container.querySelector<HTMLDivElement>(
      ".theater-map-action-tooltip",
    );

    expect(onAnchorChange).toHaveBeenLastCalledWith(mapPinButton);
    expect(mapPinButton).toHaveAttribute(
      "aria-label",
      "Find nearest city to my location",
    );
    mapPinButton?.click();
    expect(onLocate).toHaveBeenCalledOnce();

    control.setLocatePending(true);
    expect(mapPinButton).toHaveAttribute("aria-busy", "true");
    expect(mapPinButton).toHaveAttribute("aria-disabled", "true");
    mapPinButton?.click();
    expect(onLocate).toHaveBeenCalledOnce();

    control.setLocateBlocked("Location permission denied.");
    expect(tooltip).toHaveTextContent("Location permission denied.");
    mapPinButton?.focus();
    expect(tooltip).toHaveClass("is-visible");
    mapPinButton?.blur();
    expect(tooltip).not.toHaveClass("is-visible");

    control.setMapPinVisible(false);
    expect(mapPinButton).toHaveAttribute("aria-hidden", "true");
    expect(mapPinButton).toHaveAttribute("tabindex", "-1");
    expect(mapPinButton).toHaveAttribute("aria-disabled", "true");

    control.onRemove();
    expect(onAnchorChange).toHaveBeenLastCalledWith(null);
  });

  it("uses the standard disabled-location message for blocked tooltips", () => {
    const control = new TheaterMapActionControl({
      blockedLocateMessage: LOCATION_DISABLED_MESSAGE,
      onLocate: vi.fn(),
      onResetToOverview: vi.fn(),
      onZoomToSelectedCity: vi.fn(),
      selectedLocationLabel: "Jerusalem",
      showMapPinButton: true,
    });
    const container = control.onAdd();
    const mapPinButton = container.querySelector<HTMLButtonElement>(
      ".theater-map-action-button--locate",
    );

    expect(mapPinButton).toHaveAttribute("title", "");
    expect(
      container.querySelector(".theater-map-action-tooltip"),
    ).toHaveTextContent(LOCATION_DISABLED_MESSAGE);
  });
});
