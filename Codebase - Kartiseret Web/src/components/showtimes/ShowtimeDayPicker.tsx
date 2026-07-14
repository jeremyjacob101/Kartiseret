import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { getShowtimeDateLabel } from "./showtimeUtils";
import "./ShowtimeDayPicker.css";

type ShowtimeDayPickerProps = {
  dates: readonly string[];
  selectedDate: string | null;
  onSelect: (date: string) => void;
  ariaLabel: string;
  className?: string;
  disabledBeforeDate?: string | null;
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
const POINTER_DRAG_THRESHOLD_PX = 5;
const POINTER_INERTIA_MIN_VELOCITY = 0.04;
const POINTER_INERTIA_FRICTION = 0.006;
const POINTER_VELOCITY_STALE_AFTER_MS = 80;
const EDGE_GHOST_DAY_COUNT = 5;

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

function EdgeGhostDay({
  date,
  index,
  side,
}: {
  date: string;
  index: number;
  side: "before" | "after";
}) {
  return (
    <div
      className={`showtime-day-button showtime-day-button--disabled showtime-day-button--edge-ghost showtime-day-button--edge-ghost-${side} showtime-day-button--edge-ghost-${index}`}
      style={{ "--showtime-day-ghost-index": index } as CSSProperties}
      aria-hidden="true"
    >
      <span className="showtime-day-button-tick showtime-day-button-tick--top" />
      <span className="showtime-day-button-eyebrow">{getDayWeekday(date)}</span>
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
  ariaLabel,
  className,
  disabledBeforeDate = null,
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
  const [previewDate, setPreviewDate] = useState<string | null>(
    selectedEntryDate,
  );
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const previewDateRef = useRef(previewDate);
  const scrollFrameRef = useRef<number | null>(null);
  const settleTimeoutRef = useRef<number | null>(null);
  const pointerDragRef = useRef<PointerDragState | null>(null);
  const inertiaFrameRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const isInteractingRef = useRef(false);
  const [edgePadding, setEdgePadding] = useState(0);
  const [isPointerDragging, setIsPointerDragging] = useState(false);

  const setPreviewDateIfChanged = useCallback((date: string | null) => {
    if (previewDateRef.current === date) {
      return;
    }

    previewDateRef.current = date;
    setPreviewDate(date);
  }, []);

  const updateEdgePadding = useCallback(() => {
    const viewport = viewportRef.current;
    const firstButton = entries[0]
      ? buttonRefs.current.get(entries[0].date)
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
  }, [entries]);

  const getMinimumSelectableScrollLeft = useCallback((): number => {
    const viewport = viewportRef.current;
    const firstEnabledButton = firstEnabledEntry
      ? buttonRefs.current.get(firstEnabledEntry.date)
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
  }, [firstEnabledEntry]);

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

    return { min: minimumScrollLeft, max: maxScrollLeft };
  }, [getMinimumSelectableScrollLeft]);

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

  const getNearestEnabledEntry = useCallback((): DayPickerEntry | null => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return null;
    }

    const viewportCenter = viewport.scrollLeft + viewport.clientWidth / 2;
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
  }, [entries]);

  const updatePreviewDate = useCallback(() => {
    if (scrollFrameRef.current !== null) {
      return;
    }

    scrollFrameRef.current = window.requestAnimationFrame(() => {
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
    if (pointerDragRef.current?.didDrag || inertiaFrameRef.current !== null) {
      return;
    }

    clearScheduledSettle();

    const nearestEntry = getNearestEnabledEntry();

    if (!nearestEntry) {
      isInteractingRef.current = false;
      return;
    }

    setPreviewDateIfChanged(nearestEntry.date);

    if (centerDate(nearestEntry.date, getPreferredScrollBehavior())) {
      isInteractingRef.current = true;
      return;
    }

    isInteractingRef.current = false;

    if (nearestEntry.date !== selectedEntryDate) {
      onSelect(nearestEntry.date);
    }
  }, [
    centerDate,
    clearScheduledSettle,
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

  const stopPointerInertia = useCallback(() => {
    if (inertiaFrameRef.current !== null) {
      window.cancelAnimationFrame(inertiaFrameRef.current);
      inertiaFrameRef.current = null;
    }
  }, []);

  const runPointerInertia = useCallback(
    (initialVelocity: number) => {
      stopPointerInertia();

      const viewport = viewportRef.current;

      if (!viewport) {
        setIsPointerDragging(false);
        return;
      }

      if (Math.abs(initialVelocity) < POINTER_INERTIA_MIN_VELOCITY) {
        setIsPointerDragging(false);
        scheduleSettleForCurrentPosition();
        return;
      }

      let velocity = initialVelocity;
      let previousTime = window.performance.now();

      const animate = (time: number) => {
        const currentViewport = viewportRef.current;

        if (!currentViewport) {
          inertiaFrameRef.current = null;
          setIsPointerDragging(false);
          return;
        }

        const elapsed = Math.min(34, Math.max(1, time - previousTime));
        previousTime = time;
        const { min, max } = getSelectableScrollBounds();
        const requestedScrollLeft =
          currentViewport.scrollLeft + velocity * elapsed;

        const nextScrollLeft = Math.max(
          min,
          Math.min(max, requestedScrollLeft),
        );
        const hitBoundary =
          (nextScrollLeft <= min && velocity < 0) ||
          (nextScrollLeft >= max && velocity > 0);

        currentViewport.scrollLeft = nextScrollLeft;
        updatePreviewDate();
        velocity = hitBoundary
          ? 0
          : velocity * Math.exp(-POINTER_INERTIA_FRICTION * elapsed);

        if (Math.abs(velocity) < POINTER_INERTIA_MIN_VELOCITY || hitBoundary) {
          inertiaFrameRef.current = null;
          setIsPointerDragging(false);
          scheduleSettleForCurrentPosition();
          return;
        }

        inertiaFrameRef.current = window.requestAnimationFrame(animate);
      };

      inertiaFrameRef.current = window.requestAnimationFrame(animate);
    },
    [
      getSelectableScrollBounds,
      scheduleSettleForCurrentPosition,
      stopPointerInertia,
      updatePreviewDate,
    ],
  );

  const requestDate = useCallback(
    (date: string) => {
      const entry = entries.find((candidate) => candidate.date === date);

      if (!entry || entry.isDisabled) {
        return;
      }

      stopPointerInertia();
      clearScheduledSettle();
      setIsPointerDragging(false);
      setPreviewDateIfChanged(entry.date);
      isInteractingRef.current = true;

      if (!centerDate(entry.date, getPreferredScrollBehavior())) {
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
      stopPointerInertia,
    ],
  );

  useLayoutEffect(() => {
    updateEdgePadding();

    if (!selectedEntryDate) {
      setPreviewDateIfChanged(null);
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      if (!isInteractingRef.current) {
        setPreviewDateIfChanged(selectedEntryDate);
      }

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
      if (pointerDragRef.current?.didDrag || inertiaFrameRef.current !== null) {
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

      if (inertiaFrameRef.current !== null) {
        window.cancelAnimationFrame(inertiaFrameRef.current);
      }

      viewportRef.current?.classList.remove(
        "showtime-day-picker-scroll--direct-manipulation",
      );
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
  const lastDate = entries[entries.length - 1].date;
  const leadingGhostDates = Array.from({ length: EDGE_GHOST_DAY_COUNT }, (
    _,
    index,
  ) => addCalendarDays(firstDate, -(index + 1)));
  const trailingGhostDates = Array.from({ length: EDGE_GHOST_DAY_COUNT }, (
    _,
    index,
  ) => addCalendarDays(lastDate, index + 1));

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

    stopPointerInertia();
    clearScheduledSettle();
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

    updatePreviewDate();
    const releaseVelocity =
      window.performance.now() - dragState.lastTime >
      POINTER_VELOCITY_STALE_AFTER_MS
        ? 0
        : dragState.velocity;

    runPointerInertia(releaseVelocity);
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
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
        onScroll={() => {
          const viewport = viewportRef.current;

          if (!viewport) {
            return;
          }

          isInteractingRef.current = true;
          updatePreviewDate();

          if (
            !pointerDragRef.current?.didDrag &&
            inertiaFrameRef.current === null
          ) {
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
          {leadingGhostDates.map((date, index) => (
            <EdgeGhostDay
              key={`before-${date}`}
              date={date}
              index={index + 1}
              side="before"
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
          {trailingGhostDates.map((date, index) => (
            <EdgeGhostDay
              key={`after-${date}`}
              date={date}
              index={index + 1}
              side="after"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
