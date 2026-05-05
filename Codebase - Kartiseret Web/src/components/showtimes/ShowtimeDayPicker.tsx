import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useDeviceInfo } from "../../device/useDeviceType";
import { getShowtimeDateLabel } from "./showtimeUtils";
import "./ShowtimeDayPicker.css";

type ShowtimeDayPickerProps = {
  dates: readonly string[];
  selectedDate: string | null;
  onSelect: (date: string) => void;
  ariaLabel: string;
  className?: string;
  disabledBeforeDate?: string | null;
  leadingDisabledDayCount?: number;
};

type DayPickerEntry = {
  date: string;
  isDisabled: boolean;
};

const DESKTOP_VISIBLE_DAY_COUNT = 7;
const MOBILE_VISIBLE_DAY_COUNT = 4;
const CENTER_SELECTED_DAY_DELAY_MS = 230;

const weekdayEyebrowFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
});

const monthFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
});

function parseCalendarDate(dateString: string): Date {
  const [year, month, day] = dateString
    .split("-")
    .map((value) => Number.parseInt(value, 10));

  if (!year || !month || !day) {
    return new Date(dateString);
  }

  return new Date(year, month - 1, day);
}

function formatCalendarDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function addCalendarDays(dateString: string, dayOffset: number): string {
  const nextDate = parseCalendarDate(dateString);
  nextDate.setDate(nextDate.getDate() + dayOffset);

  return formatCalendarDate(nextDate);
}

function getDayCardEyebrow(dateString: string): string {
  const label = getShowtimeDateLabel(dateString);

  if (label === "Today" || label === "Tomorrow") {
    return label;
  }

  return weekdayEyebrowFormatter.format(parseCalendarDate(dateString));
}

function getDayCardNumber(dateString: string): string {
  return String(parseCalendarDate(dateString).getDate());
}

function getDayCardMonth(dateString: string): string {
  return monthFormatter.format(parseCalendarDate(dateString));
}

function buildDayPickerEntries(
  dates: readonly string[],
  disabledBeforeDate: string | null,
  leadingDisabledDayCount: number,
): DayPickerEntry[] {
  const entries = dates.map((date) => ({
    date,
    isDisabled: Boolean(disabledBeforeDate && date < disabledBeforeDate),
  }));

  if (!disabledBeforeDate || leadingDisabledDayCount <= 0) {
    return entries;
  }

  const leadingEntries = Array.from({ length: leadingDisabledDayCount }, (
    _,
    index,
  ) => ({
    date: addCalendarDays(disabledBeforeDate, index - leadingDisabledDayCount),
    isDisabled: true,
  }));

  return [...leadingEntries, ...entries];
}

export function ShowtimeDayPicker({
  dates,
  selectedDate,
  onSelect,
  ariaLabel,
  className,
  disabledBeforeDate = null,
  leadingDisabledDayCount,
}: ShowtimeDayPickerProps) {
  const { isMobile } = useDeviceInfo();
  const visibleDayCount = isMobile
    ? MOBILE_VISIBLE_DAY_COUNT
    : DESKTOP_VISIBLE_DAY_COUNT;
  const selectedDayOffset = isMobile ? 1 : Math.floor(visibleDayCount / 2);
  const visibleDayRadius = Math.floor(visibleDayCount / 2);
  const resolvedLeadingDisabledDayCount =
    leadingDisabledDayCount ?? (isMobile ? 1 : visibleDayRadius);
  const entries = useMemo(
    () =>
      buildDayPickerEntries(
        dates,
        disabledBeforeDate,
        resolvedLeadingDisabledDayCount,
      ),
    [dates, disabledBeforeDate, resolvedLeadingDisabledDayCount],
  );
  const selectedIndex = useMemo(() => {
    const candidateIndex = entries.findIndex(
      (entry) => entry.date === selectedDate,
    );

    if (candidateIndex >= 0) {
      return candidateIndex;
    }

    return entries.findIndex((entry) => entry.date === dates[0]);
  }, [dates, entries, selectedDate]);
  const selectedEntry = selectedIndex >= 0 ? entries[selectedIndex] : null;
  const [centeredDate, setCenteredDate] = useState<string | null>(
    selectedEntry?.date ?? dates[0] ?? null,
  );
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const indicatorFrameRef = useRef<number | null>(null);
  const [indicatorStyle, setIndicatorStyle] = useState<{
    centerX: number;
    width: number;
    isVisible: boolean;
  }>({ centerX: 0, width: 0, isVisible: false });

  const centeredIndex = useMemo(() => {
    const candidateIndex = entries.findIndex(
      (entry) => entry.date === centeredDate,
    );

    return candidateIndex >= 0 ? candidateIndex : selectedIndex;
  }, [centeredDate, entries, selectedIndex]);

  const visibleEntries = useMemo(() => {
    if (entries.length === 0 || centeredIndex < 0) {
      return [];
    }

    const maxStartIndex = Math.max(0, entries.length - visibleDayCount);
    const startIndex = Math.max(
      0,
      Math.min(centeredIndex - selectedDayOffset, maxStartIndex),
    );
    const endIndex = Math.min(entries.length, startIndex + visibleDayCount);

    return entries.slice(startIndex, endIndex);
  }, [centeredIndex, entries, selectedDayOffset, visibleDayCount]);

  useEffect(() => {
    if (!selectedEntry) {
      return;
    }
    const selectedDate = selectedEntry.date;

    const isSelectedVisible = visibleEntries.some(
      (entry) => entry.date === selectedDate,
    );

    if (!isSelectedVisible) {
      const frameId = window.requestAnimationFrame(() => {
        setCenteredDate(selectedDate);
      });

      return () => {
        window.cancelAnimationFrame(frameId);
      };
    }

    const timeoutId = window.setTimeout(() => {
      setCenteredDate(selectedDate);
    }, CENTER_SELECTED_DAY_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [selectedEntry, visibleEntries]);

  useEffect(() => {
    if (centeredDate && entries.some((entry) => entry.date === centeredDate)) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      setCenteredDate(selectedEntry?.date ?? dates[0] ?? null);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [centeredDate, dates, entries, selectedEntry]);

  useLayoutEffect(() => {
    const picker = pickerRef.current;
    const selectedButton = selectedEntry
      ? buttonRefs.current.get(selectedEntry.date)
      : null;

    if (!picker || !selectedButton) {
      indicatorFrameRef.current = window.requestAnimationFrame(() => {
        setIndicatorStyle((current) =>
          current.isVisible ? { ...current, isVisible: false } : current);
        indicatorFrameRef.current = null;
      });

      return () => {
        if (indicatorFrameRef.current !== null) {
          window.cancelAnimationFrame(indicatorFrameRef.current);
          indicatorFrameRef.current = null;
        }
      };
    }

    const updateIndicator = () => {
      const pickerRect = picker.getBoundingClientRect();
      const buttonRect = selectedButton.getBoundingClientRect();
      const rawIndicatorWidth = Math.min(48, buttonRect.width * 0.66);
      const indicatorWidth = Math.max(2, Math.round(rawIndicatorWidth / 2) * 2);
      const indicatorCenterX = Math.round(
        buttonRect.left - pickerRect.left + buttonRect.width / 2,
      );

      setIndicatorStyle({
        centerX: indicatorCenterX,
        width: indicatorWidth,
        isVisible: true,
      });
    };

    indicatorFrameRef.current = window.requestAnimationFrame(() => {
      updateIndicator();
      indicatorFrameRef.current = null;
    });

    const resizeObserver = new ResizeObserver(updateIndicator);
    resizeObserver.observe(picker);
    resizeObserver.observe(selectedButton);

    return () => {
      if (indicatorFrameRef.current !== null) {
        window.cancelAnimationFrame(indicatorFrameRef.current);
        indicatorFrameRef.current = null;
      }
      resizeObserver.disconnect();
    };
  }, [selectedEntry, visibleEntries]);

  if (visibleEntries.length === 0) {
    return null;
  }

  const indicatorCssVars = {
    "--showtime-day-indicator-center": `${indicatorStyle.centerX}px`,
    "--showtime-day-indicator-width": `${indicatorStyle.width}px`,
  } as CSSProperties;

  return (
    <div
      className={["showtime-day-picker-shell", className]
        .filter(Boolean)
        .join(" ")}
      aria-label={ariaLabel}
    >
      <div className="showtime-day-picker-scroll">
        <div className="showtime-day-picker" ref={pickerRef}>
          <span
            className={[
              "showtime-day-picker-indicator",
              indicatorStyle.isVisible
                ? "showtime-day-picker-indicator--visible"
                : null,
            ]
              .filter(Boolean)
              .join(" ")}
            style={indicatorCssVars}
            aria-hidden="true"
          />
          {visibleEntries.map((entry) => {
            const isSelected = entry.date === selectedEntry?.date;

            return (
              <button
                key={entry.date}
                ref={(button) => {
                  if (button) {
                    buttonRefs.current.set(entry.date, button);
                    return;
                  }

                  buttonRefs.current.delete(entry.date);
                }}
                type="button"
                className={[
                  "showtime-day-button",
                  isSelected ? "showtime-day-button--selected" : null,
                  entry.isDisabled ? "showtime-day-button--disabled" : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-pressed={isSelected}
                disabled={entry.isDisabled}
                onClick={() => {
                  onSelect(entry.date);
                }}
              >
                <span className="showtime-day-button-eyebrow">
                  {getDayCardEyebrow(entry.date)}
                </span>
                <span className="showtime-day-button-number">
                  {getDayCardNumber(entry.date)}
                </span>
                <span className="showtime-day-button-month">
                  {getDayCardMonth(entry.date)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
