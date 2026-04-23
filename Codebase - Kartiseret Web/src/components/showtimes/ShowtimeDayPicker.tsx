import { useMemo } from "react";
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

  const visibleEntries = useMemo(() => {
    if (entries.length === 0 || selectedIndex < 0) {
      return [];
    }

    const maxStartIndex = Math.max(0, entries.length - visibleDayCount);
    const startIndex = Math.max(
      0,
      Math.min(selectedIndex - selectedDayOffset, maxStartIndex),
    );
    const endIndex = Math.min(entries.length, startIndex + visibleDayCount);

    return entries.slice(startIndex, endIndex);
  }, [entries, selectedDayOffset, selectedIndex, visibleDayCount]);

  if (visibleEntries.length === 0) {
    return null;
  }

  return (
    <div
      className={["showtime-day-picker-shell", className]
        .filter(Boolean)
        .join(" ")}
      aria-label={ariaLabel}
    >
      <div className="showtime-day-picker-scroll">
        <div className="showtime-day-picker">
          {visibleEntries.map((entry) => {
            const isSelected = entry.date === entries[selectedIndex]?.date;

            return (
              <button
                key={entry.date}
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
