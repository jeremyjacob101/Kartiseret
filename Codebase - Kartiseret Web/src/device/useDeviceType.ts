import { create } from "zustand";

export type DeviceType = "mobile" | "desktop";

export type DeviceInfo = {
  deviceType: DeviceType;
  isMobile: boolean;
  isDesktop: boolean;
};

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    mobile?: boolean;
  };
};

const MOBILE_USER_AGENT_PATTERN =
  /Android|webOS|iPhone|iPod|iPad|BlackBerry|IEMobile|Opera Mini/i;
const MOBILE_VIEWPORT_QUERY = "(max-width: 699px)";

function buildDeviceInfo(deviceType: DeviceType): DeviceInfo {
  return {
    deviceType,
    isMobile: deviceType === "mobile",
    isDesktop: deviceType === "desktop",
  };
}

function detectDeviceType(): DeviceType {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "desktop";
  }

  const { userAgent = "", platform = "", maxTouchPoints = 0 } = navigator;
  const userAgentData = (navigator as NavigatorWithUserAgentData).userAgentData;

  if (userAgentData?.mobile === true) {
    return "mobile";
  }

  if (/iPad/i.test(userAgent)) {
    return "mobile";
  }

  if (platform === "MacIntel" && maxTouchPoints > 1) {
    return "mobile";
  }

  if (MOBILE_USER_AGENT_PATTERN.test(userAgent)) {
    return "mobile";
  }

  if (window.matchMedia(MOBILE_VIEWPORT_QUERY).matches) {
    return "mobile";
  }

  return "desktop";
}

function applyDeviceTypeToDocument(deviceType: DeviceType): void {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.deviceType = deviceType;
}

const bootstrappedDeviceInfo = buildDeviceInfo(detectDeviceType());

applyDeviceTypeToDocument(bootstrappedDeviceInfo.deviceType);

export const useDeviceStore = create<DeviceInfo>()(
  () => bootstrappedDeviceInfo,
);

let mobileViewportMediaQuery: MediaQueryList | null = null;

function synchronizeDeviceType(): void {
  const nextDeviceInfo = buildDeviceInfo(detectDeviceType());

  if (nextDeviceInfo.deviceType === useDeviceStore.getState().deviceType) {
    return;
  }

  applyDeviceTypeToDocument(nextDeviceInfo.deviceType);
  useDeviceStore.setState(nextDeviceInfo);
}

function initializeDeviceStore(): void {
  if (typeof window === "undefined" || mobileViewportMediaQuery) {
    return;
  }

  mobileViewportMediaQuery = window.matchMedia(MOBILE_VIEWPORT_QUERY);
  mobileViewportMediaQuery.addEventListener("change", synchronizeDeviceType);
}

initializeDeviceStore();

export function applyBootstrappedDeviceTypeToDocument(): void {
  applyDeviceTypeToDocument(useDeviceStore.getState().deviceType);
}

export function getDeviceType(): DeviceType {
  return useDeviceStore.getState().deviceType;
}

export function getDeviceInfo(): DeviceInfo {
  return useDeviceStore.getState();
}

export function useDeviceInfo(): DeviceInfo {
  return useDeviceStore();
}

export function useDeviceType(): DeviceType {
  return useDeviceStore((state) => state.deviceType);
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    mobileViewportMediaQuery?.removeEventListener(
      "change",
      synchronizeDeviceType,
    );
    mobileViewportMediaQuery = null;
  });
}
