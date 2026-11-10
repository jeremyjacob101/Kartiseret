import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getCinemaDayDate, SHOWTIME_TIME_ZONE } from "@kartiseret/contracts/showtime-day";
import { setAppRenderInstant } from "../data/movieCatalog";

export type PublicRenderClock = {
  cinemaDate: string;
};

const PublicRenderClockContext = createContext<PublicRenderClock | null>(null);

function parseInstant(value: string | Date | undefined): Date {
  const parsed =
    value instanceof Date ? new Date(value) : new Date(value ?? NaN);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

export function PublicRenderClockProvider({
  initialInstant,
  children,
}: {
  initialInstant?: string | Date;
  children: ReactNode;
}) {
  const [instant] = useState(() => parseInstant(initialInstant));
  const [cinemaDate, setCinemaDate] = useState(() =>
    getCinemaDayDate(instant, SHOWTIME_TIME_ZONE));

  useEffect(() => {
    const refresh = () => {
      const currentInstant = new Date();
      setAppRenderInstant(currentInstant);
      const currentCinemaDate = getCinemaDayDate(
        currentInstant,
        SHOWTIME_TIME_ZONE,
      );
      setCinemaDate((current) =>
        current === currentCinemaDate ? current : currentCinemaDate);
    };
    refresh();
    const interval = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const value = useMemo(() => ({ cinemaDate }), [cinemaDate]);

  return (
    <PublicRenderClockContext.Provider value={value}>
      {children}
    </PublicRenderClockContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePublicRenderClock(): PublicRenderClock {
  const clock = useContext(PublicRenderClockContext);
  if (clock) return clock;
  const instant = new Date();
  return {
    cinemaDate: getCinemaDayDate(instant, SHOWTIME_TIME_ZONE),
  };
}
