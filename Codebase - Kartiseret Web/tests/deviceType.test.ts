import { afterEach, describe, expect, it, vi } from "vitest";

type DeviceModule = typeof import("../src/device/useDeviceType");

let mediaChangeListener: ((event: MediaQueryListEvent) => void) | undefined;
let currentViewportMatches = false;

async function loadDeviceModule(options: {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentDataMobile?: boolean;
  viewportMatches?: boolean;
}): Promise<DeviceModule> {
  vi.resetModules();
  mediaChangeListener = undefined;
  currentViewportMatches = options.viewportMatches ?? false;
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: options.userAgent ?? "",
  });
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: options.platform ?? "",
  });
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: options.maxTouchPoints ?? 0,
  });
  Object.defineProperty(navigator, "userAgentData", {
    configurable: true,
    value:
      options.userAgentDataMobile === undefined
        ? undefined
        : { mobile: options.userAgentDataMobile },
  });

  vi.mocked(window.matchMedia).mockImplementation((query) => {
    const mediaQuery = {
      matches: currentViewportMatches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn((_type: string, listener: EventListener) => {
        mediaChangeListener = listener as unknown as (
          event: MediaQueryListEvent,
        ) => void;
      }),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;
    return mediaQuery;
  });

  return import("../src/device/useDeviceType");
}

afterEach(() => {
  delete (navigator as Navigator & { userAgentData?: unknown }).userAgentData;
  document.documentElement.dataset.deviceType = "";
  vi.restoreAllMocks();
});

describe("device type detection and synchronization", () => {
  it.each([
    [{}, "desktop"],
    [{ userAgentDataMobile: true }, "mobile"],
    [{ userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)" }, "mobile"],
    [{ platform: "MacIntel", maxTouchPoints: 5 }, "mobile"],
    [{ userAgent: "Mozilla/5.0 (Linux; Android 14)" }, "mobile"],
    [{ userAgent: "Mozilla/5.0", viewportMatches: true }, "mobile"],
  ] as const)("detects %s as %s", async (options, expected) => {
    const module = await loadDeviceModule(options);

    expect(module.getDeviceType()).toBe(expected);
    expect(module.getDeviceInfo()).toEqual({
      deviceType: expected,
      isMobile: expected === "mobile",
      isDesktop: expected === "desktop",
    });
    expect(document.documentElement.dataset.deviceType).toBe(expected);
  });

  it("updates the store and document when the viewport media query changes", async () => {
    const module = await loadDeviceModule({ viewportMatches: false });
    expect(module.getDeviceType()).toBe("desktop");

    currentViewportMatches = true;
    mediaChangeListener?.({ matches: true } as MediaQueryListEvent);

    expect(module.getDeviceType()).toBe("mobile");
    expect(module.useDeviceStore.getState().isMobile).toBe(true);
    expect(document.documentElement.dataset.deviceType).toBe("mobile");

    currentViewportMatches = false;
    mediaChangeListener?.({ matches: false } as MediaQueryListEvent);
    expect(module.getDeviceType()).toBe("desktop");
    expect(module.useDeviceStore.getState().isDesktop).toBe(true);
  });

  it("does not publish a redundant state update when detection is unchanged", async () => {
    const module = await loadDeviceModule({});
    const listener = vi.fn();
    const unsubscribe = module.useDeviceStore.subscribe(listener);

    mediaChangeListener?.({ matches: false } as MediaQueryListEvent);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("can re-apply the bootstrapped attribute after another script changes it", async () => {
    const module = await loadDeviceModule({});
    document.documentElement.dataset.deviceType = "corrupted";

    module.applyBootstrappedDeviceTypeToDocument();

    expect(document.documentElement.dataset.deviceType).toBe("desktop");
  });
});
