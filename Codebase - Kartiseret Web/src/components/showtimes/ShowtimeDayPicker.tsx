import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { getShowtimeDateLabel } from "./showtimeUtils";
import "./ShowtimeDayPicker.css";

type ShowtimeDayPickerProps = {
  dates: readonly string[];
  selectedDate: string | null;
  onSelect: (date: string) => void;
  onPreviewDateChange?: (date: string) => void;
  ariaLabel: string;
  className?: string;
  disabledBeforeDate?: string | null;
  trailingPlaceholderCount?: number;
};

type DayPickerEntry = {
  date: string;
  isDisabled: boolean;
};

type PointerDragState = {
  pointerId: number;
  startClientX: number;
  startScrollLeft: number;
  lastClientX: number;
  lastTime: number;
  velocity: number;
  didDrag: boolean;
};

const SCROLL_SETTLE_DELAY_MS = 140;
const TOUCH_SCROLL_SETTLE_DELAY_MS = 240;
const POINTER_DRAG_THRESHOLD_PX = 5;
const POINTER_RELEASE_PROJECTION_FRICTION = 0.006;
const POINTER_VELOCITY_STALE_AFTER_MS = 80;
const LEADING_GHOST_DAY_COUNT = 5;

const weekdayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
});

const monthFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
});

const accessibleDateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
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

function buildDayPickerEntries(
  dates: readonly string[],
  disabledBeforeDate: string | null,
): DayPickerEntry[] {
  return dates
    .filter((date) => !disabledBeforeDate || date >= disabledBeforeDate)
    .map((date) => ({ date, isDisabled: false }));
}

function getDayNumber(dateString: string): string {
  return String(parseCalendarDate(dateString).getDate());
}

function getDayWeekday(dateString: string): string {
  return weekdayFormatter.format(parseCalendarDate(dateString));
}

function getDayMonth(dateString: string): string {
  return monthFormatter.format(parseCalendarDate(dateString));
}

function getDayAriaLabel(dateString: string): string {
  const relativeLabel = getShowtimeDateLabel(dateString);
  const calendarLabel = accessibleDateFormatter.format(
    parseCalendarDate(dateString),
  );

  return calendarLabel.startsWith(relativeLabel)
    ? calendarLabel
    : `${relativeLabel}, ${calendarLabel}`;
}

function EdgeGhostDay({ date, index }: { date: string; index: number }) {
  return (
    <div
      className={`showtime-day-button showtime-day-button--disabled showtime-day-button--edge-ghost showtime-day-button--edge-ghost-before showtime-day-button--edge-ghost-${index}`}
      style={{ "--showtime-day-ghost-index": index } as CSSProperties}
      aria-hidden="true"
    >
      <span className="showtime-day-button-tick showtime-day-button-tick--top" />
      <span className="showtime-day-button-eyebrow">{getDayWeekday(date)}</span>
      <span className="showtime-day-button-number">{getDayNumber(date)}</span>
    </div>
  );
}

function TrailingPlaceholderDay({ date }: { date: string }) {
  return (
    <div
      className="showtime-day-button showtime-day-button--placeholder"
      aria-hidden="true"
    >
      <span className="showtime-day-button-tick showtime-day-button-tick--top" />
      <span className="showtime-day-button-eyebrow">
        {getDayWeekday(date)}
      </span>
      <span className="showtime-day-button-number">{getDayNumber(date)}</span>
    </div>
  );
}

function getPreferredScrollBehavior(): ScrollBehavior {
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return "auto";
  }

  return "smooth";
}

export function ShowtimeDayPicker({
  dates,
  selectedDate,
  onSelect,
  onPreviewDateChange,
  ariaLabel,
  className,
  disabledBeforeDate = null,
  trailingPlaceholderCount = 0,
}: ShowtimeDayPickerProps) {
  const entries = useMemo<DayPickerEntry[]>(
    () => buildDayPickerEntries(dates, disabledBeforeDate),
    [dates, disabledBeforeDate],
  );
  const firstEnabledEntry = useMemo(
    () => entries.find((entry) => !entry.isDisabled) ?? null,
    [entries],
  );
  const selectedEntry = useMemo(
    () =>
      entries.find(
        (entry) => entry.date === selectedDate && !entry.isDisabled,
      ) ?? firstEnabledEntry,
    [entries, firstEnabledEntry, selectedDate],
  );
  const selectedEntryDate = selectedEntry?.date ?? null;
  const firstEntryDate = entries[0]?.date ?? null;
  const lastEntryDate = entries.at(-1)?.date ?? null;
  const firstEnabledEntryDate = firstEnabledEntry?.date ?? null;
  const normalizedTrailingPlaceholderCount = Math.max(
    0,
    Number.isFinite(trailingPlaceholderCount)
      ? Math.floor(trailingPlaceholderCount)
      : 0,
  );
  const trailingPlaceholderDates = useMemo(
    () =>
      lastEntryDate
        ? Array.from(
            { length: normalizedTrailingPlaceholderCount },
            (_, index) => addCalendarDays(lastEntryDate, index + 1),
          )
        : [],
    [lastEntryDate, normalizedTrailingPlaceholderCount],
  );
  const [previewDate, setPreviewDate] = useState<string | null>(
    selectedEntryDate,
  );
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const previewDateRef = useRef(previewDate);
  const requestedDateRef = useRef<string | null>(null);
  const pointerLandingDateRef = useRef<string | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const settleTimeoutRef = useRef<number | null>(null);
  const pointerDragRef = useRef<PointerDragState | null>(null);
  const suppressClickRef = useRef(false);
  const isInteractingRef = useRef(false);
  const isTouchingRef = useRef(false);
  const [edgePadding, setEdgePadding] = useState(0);
  const [isPointerDragging, setIsPointerDragging] = useState(false);

  const setPreviewDateIfChanged = useCallback(
    (date: string | null) => {
      if (previewDateRef.current === date) {
        return;
      }

      previewDateRef.current = date;
      setPreviewDate(date);

      if (date) {
        onPreviewDateChange?.(date);
      }
    },
    [onPreviewDateChange],
  );

  const updateEdgePadding = useCallback(() => {
    const viewport = viewportRef.current;
    const firstButton = firstEntryDate
      ? buttonRefs.current.get(firstEntryDate)
      : null;

    if (!viewport || !firstButton) {
      return;
    }

    const nextEdgePadding = Math.max(
      0,
      (viewport.clientWidth - firstButton.offsetWidth) / 2,
    );

    setEdgePadding((currentEdgePadding) =>
      Math.abs(currentEdgePadding - nextEdgePadding) < 1
        ? currentEdgePadding
        : nextEdgePadding);
  }, [firstEntryDate]);

  const getMinimumSelectableScrollLeft = useCallback((): number => {
    const viewport = viewportRef.current;
    const firstEnabledButton = firstEnabledEntryDate
      ? buttonRefs.current.get(firstEnabledEntryDate)
      : null;

    if (!viewport || !firstEnabledButton) {
      return 0;
    }

    return Math.max(
      0,
      firstEnabledButton.offsetLeft +
        firstEnabledButton.offsetWidth / 2 -
        viewport.clientWidth / 2,
    );
  }, [firstEnabledEntryDate]);

  const getMaximumSelectableScrollLeft = useCallback((): number => {
    const viewport = viewportRef.current;
    const lastButton = lastEntryDate
      ? buttonRefs.current.get(lastEntryDate)
      : null;

    if (!viewport || !lastButton) {
      return 0;
    }

    return Math.max(
      0,
      lastButton.offsetLeft +
        lastButton.offsetWidth / 2 -
        viewport.clientWidth / 2,
    );
  }, [lastEntryDate]);

  const getSelectableScrollBounds = useCallback(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return { min: 0, max: 0 };
    }

    const maxScrollLeft = Math.max(
      0,
      viewport.scrollWidth - viewport.clientWidth,
    );
    const minimumScrollLeft = Math.min(
      getMinimumSelectableScrollLeft(),
      maxScrollLeft,
    );
    const maximumScrollLeft = Math.max(
      minimumScrollLeft,
      Math.min(getMaximumSelectableScrollLeft(), maxScrollLeft),
    );

    return { min: minimumScrollLeft, max: maximumScrollLeft };
  }, [getMaximumSelectableScrollLeft, getMinimumSelectableScrollLeft]);

  const centerDate = useCallback(
    (date: string, behavior: ScrollBehavior): boolean => {
      const viewport = viewportRef.current;
      const button = buttonRefs.current.get(date);

      if (!viewport || !button) {
        return false;
      }

      const targetScrollLeft =
        button.offsetLeft + button.offsetWidth / 2 - viewport.clientWidth / 2;
      const { min, max } = getSelectableScrollBounds();
      const boundedTargetScrollLeft = Math.max(
        min,
        Math.min(targetScrollLeft, max),
      );

      if (Math.abs(viewport.scrollLeft - boundedTargetScrollLeft) < 1) {
        return false;
      }

      viewport.scrollTo({ left: boundedTargetScrollLeft, behavior });
      return true;
    },
    [getSelectableScrollBounds],
  );

  const getNearestEnabledEntryForScrollLeft = useCallback(
    (scrollLeft: number): DayPickerEntry | null => {
      const viewport = viewportRef.current;

      if (!viewport) {
        return null;
      }

      const viewportCenter = scrollLeft + viewport.clientWidth / 2;
      let nearestEntry: DayPickerEntry | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;

      for (const entry of entries) {
        if (entry.isDisabled) {
          continue;
        }

        const button = buttonRefs.current.get(entry.date);

        if (!button) {
          continue;
        }

        const buttonCenter = button.offsetLeft + button.offsetWidth / 2;
        const distance = Math.abs(buttonCenter - viewportCenter);

        if (distance < nearestDistance) {
          nearestEntry = entry;
          nearestDistance = distance;
        }
      }

      return nearestEntry;
    },
    [entries],
  );

  const getNearestEnabledEntry = useCallback((): DayPickerEntry | null => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return null;
    }

    return getNearestEnabledEntryForScrollLeft(viewport.scrollLeft);
  }, [getNearestEnabledEntryForScrollLeft]);

  const getPointerReleaseEntry = useCallback(
    (releaseVelocity: number): DayPickerEntry | null => {
      const viewport = viewportRef.current;

      if (!viewport) {
        return null;
      }

      const { min, max } = getSelectableScrollBounds();
      const projectedScrollLeft = Math.max(
        min,
        Math.min(
          max,
          viewport.scrollLeft +
            releaseVelocity / POINTER_RELEASE_PROJECTION_FRICTION,
        ),
      );

      return getNearestEnabledEntryForScrollLeft(projectedScrollLeft);
    },
    [getNearestEnabledEntryForScrollLeft, getSelectableScrollBounds],
  );

  const updatePreviewDate = useCallback(() => {
    if (scrollFrameRef.current !== null) {
      return;
    }

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      if (requestedDateRef.current) {
        setPreviewDateIfChanged(requestedDateRef.current);
        scrollFrameRef.current = null;
        return;
      }

      const nearestEntry = getNearestEnabledEntry();

      setPreviewDateIfChanged(nearestEntry?.date ?? null);
      scrollFrameRef.current = null;
    });
  }, [getNearestEnabledEntry, setPreviewDateIfChanged]);

  const clearScheduledSettle = useCallback(() => {
    if (settleTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(settleTimeoutRef.current);
    settleTimeoutRef.current = null;
  }, []);

  const settleOnNearestDate = useCallback(() => {
    if (isTouchingRef.current || pointerDragRef.current?.didDrag) {
      return;
    }

    clearScheduledSettle();

    const requestedDate = requestedDateRef.current;
    const pointerLandingDate = pointerLandingDateRef.current;
    const targetDate = requestedDate ?? pointerLandingDate;
    const targetedEntry = targetDate
      ? (entries.find(
          (entry) => entry.date === targetDate && !entry.isDisabled,
        ) ?? null)
      : null;
    const nearestEntry = targetedEntry ?? getNearestEnabledEntry();

    if (!nearestEntry) {
      requestedDateRef.current = null;
      pointerLandingDateRef.current = null;
      isInteractingRef.current = false;
      return;
    }

    if (!pointerLandingDate || requestedDate) {
      setPreviewDateIfChanged(nearestEntry.date);
    }

    if (centerDate(nearestEntry.date, getPreferredScrollBehavior())) {
      isInteractingRef.current = true;
      return;
    }

    setPreviewDateIfChanged(nearestEntry.date);
    requestedDateRef.current = null;
    pointerLandingDateRef.current = null;
    isInteractingRef.current = false;

    if (nearestEntry.date !== selectedEntryDate) {
      onSelect(nearestEntry.date);
    }
  }, [
    centerDate,
    clearScheduledSettle,
    entries,
    getNearestEnabledEntry,
    onSelect,
    selectedEntryDate,
    setPreviewDateIfChanged,
  ]);

  const scheduleSettle = useCallback(
    (delayMs = SCROLL_SETTLE_DELAY_MS) => {
      clearScheduledSettle();

      settleTimeoutRef.current = window.setTimeout(() => {
        settleTimeoutRef.current = null;
        settleOnNearestDate();
      }, delayMs);
    },
    [clearScheduledSettle, settleOnNearestDate],
  );

  const scheduleSettleForCurrentPosition = useCallback(() => {
    scheduleSettle();
  }, [scheduleSettle]);

  const requestDate = useCallback(
    (date: string) => {
      const entry = entries.find((candidate) => candidate.date === date);

      if (!entry || entry.isDisabled) {
        return;
      }

      clearScheduledSettle();
      setIsPointerDragging(false);
      pointerLandingDateRef.current = null;
      requestedDateRef.current = entry.date;
      setPreviewDateIfChanged(entry.date);
      isInteractingRef.current = true;

      if (!centerDate(entry.date, getPreferredScrollBehavior())) {
        requestedDateRef.current = null;
        isInteractingRef.current = false;

        if (entry.date !== selectedEntryDate) {
          onSelect(entry.date);
        }
      }
    },
    [
      centerDate,
      clearScheduledSettle,
      entries,
      onSelect,
      selectedEntryDate,
      setPreviewDateIfChanged,
    ],
  );

  useLayoutEffect(() => {
    updateEdgePadding();

    if (!selectedEntryDate) {
      setPreviewDateIfChanged(null);
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      if (isInteractingRef.current) {
        return;
      }

      setPreviewDateIfChanged(selectedEntryDate);
      centerDate(selectedEntryDate, "auto");
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [
    centerDate,
    edgePadding,
    entries.length,
    selectedEntryDate,
    setPreviewDateIfChanged,
    updateEdgePadding,
  ]);

  useEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    const handleScrollEnd = () => {
      if (isTouchingRef.current || pointerDragRef.current?.didDrag) {
        return;
      }

      settleOnNearestDate();
    };

    viewport.addEventListener("scrollend", handleScrollEnd);

    return () => {
      viewport.removeEventListener("scrollend", handleScrollEnd);
    };
  }, [settleOnNearestDate]);

  useEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport || !selectedEntryDate) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      updateEdgePadding();
    });

    resizeObserver.observe(viewport);

    return () => {
      resizeObserver.disconnect();
    };
  }, [selectedEntryDate, updateEdgePadding]);

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }

      if (settleTimeoutRef.current !== null) {
        window.clearTimeout(settleTimeoutRef.current);
      }

      viewportRef.current?.classList.remove(
        "showtime-day-picker-scroll--direct-manipulation",
      );
      requestedDateRef.current = null;
      pointerLandingDateRef.current = null;
      isTouchingRef.current = false;
    },
    [],
  );

  if (entries.length === 0 || !selectedEntryDate) {
    return null;
  }

  const findEnabledIndex = (startIndex: number, direction: -1 | 1): number => {
    for (
      let index = startIndex + direction;
      index >= 0 && index < entries.length;
      index += direction
    ) {
      if (!entries[index].isDisabled) {
        return index;
      }
    }

    return startIndex;
  };

  const pickerStyle = {
    "--showtime-day-edge-padding": `${edgePadding}px`,
  } as CSSProperties;
  const firstDate = entries[0].date;
  const leadingGhostDates = Array.from({ length: LEADING_GHOST_DAY_COUNT }, (
    _,
    index,
  ) => addCalendarDays(firstDate, -(index + 1)));

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number;

    switch (event.key) {
      case "ArrowLeft":
        nextIndex = findEnabledIndex(index, -1);
        break;
      case "ArrowRight":
        nextIndex = findEnabledIndex(index, 1);
        break;
      case "Home":
        nextIndex = findEnabledIndex(-1, 1);
        break;
      case "End":
        nextIndex = findEnabledIndex(entries.length, -1);
        break;
      default:
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    const nextEntry = entries[nextIndex];

    if (!nextEntry || nextEntry.isDisabled) {
      return;
    }

    buttonRefs.current.get(nextEntry.date)?.focus({ preventScroll: true });
    requestDate(nextEntry.date);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") {
      return;
    }

    const viewport = viewportRef.current;

    if (!viewport || event.button !== 0) {
      return;
    }

    clearScheduledSettle();
    pointerLandingDateRef.current = null;
    requestedDateRef.current = null;
    suppressClickRef.current = false;

    pointerDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startScrollLeft: viewport.scrollLeft,
      lastClientX: event.clientX,
      lastTime: window.performance.now(),
      velocity: 0,
      didDrag: false,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    const dragState = pointerDragRef.current;

    if (!viewport || !dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const distance = event.clientX - dragState.startClientX;
    const currentTime = window.performance.now();
    const elapsed = Math.max(1, currentTime - dragState.lastTime);

    if (!dragState.didDrag && Math.abs(distance) >= POINTER_DRAG_THRESHOLD_PX) {
      dragState.didDrag = true;
      suppressClickRef.current = true;
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add("showtime-day-picker-scroll--direct-manipulation");
      clearScheduledSettle();
      setIsPointerDragging(true);
    }

    if (!dragState.didDrag) {
      return;
    }

    event.preventDefault();
    isInteractingRef.current = true;
    dragState.velocity = (dragState.lastClientX - event.clientX) / elapsed;
    dragState.lastClientX = event.clientX;
    dragState.lastTime = currentTime;

    const { min, max } = getSelectableScrollBounds();
    const targetScrollLeft = dragState.startScrollLeft - distance;

    viewport.scrollLeft = Math.max(min, Math.min(max, targetScrollLeft));
  };

  const finishPointerDrag = (event: PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    const dragState = pointerDragRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    pointerDragRef.current = null;

    if (viewport?.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }

    viewport?.classList.remove(
      "showtime-day-picker-scroll--direct-manipulation",
    );

    if (!dragState.didDrag) {
      return;
    }

    const releaseVelocity =
      event.type === "pointercancel" ||
      window.performance.now() - dragState.lastTime >
        POINTER_VELOCITY_STALE_AFTER_MS
        ? 0
        : dragState.velocity;
    const releaseEntry = getPointerReleaseEntry(releaseVelocity);

    if (releaseEntry) {
      clearScheduledSettle();
      setIsPointerDragging(false);
      requestedDateRef.current = null;
      pointerLandingDateRef.current = releaseEntry.date;
      isInteractingRef.current = true;
      updatePreviewDate();

      if (!centerDate(releaseEntry.date, getPreferredScrollBehavior())) {
        setPreviewDateIfChanged(releaseEntry.date);
        pointerLandingDateRef.current = null;
        isInteractingRef.current = false;

        if (releaseEntry.date !== selectedEntryDate) {
          onSelect(releaseEntry.date);
        }
      }
    } else {
      pointerLandingDateRef.current = null;
      setIsPointerDragging(false);
      scheduleSettleForCurrentPosition();
    }

    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };

  const beginTouchInteraction = () => {
    pointerLandingDateRef.current = null;
    requestedDateRef.current = null;
    isTouchingRef.current = true;
    isInteractingRef.current = true;
    clearScheduledSettle();
  };

  const finishTouchInteraction = () => {
    if (!isTouchingRef.current) {
      return;
    }

    isTouchingRef.current = false;
    scheduleSettle(TOUCH_SCROLL_SETTLE_DELAY_MS);
  };

  return (
    <div
      className={[
        "showtime-day-picker-shell",
        isPointerDragging ? "showtime-day-picker-shell--dragging" : null,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="showtime-day-picker-frame" aria-hidden="true">
        <span className="showtime-day-picker-center-notch showtime-day-picker-center-notch--top" />
      </div>

      <div
        ref={viewportRef}
        className="showtime-day-picker-scroll"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerDrag}
        onPointerCancel={finishPointerDrag}
        onTouchStart={beginTouchInteraction}
        onTouchEnd={finishTouchInteraction}
        onTouchCancel={finishTouchInteraction}
        onWheel={() => {
          pointerLandingDateRef.current = null;
        }}
        onScroll={() => {
          const viewport = viewportRef.current;

          if (!viewport) {
            return;
          }

          const { min, max } = getSelectableScrollBounds();
          const boundedScrollLeft = Math.max(
            min,
            Math.min(viewport.scrollLeft, max),
          );

          if (Math.abs(viewport.scrollLeft - boundedScrollLeft) >= 0.5) {
            viewport.scrollLeft = boundedScrollLeft;
          }

          isInteractingRef.current = true;
          updatePreviewDate();

          if (isTouchingRef.current) {
            clearScheduledSettle();
            return;
          }

          if (!pointerDragRef.current?.didDrag) {
            scheduleSettleForCurrentPosition();
          }
        }}
      >
        <div
          className="showtime-day-picker"
          role="radiogroup"
          aria-label={ariaLabel}
          style={pickerStyle}
        >
          <span
            className="showtime-day-picker-edge-spacer"
            aria-hidden="true"
          />
          {leadingGhostDates.map((date, index) => (
            <EdgeGhostDay
              key={`before-${date}`}
              date={date}
              index={index + 1}
            />
          ))}
          {entries.map((entry, index) => {
            const isSelected = entry.date === selectedEntryDate;
            const isPreview = entry.date === previewDate;

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
                role="radio"
                className={[
                  "showtime-day-button",
                  isSelected ? "showtime-day-button--selected" : null,
                  isPreview ? "showtime-day-button--preview" : null,
                  entry.isDisabled ? "showtime-day-button--disabled" : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-checked={isSelected}
                aria-current={isSelected ? "date" : undefined}
                aria-label={getDayAriaLabel(entry.date)}
                disabled={entry.isDisabled}
                tabIndex={isSelected ? 0 : -1}
                onClick={(event) => {
                  event.stopPropagation();

                  if (suppressClickRef.current) {
                    return;
                  }

                  requestDate(entry.date);
                }}
                onKeyDown={(event) => {
                  handleKeyDown(event, index);
                }}
              >
                <span className="showtime-day-button-tick showtime-day-button-tick--top" />
                <span className="showtime-day-button-eyebrow">
                  {getDayWeekday(entry.date)}
                </span>
                <span className="showtime-day-button-number">
                  {getDayNumber(entry.date)}
                </span>
                {isPreview && (
                  <span className="showtime-day-button-month">
                    {getDayMonth(entry.date)}
                  </span>
                )}
              </button>
            );
          })}
          {trailingPlaceholderDates.map((date) => (
            <TrailingPlaceholderDay key={`placeholder-${date}`} date={date} />
          ))}
          <span
            className="showtime-day-picker-edge-spacer"
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  );
}
