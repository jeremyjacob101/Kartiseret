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
  startVirtualScrollLeft: number;
  lastClientX: number;
  lastTime: number;
  velocity: number;
  didDrag: boolean;
};

const SCROLL_SETTLE_DELAY_MS = 140;
const EDGE_RELEASE_DURATION_MS = 150;
const EDGE_RELEASE_INPUT_IDLE_MS = 32;
const LEFT_EDGE_PULL_RATIO = 20;
const POINTER_DRAG_THRESHOLD_PX = 5;
const POINTER_INERTIA_MIN_VELOCITY = 0.04;
const POINTER_INERTIA_FRICTION = 0.006;
const POINTER_VELOCITY_STALE_AFTER_MS = 80;
const LEADING_DISABLED_DAY_COUNT = 5;

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
  const entries = dates.map((date) => ({
    date,
    isDisabled: Boolean(disabledBeforeDate && date < disabledBeforeDate),
  }));
  const firstEnabledDate = entries.find((entry) => !entry.isDisabled)?.date;

  if (
    !disabledBeforeDate ||
    firstEnabledDate !== disabledBeforeDate ||
    dates.length === 0
  ) {
    return entries;
  }

  const suppliedDates = new Set(dates);
  const leadingEntries = Array.from({ length: LEADING_DISABLED_DAY_COUNT }, (
    _,
    index,
  ) => addCalendarDays(disabledBeforeDate, index - LEADING_DISABLED_DAY_COUNT))
    .filter((date) => !suppliedDates.has(date))
    .map((date) => ({ date, isDisabled: true }));

  return [...leadingEntries, ...entries];
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

function getPreferredScrollBehavior(): ScrollBehavior {
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return "auto";
  }

  return "smooth";
}

function getEdgeOffsetForPull(pullDistance: number): number {
  return Math.max(0, pullDistance) / LEFT_EDGE_PULL_RATIO;
}

function getPullForEdgeOffset(edgeOffset: number): number {
  return Math.max(0, edgeOffset) * LEFT_EDGE_PULL_RATIO;
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
  const railRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const previewDateRef = useRef(previewDate);
  const scrollFrameRef = useRef<number | null>(null);
  const settleTimeoutRef = useRef<number | null>(null);
  const pointerDragRef = useRef<PointerDragState | null>(null);
  const inertiaFrameRef = useRef<number | null>(null);
  const edgeReleaseFrameRef = useRef<number | null>(null);
  const edgeReleaseTimeoutRef = useRef<number | null>(null);
  const edgeOffsetRef = useRef(0);
  const edgePullDistanceRef = useRef(0);
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

  const renderEdgeOffset = useCallback((edgeOffset: number) => {
    const rail = railRef.current;
    const viewport = viewportRef.current;
    const boundedOffset = Math.max(0, edgeOffset);

    edgeOffsetRef.current = boundedOffset;
    edgePullDistanceRef.current = getPullForEdgeOffset(boundedOffset);

    if (!rail) {
      return;
    }

    if (boundedOffset > 0.01) {
      viewport?.classList.add("showtime-day-picker-scroll--rubber-banding");
      rail.classList.add("showtime-day-picker--rubber-banding");
      rail.style.transform = `translate3d(${boundedOffset}px, 0, 0)`;
      return;
    }

    rail.style.transform = "";
    rail.classList.remove("showtime-day-picker--rubber-banding");
    viewport?.classList.remove("showtime-day-picker-scroll--rubber-banding");
  }, []);

  const setEdgePullDistance = useCallback(
    (pullDistance: number) => {
      const boundedPullDistance = Math.max(0, pullDistance);

      edgePullDistanceRef.current = boundedPullDistance;
      renderEdgeOffset(getEdgeOffsetForPull(boundedPullDistance));
      edgePullDistanceRef.current = boundedPullDistance;
    },
    [renderEdgeOffset],
  );

  const cancelEdgeRelease = useCallback(() => {
    if (edgeReleaseTimeoutRef.current !== null) {
      window.clearTimeout(edgeReleaseTimeoutRef.current);
      edgeReleaseTimeoutRef.current = null;
    }

    if (edgeReleaseFrameRef.current !== null) {
      window.cancelAnimationFrame(edgeReleaseFrameRef.current);
      edgeReleaseFrameRef.current = null;
    }
  }, []);

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

  const startEdgeRelease = useCallback(() => {
    cancelEdgeRelease();

    const shouldReduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const initialPosition = edgeOffsetRef.current;

    if (initialPosition <= 0.05 || shouldReduceMotion) {
      renderEdgeOffset(0);
      return;
    }

    const startedAt = window.performance.now();

    const animate = (time: number) => {
      const progress = Math.min(
        1,
        (time - startedAt) / EDGE_RELEASE_DURATION_MS,
      );
      const remaining = (1 - progress) ** 3;

      renderEdgeOffset(initialPosition * remaining);

      if (progress >= 1) {
        edgeReleaseFrameRef.current = null;
        renderEdgeOffset(0);
        return;
      }

      edgeReleaseFrameRef.current = window.requestAnimationFrame(animate);
    };

    edgeReleaseFrameRef.current = window.requestAnimationFrame(animate);
  }, [cancelEdgeRelease, renderEdgeOffset]);

  const scheduleEdgeRelease = useCallback(() => {
    cancelEdgeRelease();

    edgeReleaseTimeoutRef.current = window.setTimeout(() => {
      edgeReleaseTimeoutRef.current = null;
      startEdgeRelease();
    }, EDGE_RELEASE_INPUT_IDLE_MS);
  }, [cancelEdgeRelease, startEdgeRelease]);

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

      if (
        edgeOffsetRef.current > 0.05 ||
        Math.abs(initialVelocity) < POINTER_INERTIA_MIN_VELOCITY
      ) {
        setIsPointerDragging(false);

        if (edgeOffsetRef.current > 0.05) {
          startEdgeRelease();
          scheduleSettleForCurrentPosition();
        } else {
          scheduleSettleForCurrentPosition();
        }

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

        if (requestedScrollLeft < min && velocity < 0) {
          currentViewport.scrollLeft = min;
          setEdgePullDistance(min - requestedScrollLeft);
          updatePreviewDate();
          inertiaFrameRef.current = null;
          setIsPointerDragging(false);
          startEdgeRelease();
          scheduleSettleForCurrentPosition();
          return;
        }

        const nextScrollLeft = Math.min(max, requestedScrollLeft);
        const hitBoundary = nextScrollLeft >= max && velocity > 0;

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
      setEdgePullDistance,
      startEdgeRelease,
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
      cancelEdgeRelease();
      clearScheduledSettle();
      renderEdgeOffset(0);
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
      cancelEdgeRelease,
      centerDate,
      clearScheduledSettle,
      entries,
      onSelect,
      renderEdgeOffset,
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

    if (!viewport) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) < 0.5) {
        return;
      }

      const { min, max } = getSelectableScrollBounds();
      const currentEdgePull = edgePullDistanceRef.current;

      if (event.deltaX > 0 && currentEdgePull > 0.5) {
        event.preventDefault();
        cancelEdgeRelease();

        const remainingDelta = event.deltaX - currentEdgePull;

        if (remainingDelta < 0) {
          setEdgePullDistance(-remainingDelta);
          scheduleEdgeRelease();
          return;
        }

        renderEdgeOffset(0);

        if (remainingDelta > 0.5) {
          viewport.scrollLeft = Math.min(max, min + remainingDelta);
        }

        return;
      }

      const isPushingPastStart =
        viewport.scrollLeft <= min + 0.5 && event.deltaX < 0;

      if (!isPushingPastStart) {
        return;
      }

      event.preventDefault();
      cancelEdgeRelease();
      setEdgePullDistance(edgePullDistanceRef.current + Math.abs(event.deltaX));
      scheduleEdgeRelease();
    };

    viewport.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      viewport.removeEventListener("wheel", handleWheel);
    };
  }, [
    cancelEdgeRelease,
    getSelectableScrollBounds,
    renderEdgeOffset,
    scheduleEdgeRelease,
    setEdgePullDistance,
  ]);

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

      if (edgeReleaseFrameRef.current !== null) {
        window.cancelAnimationFrame(edgeReleaseFrameRef.current);
      }

      if (edgeReleaseTimeoutRef.current !== null) {
        window.clearTimeout(edgeReleaseTimeoutRef.current);
      }

      viewportRef.current?.classList.remove(
        "showtime-day-picker-scroll--direct-manipulation",
        "showtime-day-picker-scroll--rubber-banding",
      );

      if (railRef.current) {
        railRef.current.style.transform = "";
        railRef.current.classList.remove("showtime-day-picker--rubber-banding");
      }
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
    cancelEdgeRelease();
    clearScheduledSettle();
    suppressClickRef.current = false;

    pointerDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startVirtualScrollLeft: viewport.scrollLeft - edgePullDistanceRef.current,
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
    const targetVirtualScrollLeft = dragState.startVirtualScrollLeft - distance;

    if (targetVirtualScrollLeft < min) {
      viewport.scrollLeft = min;
      setEdgePullDistance(min - targetVirtualScrollLeft);
      return;
    }

    setEdgePullDistance(0);
    viewport.scrollLeft = Math.min(max, targetVirtualScrollLeft);
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
      if (edgeOffsetRef.current > 0.05) {
        startEdgeRelease();
      }

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
        <span className="showtime-day-picker-rail showtime-day-picker-rail--top" />
        <span className="showtime-day-picker-rail showtime-day-picker-rail--bottom" />
        <span className="showtime-day-picker-center-notch showtime-day-picker-center-notch--top" />
        <span className="showtime-day-picker-center-notch showtime-day-picker-center-notch--bottom" />
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
          const { min } = getSelectableScrollBounds();

          if (viewport.scrollLeft < min - 0.5) {
            const overshoot = min - viewport.scrollLeft;

            viewport.scrollLeft = min;
            clearScheduledSettle();
            setEdgePullDistance(edgePullDistanceRef.current + overshoot);
            updatePreviewDate();

            if (
              !pointerDragRef.current?.didDrag &&
              inertiaFrameRef.current === null
            ) {
              scheduleEdgeRelease();
              scheduleSettleForCurrentPosition();
            }

            return;
          }

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
          ref={railRef}
          className="showtime-day-picker"
          role="radiogroup"
          aria-label={ariaLabel}
          style={pickerStyle}
        >
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
                <span className="showtime-day-button-month">
                  {getDayMonth(entry.date)}
                </span>
                <span className="showtime-day-button-tick showtime-day-button-tick--bottom" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
