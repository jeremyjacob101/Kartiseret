import { useEffect, type PropsWithChildren } from "react";
import {
  applyBootstrappedDeviceTypeToDocument,
  DeviceTypeContext,
  getDeviceInfo,
} from "./useDeviceType";

export function DeviceTypeProvider({ children }: PropsWithChildren) {
  useEffect(() => {
    applyBootstrappedDeviceTypeToDocument();
  }, []);

  return (
    <DeviceTypeContext.Provider value={getDeviceInfo()}>
      {children}
    </DeviceTypeContext.Provider>
  );
}
