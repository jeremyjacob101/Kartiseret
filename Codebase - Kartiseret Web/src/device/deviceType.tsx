import { useEffect, useState, type PropsWithChildren } from "react";
import { applyDeviceTypeToDocument, DeviceTypeContext, getDeviceInfo, MOBILE_VIEWPORT_MEDIA_QUERY } from "./useDeviceType";

export function DeviceTypeProvider({ children }: PropsWithChildren) {
  const [deviceInfo, setDeviceInfo] = useState(getDeviceInfo);

  useEffect(() => {
    const viewportQuery = window.matchMedia(MOBILE_VIEWPORT_MEDIA_QUERY);
    const syncDeviceInfo = () => {
      const nextDeviceInfo = getDeviceInfo();
      applyDeviceTypeToDocument(nextDeviceInfo.deviceType);
      setDeviceInfo((currentDeviceInfo) =>
        currentDeviceInfo.deviceType === nextDeviceInfo.deviceType
          ? currentDeviceInfo
          : nextDeviceInfo);
    };

    syncDeviceInfo();
    viewportQuery.addEventListener("change", syncDeviceInfo);

    return () => {
      viewportQuery.removeEventListener("change", syncDeviceInfo);
    };
  }, []);

  return (
    <DeviceTypeContext.Provider value={deviceInfo}>
      {children}
    </DeviceTypeContext.Provider>
  );
}
