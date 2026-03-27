import { createContext, useContext } from "react";

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

export const DeviceTypeContext = createContext<DeviceInfo | null>(null);

export function applyBootstrappedDeviceTypeToDocument(): void {
  applyDeviceTypeToDocument(bootstrappedDeviceInfo.deviceType);
}

export function getDeviceType(): DeviceType {
  return bootstrappedDeviceInfo.deviceType;
}

export function getDeviceInfo(): DeviceInfo {
  return bootstrappedDeviceInfo;
}

export function useDeviceInfo(): DeviceInfo {
  return useContext(DeviceTypeContext) ?? bootstrappedDeviceInfo;
}

export function useDeviceType(): DeviceType {
  return useDeviceInfo().deviceType;
}
