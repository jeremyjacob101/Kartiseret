import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { X } from "lucide-react";
import { movies } from "../data/movieCatalog";
import {
  MovieScrollerBase5,
  type MovieScroller5CardState,
  type MovieScroller5Props,
  type PosterSourceRect5,
} from "./MovieScrollerBase5";
import { getRepeatSetCount5 } from "./MovieScroller5Shared";
import { MovieDetailsContent } from "./MovieDetailsContent";
import "./MovieScroller5.css";

type FocusPhase5 = "collapsed" | "opening" | "open" | "closing";
type NavigationDirection5 = -1 | 1;

type GhostTransitionState5 = {
  itemIndex: number;
  sourceRect: PosterSourceRect5;
  targetRect: PosterSourceRect5;
  sourceOpacity: number;
  targetOpacity: number;
};

type DetailTransitionState5 = {
  key: number;
  direction: NavigationDirection5;
  fromItemIndex: number;
  toItemIndex: number;
};

type DetailLayout5 = {
  panelWidth: number;
  panelHeight: number;
  previewWidth: number;
  previewHeight: number;
  previewLeft: number;
  previewRight: number;
  previewTop: number;
};

type SwipeGesture5 = {
  pointerId: number;
  startX: number;
  startY: number;
};

const CARD_MOVE_DURATION_MS = 520;
const CARD_OPACITY_DURATION_MS = 260;
const CARD_STAGGER_STEP_MS = 16;
const CARD_MAX_STAGGER_MS = 110;
const SCROLLER_CARD_RADIUS_PX = 14;
const FOCUS_POSTER_RADIUS_PX = 28;
const FOCUS_POSTER_SHADOW =
  "0 24px 46px rgba(0, 0, 0, 0.34), 0 0 0 1px rgba(255, 255, 255, 0.08)";
const SCROLLER_CARD_SHADOW =
  "0 0 0 rgba(0, 0, 0, 0), 0 0 0 rgba(255, 255, 255, 0)";

const POSTER_MOVE_DURATION_MS = 300;
const POSTER_GHOST_OPACITY_DURATION_MS = 120;
const FOCUS_POSTER_FADE_DURATION_MS = 180;
const FOCUS_POSTER_REVEAL_DELAY_MS = 150;
const GHOST_FADE_OUT_DELAY_MS = 260;
const POSTER_HANDOFF_TOTAL_MS = 440;
const POSTER_RETURN_SETTLE_DELAY_MS = POSTER_MOVE_DURATION_MS;
const FOCUS_STAGE_FADE_DURATION_MS = 260;
const CLOSE_STAGE_FADE_DELAY_MS =
  POSTER_HANDOFF_TOTAL_MS - FOCUS_STAGE_FADE_DURATION_MS;
const DETAIL5_PRELOAD_RADIUS = 2;
const DETAIL5_EDGE_BUFFER_SETS = 1;
const DETAIL5_NAV_DURATION_MS = 360;
const DETAIL5_FOCUS_VIEWPORT_PADDING_PX = 28;
const DETAIL5_WHEEL_LOCK_MS = 420;
const DETAIL5_SWIPE_THRESHOLD_PX = 56;
const COLLAPSED_CARD_SCALE_BOOST = 0.15;

const movieScroller5TimingStyle = {
  "--movie-scroller5-stage-fade-duration": `${FOCUS_STAGE_FADE_DURATION_MS}ms`,
  "--movie-scroller5-stage-close-delay": `${CLOSE_STAGE_FADE_DELAY_MS}ms`,
  "--movie-scroller5-focus-poster-fade-duration": `${FOCUS_POSTER_FADE_DURATION_MS}ms`,
  "--movie-scroller5-ghost-move-duration": `${POSTER_MOVE_DURATION_MS}ms`,
  "--movie-scroller5-ghost-opacity-duration": `${POSTER_GHOST_OPACITY_DURATION_MS}ms`,
  "--movie-scroller5-detail-swap-duration": `${DETAIL5_NAV_DURATION_MS}ms`,
} as CSSProperties;

function clamp5(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function mod5(value: number, size: number): number {
  const remainder = value % size;
  return remainder < 0 ? remainder + size : remainder;
}

function easeOutCubic5(value: number): number {
  return 1 - (1 - value) ** 3;
}

function easeInOutCubic5(value: number): number {
  return value < 0.5
    ? 4 * value ** 3
    : 1 - ((-2 * value + 2) ** 3) / 2;
}

function lerp5(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function toPosterSourceRect5(
  rect: Pick<DOMRect, "top" | "left" | "width" | "height"> | null | undefined,
  fallback: PosterSourceRect5,
): PosterSourceRect5 {
  if (!rect) {
    return fallback;
  }

  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

function getPageScrollTop5(): number {
  return window.scrollY || window.pageYOffset || 0;
}

function getMaxPageScrollTop5(): number {
  const scrollRoot = document.scrollingElement ?? document.documentElement;
  return Math.max(0, scrollRoot.scrollHeight - window.innerHeight);
}

function getTargetDetailViewportTop5(panelHeight: number): number {
  const paddedViewportHeight = Math.max(
    0,
    window.innerHeight - DETAIL5_FOCUS_VIEWPORT_PADDING_PX * 2,
  );
  const centeredHeight = Math.min(panelHeight, paddedViewportHeight);

  return Math.max(
    DETAIL5_FOCUS_VIEWPORT_PADDING_PX,
    (window.innerHeight - centeredHeight) / 2,
  );
}

function getViewportScrollTarget5(
  shellTop: number,
  currentScrollTop: number,
  panelHeight: number,
): number {
  return clamp5(
    currentScrollTop + shellTop - getTargetDetailViewportTop5(panelHeight),
    0,
    getMaxPageScrollTop5(),
  );
}

function buildCardOffset5(
  cardState: MovieScroller5CardState,
  phase: FocusPhase5,
): CSSProperties | undefined {
  if (
    cardState.selectedItemIndex === null ||
    cardState.relativeIndex === null ||
    phase === "collapsed"
  ) {
    return undefined;
  }

  const transition =
    `transform ${CARD_MOVE_DURATION_MS}ms cubic-bezier(0.16, 0.9, 0.24, 1), ` +
    `opacity ${CARD_OPACITY_DURATION_MS}ms ease, ` +
    `filter ${CARD_MOVE_DURATION_MS}ms ease`;
  const absOffset = Math.abs(cardState.relativeIndex);

  if (cardState.isSelected) {
    if (phase === "closing") {
      return {
        opacity: 0,
        filter: "blur(0px)",
        transition,
        "--card-translate-x": "0px",
        "--card-translate-y": "0px",
        "--card-rotate": "0deg",
        "--card-scale": "1",
      } as CSSProperties;
    }

    return {
      opacity: 0,
      transition,
    };
  }

  if (phase === "closing") {
    const reverseDelay = Math.max(
      0,
      CARD_MAX_STAGGER_MS - absOffset * CARD_STAGGER_STEP_MS,
    );

    return {
      opacity: cardState.positionalOpacity,
      filter: "blur(0px)",
      transition,
      transitionDelay: `${reverseDelay}ms`,
      "--card-translate-x": "0px",
      "--card-translate-y": "0px",
      "--card-rotate": "0deg",
      "--card-scale": "1",
    } as CSSProperties;
  }

  const direction = cardState.relativeIndex < 0 ? -1 : 1;
  const travel = Math.min(760, 210 + absOffset * 86);
  const lift = Math.min(110, 18 + absOffset * 11);
  const rotate = direction * Math.min(20, 5 + absOffset * 2.3);
  const scale = Math.max(0.7, 0.94 - absOffset * 0.05);
  const delay = Math.min(CARD_MAX_STAGGER_MS, absOffset * CARD_STAGGER_STEP_MS);

  return {
    opacity: 0,
    filter: `blur(${Math.min(18, 5 + absOffset * 1.6)}px) saturate(0.76)`,
    transition,
    transitionDelay: `${delay}ms`,
    "--card-translate-x": `${direction * travel}px`,
    "--card-translate-y": `${-lift}px`,
    "--card-rotate": `${rotate}deg`,
    "--card-scale": `${scale}`,
  } as CSSProperties;
}

function getMaxWidthValue5(
  maxWidth: number | string,
  fallback: number,
): number {
  if (typeof maxWidth === "number") {
    return maxWidth;
  }

  if (maxWidth.trim().endsWith("%")) {
    return fallback;
  }

  const parsed = Number.parseFloat(maxWidth);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getDetailLayout5(
  clientWidth: number,
  maxWidth: number | string,
): DetailLayout5 {
  const viewportFallback =
    typeof window === "undefined" ? 1440 : Math.max(window.innerWidth, 960);
  const safeClientWidth = Math.max(clientWidth || viewportFallback, 360);
  const maxWidthValue = getMaxWidthValue5(maxWidth, safeClientWidth);
  const isCompact = safeClientWidth < 860;
  const stagePadding = isCompact ? 16 : 28;
  const panelMaxWidth = safeClientWidth - stagePadding * 2;
  const boundedPanelWidth = Math.min(
    maxWidthValue * (isCompact ? 0.9 : 0.78),
    safeClientWidth * (isCompact ? 0.9 : 0.7),
  );
  const panelWidth = Math.max(
    isCompact ? 320 : 420,
    Math.min(panelMaxWidth, Math.max(boundedPanelWidth, isCompact ? 320 : 420)),
  );
  const panelHeight = isCompact ? 706 : 756;
  const panelLeft = (safeClientWidth - panelWidth) / 2;
  const previewWidth = clamp5(
    Math.min(
      safeClientWidth * (isCompact ? 0.34 : 0.27),
      panelWidth * (isCompact ? 0.46 : 0.4),
    ),
    isCompact ? 150 : 240,
    isCompact ? 220 : 340,
  );
  const previewHeight = Math.round(previewWidth * 1.5);
  const previewOverlap = Math.min(
    previewWidth * (isCompact ? 0.42 : 0.38),
    isCompact ? 72 : 128,
  );
  const minLeftOverlap = Math.max(
    0,
    previewWidth - (panelLeft - stagePadding),
  );
  const minRightOverlap = Math.max(
    0,
    previewWidth -
      (safeClientWidth - stagePadding - (panelLeft + panelWidth)),
  );
  const previewLeft =
    panelLeft - previewWidth + Math.max(previewOverlap, minLeftOverlap);
  const previewRight =
    panelLeft + panelWidth - Math.max(previewOverlap, minRightOverlap);
  const previewTop = isCompact ? 126 : 118;

  return {
    panelWidth,
    panelHeight,
    previewWidth,
    previewHeight,
    previewLeft,
    previewRight,
    previewTop,
  };
}

function getCollapsedFocusViewportCenter5(
  clientWidth: number,
  cardWidth: number,
  itemSpan: number,
  gap: number,
): number {
  const desiredCenter = clientWidth / 2 - itemSpan;
  const minimumCenter = gap + cardWidth / 2;
  const maximumCenter = Math.max(minimumCenter, clientWidth - gap - cardWidth / 2);

  return clamp5(desiredCenter, minimumCenter, maximumCenter);
}

function getCollapsedScrollLeftForItem5(
  itemIndex: number,
  clientWidth: number,
  cardWidth: number,
  gap: number,
): number {
  const itemSpan = cardWidth + gap;
  const focusViewportCenter = getCollapsedFocusViewportCenter5(
    clientWidth,
    cardWidth,
    itemSpan,
    gap,
  );

  return Math.max(
    0,
    gap + itemIndex * itemSpan - (focusViewportCenter - cardWidth / 2),
  );
}

function isInteractiveDetailTarget5(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest(
      "button, a, input, textarea, select, summary, [role='button']",
    ),
  );
}

function isDetailSurfaceTarget5(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest(".movie-scroller5-detail-card, .movie-scroller5-side-preview"),
  );
}

export function MovieScroller5({
  cardWidth = 240,
  cardHeight = 360,
  gap = 16,
  maxWidth = "100%",
  className,
}: MovieScroller5Props) {
  const movieCount = movies.length;
  const collapsedRepeatSets = getRepeatSetCount5(cardWidth + gap, movieCount);
  const collapsedMiddleStartIndex =
    Math.floor(collapsedRepeatSets / 2) * movieCount;
  const collapsedHeight = Math.ceil(
    cardHeight * (1 + COLLAPSED_CARD_SCALE_BOOST),
  );

  const [phase, setPhase] = useState<FocusPhase5>("collapsed");
  const [collapsedSelectedItemIndex, setCollapsedSelectedItemIndex] = useState<
    number | null
  >(null);
  const [detailActiveItemIndex, setDetailActiveItemIndex] = useState(
    collapsedMiddleStartIndex,
  );
  const [detailClientWidth, setDetailClientWidth] = useState(0);
  const [isFocusPosterVisible, setIsFocusPosterVisible] = useState(false);
  const [showGhost, setShowGhost] = useState(false);
  const [isReturnHandoffReady, setIsReturnHandoffReady] = useState(false);
  const [ghostTransition, setGhostTransition] =
    useState<GhostTransitionState5 | null>(null);
  const [detailTransition, setDetailTransition] =
    useState<DetailTransitionState5 | null>(null);

  const shellRef = useRef<HTMLDivElement | null>(null);
  const detailStageRef = useRef<HTMLDivElement | null>(null);
  const posterRef = useRef<HTMLImageElement | null>(null);
  const ghostRef = useRef<HTMLImageElement | null>(null);
  const targetRectRef = useRef<PosterSourceRect5 | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const posterRevealTimeoutRef = useRef<number | null>(null);
  const crossfadeTimeoutRef = useRef<number | null>(null);
  const returnHandoffTimeoutRef = useRef<number | null>(null);
  const completeTimeoutRef = useRef<number | null>(null);
  const detailTransitionTimeoutRef = useRef<number | null>(null);
  const seenPosterSrcRef = useRef(new Set<string>());
  const swipeGestureRef = useRef<SwipeGesture5 | null>(null);
  const wheelLockUntilRef = useRef(0);
  const transitionKeyRef = useRef(0);
  const titleId = useId();

  const isDetailMounted = phase !== "collapsed";
  const detailLayout = getDetailLayout5(detailClientWidth, maxWidth);
  const displayItemIndex = detailTransition?.toItemIndex ?? detailActiveItemIndex;
  const displayMovieIndex = mod5(displayItemIndex, movieCount);
  const canNavigate =
    phase === "open" && detailTransition === null && movieCount > 1;

  const clearScheduledAnimation = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (posterRevealTimeoutRef.current !== null) {
      window.clearTimeout(posterRevealTimeoutRef.current);
      posterRevealTimeoutRef.current = null;
    }

    if (crossfadeTimeoutRef.current !== null) {
      window.clearTimeout(crossfadeTimeoutRef.current);
      crossfadeTimeoutRef.current = null;
    }

    if (returnHandoffTimeoutRef.current !== null) {
      window.clearTimeout(returnHandoffTimeoutRef.current);
      returnHandoffTimeoutRef.current = null;
    }

    if (completeTimeoutRef.current !== null) {
      window.clearTimeout(completeTimeoutRef.current);
      completeTimeoutRef.current = null;
    }
  }, []);

  const clearScheduledDetailTransition = useCallback(() => {
    if (detailTransitionTimeoutRef.current !== null) {
      window.clearTimeout(detailTransitionTimeoutRef.current);
      detailTransitionTimeoutRef.current = null;
    }
  }, []);

  const clearAllScheduledWork = useCallback(() => {
    clearScheduledAnimation();
    clearScheduledDetailTransition();
  }, [clearScheduledAnimation, clearScheduledDetailTransition]);

  const measureDetailStage = useCallback(() => {
    const stage = detailStageRef.current;
    if (!stage) {
      return 0;
    }

    const nextClientWidth = stage.clientWidth;
    setDetailClientWidth((previous) =>
      previous === nextClientWidth ? previous : nextClientWidth,
    );

    return nextClientWidth;
  }, []);

  const syncCollapsedScrollerToItem = useCallback(
    (itemIndex: number) => {
      const scroller = shellRef.current?.querySelector<HTMLElement>(
        ".movie-scroller5-collapsed",
      );
      if (!scroller) {
        return;
      }

      const nextScrollLeft = getCollapsedScrollLeftForItem5(
        itemIndex,
        scroller.clientWidth,
        cardWidth,
        gap,
      );

      if (Math.abs(scroller.scrollLeft - nextScrollLeft) > 0.5) {
        scroller.scrollLeft = nextScrollLeft;
      }
    },
    [cardWidth, gap],
  );

  const getCollapsedFallbackRect = useCallback(
    (itemIndex: number): PosterSourceRect5 => {
      const scroller = shellRef.current?.querySelector<HTMLElement>(
        ".movie-scroller5-collapsed",
      );
      const scrollerRect = scroller?.getBoundingClientRect();
      const fallbackClientWidth =
        scroller?.clientWidth ??
        (typeof window === "undefined" ? 0 : Math.min(window.innerWidth, 1100));
      const scrollLeft =
        scroller?.scrollLeft ??
        getCollapsedScrollLeftForItem5(
          itemIndex,
          fallbackClientWidth,
          cardWidth,
          gap,
        );
      const itemSpan = cardWidth + gap;
      const maxCardHeight = Math.ceil(
        cardHeight * (1 + COLLAPSED_CARD_SCALE_BOOST),
      );
      const left = gap + itemIndex * itemSpan - scrollLeft;

      return {
        top: (scrollerRect?.top ?? 0) + maxCardHeight - cardHeight,
        left: (scrollerRect?.left ?? 0) + left,
        width: cardWidth,
        height: cardHeight,
      };
    },
    [cardHeight, cardWidth, gap],
  );

  const applyRectToGhost = useCallback((rect: PosterSourceRect5) => {
    const ghost = ghostRef.current;
    if (!ghost) {
      return;
    }

    ghost.style.top = `${rect.top}px`;
    ghost.style.left = `${rect.left}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
  }, []);

  const applyGhostScrollerAppearance = useCallback(() => {
    const ghost = ghostRef.current;
    if (!ghost) {
      return;
    }

    ghost.style.borderRadius = `${SCROLLER_CARD_RADIUS_PX}px`;
    ghost.style.boxShadow = SCROLLER_CARD_SHADOW;
  }, []);

  const applyGhostFocusAppearance = useCallback(() => {
    const ghost = ghostRef.current;
    if (!ghost) {
      return;
    }

    ghost.style.borderRadius = `${FOCUS_POSTER_RADIUS_PX}px`;
    ghost.style.boxShadow = FOCUS_POSTER_SHADOW;
  }, []);

  const applyGhostOpeningAppearance = useCallback((progress: number) => {
    const ghost = ghostRef.current;
    if (!ghost) {
      return;
    }

    ghost.style.borderRadius = `${lerp5(
      SCROLLER_CARD_RADIUS_PX,
      FOCUS_POSTER_RADIUS_PX,
      progress,
    )}px`;
    ghost.style.boxShadow =
      progress < 0.44 ? SCROLLER_CARD_SHADOW : FOCUS_POSTER_SHADOW;
  }, []);

  const getCurrentPositionalOpacity = useCallback(
    (itemIndex: number, fallback: number) => {
      const item = shellRef.current?.querySelector<HTMLElement>(
        `[data-scroller3-item-index="${itemIndex}"]`,
      );
      const value = item?.dataset.scroller3PositionalOpacity;
      const parsed = value ? Number(value) : Number.NaN;

      return Number.isFinite(parsed) ? parsed : fallback;
    },
    [],
  );

  const getCurrentDestinationRect = useCallback(
    (itemIndex: number, fallback: PosterSourceRect5) => {
      const item = shellRef.current?.querySelector<HTMLElement>(
        `[data-scroller3-item-index="${itemIndex}"]`,
      );
      const rect = item?.getBoundingClientRect();

      if (!rect) {
        return getCollapsedFallbackRect(itemIndex) ?? fallback;
      }

      return {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
    },
    [getCollapsedFallbackRect],
  );

  const recenterCollapsedItemIndex = useCallback(
    (itemIndex: number) => {
      const setIndex = Math.floor(itemIndex / movieCount);
      const minSet = DETAIL5_EDGE_BUFFER_SETS;
      const maxSet = collapsedRepeatSets - DETAIL5_EDGE_BUFFER_SETS - 1;

      if (setIndex > minSet && setIndex < maxSet) {
        return itemIndex;
      }

      return collapsedMiddleStartIndex + mod5(itemIndex, movieCount);
    },
    [collapsedMiddleStartIndex, collapsedRepeatSets, movieCount],
  );

  const syncDetailViewportToFocusPosition = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const shell = shellRef.current;
      if (!shell) {
        return;
      }

      const currentScrollTop = getPageScrollTop5();
      const panelHeight = getDetailLayout5(
        measureDetailStage(),
        maxWidth,
      ).panelHeight;
      const targetScrollTop = getViewportScrollTarget5(
        shell.getBoundingClientRect().top,
        currentScrollTop,
        panelHeight,
      );

      if (Math.abs(targetScrollTop - currentScrollTop) <= 1) {
        return;
      }

      window.scrollTo({
        top: targetScrollTop,
        behavior,
      });
    },
    [maxWidth, measureDetailStage],
  );

  const handleSelectCollapsedMovie = useCallback<
    NonNullable<MovieScroller5Props["onSelectMovie"]>
  >(
    (_movie, sourceRect, itemIndex, sourceOpacity = 1) => {
      if (phase !== "collapsed" || itemIndex === undefined) {
        return;
      }

      const nextItemIndex = recenterCollapsedItemIndex(itemIndex);

      clearAllScheduledWork();
      syncCollapsedScrollerToItem(nextItemIndex);
      setCollapsedSelectedItemIndex(nextItemIndex);
      setDetailActiveItemIndex(nextItemIndex);
      setDetailTransition(null);
      setGhostTransition({
        itemIndex: nextItemIndex,
        sourceRect,
        targetRect: sourceRect,
        sourceOpacity,
        targetOpacity: sourceOpacity,
      });
      setIsFocusPosterVisible(false);
      setIsReturnHandoffReady(false);
      setShowGhost(true);
      setPhase("opening");
    },
    [clearAllScheduledWork, phase, recenterCollapsedItemIndex, syncCollapsedScrollerToItem],
  );

  const handleNavigateDetail = useCallback(
    (direction: NavigationDirection5) => {
      if (phase !== "open" || detailTransition || movieCount <= 1) {
        return;
      }

      const nextItemIndex = recenterCollapsedItemIndex(
        detailActiveItemIndex + direction,
      );

      if (nextItemIndex === detailActiveItemIndex) {
        return;
      }

      clearScheduledDetailTransition();
      transitionKeyRef.current += 1;
      const transitionKey = transitionKeyRef.current;

      setCollapsedSelectedItemIndex(nextItemIndex);
      syncCollapsedScrollerToItem(nextItemIndex);
      setDetailTransition({
        key: transitionKey,
        direction,
        fromItemIndex: detailActiveItemIndex,
        toItemIndex: nextItemIndex,
      });

      detailTransitionTimeoutRef.current = window.setTimeout(() => {
        setDetailActiveItemIndex(nextItemIndex);
        setDetailTransition((current) =>
          current?.key === transitionKey ? null : current,
        );
        detailTransitionTimeoutRef.current = null;
      }, DETAIL5_NAV_DURATION_MS);
    },
    [
      clearScheduledDetailTransition,
      detailActiveItemIndex,
      detailTransition,
      movieCount,
      phase,
      recenterCollapsedItemIndex,
      syncCollapsedScrollerToItem,
    ],
  );

  const handleRequestClose = useCallback(() => {
    if (phase !== "open" || detailTransition) {
      return;
    }

    clearAllScheduledWork();

    const returnItemIndex =
      collapsedSelectedItemIndex ?? detailActiveItemIndex;
    syncCollapsedScrollerToItem(returnItemIndex);

    const fallbackSourceRect =
      ghostTransition?.sourceRect ?? {
        top: 0,
        left: 0,
        width: cardWidth,
        height: cardHeight,
      };
    const currentPosterRect = posterRef.current?.getBoundingClientRect();
    const sourceRect = currentPosterRect
      ? {
          top: currentPosterRect.top,
          left: currentPosterRect.left,
          width: currentPosterRect.width,
          height: currentPosterRect.height,
        }
      : fallbackSourceRect;
    const targetOpacity = getCurrentPositionalOpacity(returnItemIndex, 1);
    const targetRect = getCurrentDestinationRect(
      returnItemIndex,
      getCollapsedFallbackRect(returnItemIndex),
    );

    targetRectRef.current = sourceRect;
    setGhostTransition({
      itemIndex: returnItemIndex,
      sourceRect,
      targetRect,
      sourceOpacity: 1,
      targetOpacity,
    });
    setIsReturnHandoffReady(false);
    setShowGhost(true);
    setPhase("closing");
  }, [
    cardHeight,
    cardWidth,
    clearAllScheduledWork,
    collapsedSelectedItemIndex,
    detailActiveItemIndex,
    detailTransition,
    getCollapsedFallbackRect,
    getCurrentDestinationRect,
    getCurrentPositionalOpacity,
    ghostTransition?.sourceRect,
    phase,
    syncCollapsedScrollerToItem,
  ]);

  const handleDetailWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (!canNavigate) {
        return;
      }

      const horizontalDominant =
        Math.abs(event.deltaX) > Math.abs(event.deltaY) &&
        Math.abs(event.deltaX) > 24;

      if (!horizontalDominant) {
        return;
      }

      const now = performance.now();
      if (wheelLockUntilRef.current > now) {
        return;
      }

      wheelLockUntilRef.current = now + DETAIL5_WHEEL_LOCK_MS;
      event.preventDefault();
      handleNavigateDetail(event.deltaX > 0 ? 1 : -1);
    },
    [canNavigate, handleNavigateDetail],
  );

  const handleDetailPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (
        !canNavigate ||
        event.button !== 0 ||
        isInteractiveDetailTarget5(event.target)
      ) {
        return;
      }

      swipeGestureRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [canNavigate],
  );

  const clearSwipeGesture = useCallback(
    (event?: PointerEvent<HTMLElement>) => {
      if (event && event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      swipeGestureRef.current = null;
    },
    [],
  );

  const handleDetailPointerUp = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const swipeGesture = swipeGestureRef.current;
      clearSwipeGesture(event);

      if (!swipeGesture || swipeGesture.pointerId !== event.pointerId) {
        return;
      }

      const deltaX = event.clientX - swipeGesture.startX;
      const deltaY = event.clientY - swipeGesture.startY;

      if (
        Math.abs(deltaX) < DETAIL5_SWIPE_THRESHOLD_PX ||
        Math.abs(deltaX) <= Math.abs(deltaY) * 1.25
      ) {
        return;
      }

      handleNavigateDetail(deltaX < 0 ? 1 : -1);
    },
    [clearSwipeGesture, handleNavigateDetail],
  );

  const handleDetailStageClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (
        phase !== "open" ||
        detailTransition !== null ||
        isDetailSurfaceTarget5(event.target)
      ) {
        return;
      }

      handleRequestClose();
    },
    [detailTransition, handleRequestClose, phase],
  );

  useLayoutEffect(() => {
    if (!isDetailMounted || collapsedSelectedItemIndex === null) {
      return;
    }

    syncCollapsedScrollerToItem(collapsedSelectedItemIndex);
  }, [collapsedSelectedItemIndex, isDetailMounted, syncCollapsedScrollerToItem]);

  useLayoutEffect(() => {
    if (phase !== "opening" || !ghostTransition) {
      return;
    }

    clearScheduledAnimation();
    const shell = shellRef.current;
    const ghost = ghostRef.current;
    if (!shell || !ghost) {
      return;
    }

    const openingPanelHeight = getDetailLayout5(
      measureDetailStage(),
      maxWidth,
    ).panelHeight;
    const initialScrollTop = getPageScrollTop5();
    const targetScrollTop = getViewportScrollTarget5(
      shell.getBoundingClientRect().top,
      initialScrollTop,
      openingPanelHeight,
    );
    const initialTargetRect = toPosterSourceRect5(
      posterRef.current?.getBoundingClientRect(),
      ghostTransition.sourceRect,
    );

    targetRectRef.current = initialTargetRect;

    applyRectToGhost(ghostTransition.sourceRect);
    applyGhostScrollerAppearance();
    ghost.style.opacity = `${ghostTransition.sourceOpacity}`;

    animationFrameRef.current = window.requestAnimationFrame((startTime) => {
      if (ghostRef.current) {
        ghostRef.current.style.opacity = "1";
      }

      const animateOpening = (frameTime: number) => {
        const linearProgress = clamp5(
          (frameTime - startTime) / POSTER_MOVE_DURATION_MS,
          0,
          1,
        );
        const scrollProgress = easeInOutCubic5(linearProgress);
        const ghostProgress = easeOutCubic5(linearProgress);
        const nextScrollTop = lerp5(
          initialScrollTop,
          targetScrollTop,
          scrollProgress,
        );

        window.scrollTo({
          top: nextScrollTop,
          behavior: "auto",
        });

        const liveTargetRect = toPosterSourceRect5(
          posterRef.current?.getBoundingClientRect(),
          targetRectRef.current ?? ghostTransition.sourceRect,
        );

        targetRectRef.current = liveTargetRect;
        applyRectToGhost({
          top: lerp5(
            ghostTransition.sourceRect.top,
            liveTargetRect.top,
            ghostProgress,
          ),
          left: lerp5(
            ghostTransition.sourceRect.left,
            liveTargetRect.left,
            ghostProgress,
          ),
          width: lerp5(
            ghostTransition.sourceRect.width,
            liveTargetRect.width,
            ghostProgress,
          ),
          height: lerp5(
            ghostTransition.sourceRect.height,
            liveTargetRect.height,
            ghostProgress,
          ),
        });
        applyGhostOpeningAppearance(ghostProgress);

        if (linearProgress < 1) {
          animationFrameRef.current = window.requestAnimationFrame(animateOpening);
          return;
        }

        window.scrollTo({
          top: targetScrollTop,
          behavior: "auto",
        });

        if (targetRectRef.current) {
          applyRectToGhost(targetRectRef.current);
        }
        applyGhostFocusAppearance();
        animationFrameRef.current = null;
      };

      animateOpening(startTime);
    });

    posterRevealTimeoutRef.current = window.setTimeout(() => {
      setIsFocusPosterVisible(true);
    }, FOCUS_POSTER_REVEAL_DELAY_MS);

    crossfadeTimeoutRef.current = window.setTimeout(() => {
      if (ghostRef.current) {
        ghostRef.current.style.opacity = "0";
      }
    }, GHOST_FADE_OUT_DELAY_MS);

    completeTimeoutRef.current = window.setTimeout(() => {
      setPhase("open");
      setShowGhost(false);
      completeTimeoutRef.current = null;
    }, POSTER_HANDOFF_TOTAL_MS);

    return () => {
      clearScheduledAnimation();
    };
  }, [
    applyGhostFocusAppearance,
    applyGhostOpeningAppearance,
    applyGhostScrollerAppearance,
    applyRectToGhost,
    clearScheduledAnimation,
    ghostTransition,
    maxWidth,
    measureDetailStage,
    phase,
  ]);

  useLayoutEffect(() => {
    if (phase !== "closing" || !ghostTransition) {
      return;
    }

    clearScheduledAnimation();

    const closeFromRect =
      targetRectRef.current ??
      (posterRef.current
        ? {
            top: posterRef.current.getBoundingClientRect().top,
            left: posterRef.current.getBoundingClientRect().left,
            width: posterRef.current.getBoundingClientRect().width,
            height: posterRef.current.getBoundingClientRect().height,
          }
        : ghostTransition.sourceRect);

    applyRectToGhost(closeFromRect);
    applyGhostFocusAppearance();

    if (ghostRef.current) {
      ghostRef.current.style.opacity = "1";
    }

    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = window.requestAnimationFrame(() => {
        setIsFocusPosterVisible(false);
        applyRectToGhost(ghostTransition.targetRect);
        applyGhostScrollerAppearance();
        if (ghostRef.current) {
          ghostRef.current.style.opacity = `${ghostTransition.targetOpacity}`;
        }
      });
    });

    returnHandoffTimeoutRef.current = window.setTimeout(() => {
      setIsReturnHandoffReady(true);
      setShowGhost(false);
      returnHandoffTimeoutRef.current = null;
    }, POSTER_RETURN_SETTLE_DELAY_MS);

    completeTimeoutRef.current = window.setTimeout(() => {
      setIsReturnHandoffReady(false);
      setCollapsedSelectedItemIndex(null);
      setGhostTransition(null);
      setDetailTransition(null);
      setShowGhost(false);
      setPhase("collapsed");
      completeTimeoutRef.current = null;
    }, POSTER_HANDOFF_TOTAL_MS);

    return () => {
      clearScheduledAnimation();
    };
  }, [
    applyGhostFocusAppearance,
    applyGhostScrollerAppearance,
    applyRectToGhost,
    clearScheduledAnimation,
    ghostTransition,
    phase,
  ]);

  useEffect(() => {
    if (!isDetailMounted) {
      return;
    }

    const stage = detailStageRef.current;
    if (!stage) {
      return;
    }

    const observer = new ResizeObserver(() => {
      measureDetailStage();
      if (collapsedSelectedItemIndex !== null) {
        syncCollapsedScrollerToItem(collapsedSelectedItemIndex);
      }

      if (phase === "open") {
        syncDetailViewportToFocusPosition("auto");
      }
    });

    observer.observe(stage);

    return () => {
      observer.disconnect();
    };
  }, [
    collapsedSelectedItemIndex,
    isDetailMounted,
    measureDetailStage,
    phase,
    syncCollapsedScrollerToItem,
    syncDetailViewportToFocusPosition,
  ]);

  useLayoutEffect(() => {
    if (phase !== "open") {
      return;
    }

    syncDetailViewportToFocusPosition("auto");
  }, [detailClientWidth, phase, syncDetailViewportToFocusPosition]);

  useEffect(() => {
    if (!isDetailMounted) {
      return;
    }

    const handleWindowResize = () => {
      measureDetailStage();
      if (collapsedSelectedItemIndex !== null) {
        syncCollapsedScrollerToItem(collapsedSelectedItemIndex);
      }

      if (phase === "open") {
        syncDetailViewportToFocusPosition("auto");
      }
    };

    window.addEventListener("resize", handleWindowResize);

    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [
    collapsedSelectedItemIndex,
    isDetailMounted,
    measureDetailStage,
    phase,
    syncCollapsedScrollerToItem,
    syncDetailViewportToFocusPosition,
  ]);

  useEffect(() => {
    if (!isDetailMounted) {
      return;
    }

    const preloadMovieIndexes = new Set<number>();

    for (
      let offset = -DETAIL5_PRELOAD_RADIUS;
      offset <= DETAIL5_PRELOAD_RADIUS;
      offset += 1
    ) {
      preloadMovieIndexes.add(mod5(displayMovieIndex + offset, movieCount));
    }

    preloadMovieIndexes.forEach((movieIndex) => {
      const movie = movies[movieIndex];
      const imageSources = [movie.imageSrc, movie.backdropSrc].filter(
        Boolean,
      ) as string[];

      imageSources.forEach((src) => {
        if (seenPosterSrcRef.current.has(src)) {
          return;
        }

        seenPosterSrcRef.current.add(src);
        const image = new Image();
        image.decoding = "async";
        image.src = src;
      });
    });
  }, [displayMovieIndex, isDetailMounted, movieCount]);

  useEffect(() => {
    if (phase !== "open") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleRequestClose();
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        handleNavigateDetail(1);
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        handleNavigateDetail(-1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleNavigateDetail, handleRequestClose, phase]);

  useEffect(() => {
    return () => {
      clearAllScheduledWork();
    };
  }, [clearAllScheduledWork]);

  const getCardStyle = useCallback(
    (cardState: MovieScroller5CardState) => {
      const style = buildCardOffset5(cardState, phase);

      if (
        phase === "closing" &&
        ghostTransition &&
        cardState.isSelected &&
        style
      ) {
        return isReturnHandoffReady
          ? {
              ...style,
              opacity: ghostTransition.targetOpacity,
              transition: "none",
            }
          : style;
      }

      return style;
    },
    [ghostTransition, isReturnHandoffReady, phase],
  );

  const shellClassName = [
    "movie-scroller5-shell",
    phase === "opening" ? "is-opening" : "",
    phase === "open" ? "is-open" : "",
    phase === "closing" ? "is-closing" : "",
    phase !== "collapsed" ? "is-detail-mode" : "",
    detailTransition ? "is-transitioning" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const renderDetailBody = (
    itemIndex: number,
    bodyKey: string,
    motionClassName: string,
    posterVisible: boolean,
    shouldAttachPosterRef: boolean,
  ) => {
    const movie = movies[mod5(itemIndex, movieCount)];
    const shouldAnimateBackdrop =
      phase === "opening" || motionClassName.includes("is-entering");

    return (
      <div
        key={bodyKey}
        className={["movie-scroller5-detail-body", motionClassName]
          .filter(Boolean)
          .join(" ")}
        aria-hidden={motionClassName.includes("leaving") ? "true" : undefined}
      >
        {movie.backdropSrc ? (
          <div className="movie-scroller5-detail-backdrop-shell" aria-hidden="true">
            <img
              src={movie.backdropSrc}
              alt=""
              className={`movie-scroller5-detail-backdrop${
                shouldAnimateBackdrop ? " is-animating-in" : ""
              }`}
              decoding="async"
              loading="eager"
            />
          </div>
        ) : null}

        <div className="movie-scroller5-detail-sheen" aria-hidden="true" />

        <div className="movie-scroller5-detail-content">
          <MovieDetailsContent
            movie={movie}
            posterRef={shouldAttachPosterRef ? posterRef : undefined}
            titleId={`${titleId}-${bodyKey}`}
            eyebrow="Now playing"
            posterClassName={`details-poster movie-scroller5-detail-poster${
              posterVisible ? " is-visible" : ""
            }`}
          />
        </div>
      </div>
    );
  };

  const detailBodies = detailTransition
    ? [
        renderDetailBody(
          detailTransition.fromItemIndex,
          `leave-${detailTransition.key}`,
          detailTransition.direction > 0
            ? "is-current is-leaving-to-left"
            : "is-current is-leaving-to-right",
          true,
          false,
        ),
        renderDetailBody(
          detailTransition.toItemIndex,
          `enter-${detailTransition.key}`,
          detailTransition.direction > 0
            ? "is-current is-entering-from-right"
            : "is-current is-entering-from-left",
          true,
          false,
        ),
      ]
    : [
        renderDetailBody(
          detailActiveItemIndex,
          `steady-${detailActiveItemIndex}`,
          "is-current",
          phase === "opening" ? isFocusPosterVisible : true,
          true,
        ),
      ];

  const previousPreviewMovie = movies[mod5(displayMovieIndex - 1, movieCount)];
  const nextPreviewMovie = movies[mod5(displayMovieIndex + 1, movieCount)];

  return (
    <div
      ref={shellRef}
      className={shellClassName}
      style={{
        ...movieScroller5TimingStyle,
        height: phase === "collapsed" ? collapsedHeight : detailLayout.panelHeight,
      }}
    >
      <div className="movie-scroller5-collapsed-layer" aria-hidden={isDetailMounted}>
        <MovieScrollerBase5
          cardWidth={cardWidth}
          cardHeight={cardHeight}
          gap={gap}
          maxWidth={maxWidth}
          anchorItemIndex={collapsedMiddleStartIndex}
          onSelectMovie={handleSelectCollapsedMovie}
          selectedItemIndex={
            phase === "collapsed" ? null : collapsedSelectedItemIndex
          }
          getCardStyle={getCardStyle}
          className="movie-scroller5-collapsed"
        />
      </div>

      {isDetailMounted ? (
        <div className="movie-scroller5-detail-layer">
          <div
            ref={detailStageRef}
            className="movie-scroller5-detail-stage"
            onClick={handleDetailStageClick}
            onWheel={handleDetailWheel}
          >
            {movieCount > 1 ? (
              <>
                <button
                  type="button"
                  className={`movie-scroller5-side-preview movie-scroller5-side-preview--left${
                    canNavigate ? "" : " is-disabled"
                  }`}
                  aria-label={`Show previous movie: ${previousPreviewMovie.title}`}
                  disabled={!canNavigate}
                  onClick={() => {
                    handleNavigateDetail(-1);
                  }}
                  style={{
                    top: detailLayout.previewTop,
                    left: detailLayout.previewLeft,
                    width: detailLayout.previewWidth,
                    height: detailLayout.previewHeight,
                  }}
                >
                  <img
                    src={previousPreviewMovie.imageSrc}
                    alt={previousPreviewMovie.title}
                    className="movie-scroller5-side-preview-image"
                    loading="eager"
                    decoding="async"
                    draggable={false}
                  />
                </button>

                <button
                  type="button"
                  className={`movie-scroller5-side-preview movie-scroller5-side-preview--right${
                    canNavigate ? "" : " is-disabled"
                  }`}
                  aria-label={`Show next movie: ${nextPreviewMovie.title}`}
                  disabled={!canNavigate}
                  onClick={() => {
                    handleNavigateDetail(1);
                  }}
                  style={{
                    top: detailLayout.previewTop,
                    left: detailLayout.previewRight,
                    width: detailLayout.previewWidth,
                    height: detailLayout.previewHeight,
                  }}
                >
                  <img
                    src={nextPreviewMovie.imageSrc}
                    alt={nextPreviewMovie.title}
                    className="movie-scroller5-side-preview-image"
                    loading="eager"
                    decoding="async"
                    draggable={false}
                  />
                </button>
              </>
            ) : null}

            <article
              className="movie-scroller5-detail-card"
              style={{
                width: detailLayout.panelWidth,
                height: detailLayout.panelHeight,
              }}
              aria-label={`${movies[displayMovieIndex].title} details`}
              onPointerDown={handleDetailPointerDown}
              onPointerUp={handleDetailPointerUp}
              onPointerCancel={clearSwipeGesture}
            >
              <button
                type="button"
                className="movie-scroller5-close"
                aria-label={`Close ${movies[displayMovieIndex].title} details`}
                onClick={handleRequestClose}
                disabled={phase !== "open" || detailTransition !== null}
              >
                <X size={20} strokeWidth={2.1} />
              </button>

              <div className="movie-scroller5-detail-stack">{detailBodies}</div>
            </article>
          </div>
        </div>
      ) : null}

      {showGhost && ghostTransition ? (
        <img
          ref={ghostRef}
          src={movies[mod5(ghostTransition.itemIndex, movieCount)].imageSrc}
          alt=""
          aria-hidden="true"
          className={`movie-scroller5-poster-ghost${
            phase === "opening" ? " is-opening" : ""
          }${phase === "opening" ? " is-scripted-opening" : ""}${
            phase === "closing" ? " is-closing" : ""
          }`}
          style={{
            top: ghostTransition.sourceRect.top,
            left: ghostTransition.sourceRect.left,
            width: ghostTransition.sourceRect.width,
            height: ghostTransition.sourceRect.height,
            opacity: ghostTransition.sourceOpacity,
          }}
        />
      ) : null}
    </div>
  );
}
