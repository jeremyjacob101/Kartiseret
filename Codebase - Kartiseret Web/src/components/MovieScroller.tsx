import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { X } from "lucide-react";
import { comingSoonMovies, movies, type Movie } from "../data/movieCatalog";
import {
  MovieScrollerBase,
  type MovieScrollerBaseProps,
  type MovieScrollerCardState,
  type MovieScrollerScrollRequest,
  type PosterSourceRect,
} from "./MovieScrollerBase";
import { getRepeatSetCount } from "./MovieScrollerShared";
import {
  MovieDetailsContent,
  type MovieDetailsVariant,
} from "./MovieDetailsContent";
import "./MovieScroller.css";

type FocusPhase = "collapsed" | "opening" | "open" | "closing";
type NavigationDirection = -1 | 1;

type GhostTransitionState = {
  itemIndex: number;
  sourceRect: PosterSourceRect;
  targetRect: PosterSourceRect;
  sourceOpacity: number;
  targetOpacity: number;
};

type DetailTransitionState = {
  key: number;
  direction: NavigationDirection;
  fromItemIndex: number;
  toItemIndex: number;
};

type DetailLayout = {
  panelWidth: number;
  panelHeight: number;
  previewWidth: number;
  previewHeight: number;
  previewLeft: number;
  previewRight: number;
  previewTop: number;
};

type SwipeGesture = {
  pointerId: number;
  startX: number;
  startY: number;
};

type PendingExternalJump = {
  movieIndex: number;
  behavior: ScrollBehavior;
  nonce: number;
};

export type MovieScrollerProps = MovieScrollerBaseProps & {
  mode?: MovieDetailsVariant;
  movieItems?: readonly Movie[];
  // Backward-compatible alias for previous API naming.
  detailVariant?: MovieDetailsVariant;
  detailEyebrow?: string;
  jumpRequest?: MovieScrollerJumpRequest | null;
};

type MovieScrollerContentProps = MovieScrollerBaseProps & {
  movieItems: readonly Movie[];
  detailVariant: MovieDetailsVariant;
  detailEyebrow: string;
  jumpRequest?: MovieScrollerJumpRequest | null;
};

export type MovieScrollerJumpRequest = {
  tmdbId: string;
  nonce: number;
  behavior?: ScrollBehavior;
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
const DETAIL_PRELOAD_RADIUS = 2;
const DETAIL_EDGE_BUFFER_SETS = 1;
const DETAIL_NAV_DURATION_MS = 360;
const DETAIL_FOCUS_VIEWPORT_PADDING_PX = 28;
const DETAIL_WHEEL_LOCK_MS = 420;
const DETAIL_SWIPE_THRESHOLD_PX = 56;
const COLLAPSED_CARD_SCALE_BOOST = 0.15;
const EXTERNAL_JUMP_RUFFLE_DURATION_MS = 440;
const EXTERNAL_JUMP_VIEWPORT_MIN_TOP_PX = 88;
const EXTERNAL_JUMP_VIEWPORT_MAX_TOP_PX = 140;
const EXTERNAL_JUMP_VIEWPORT_EDGE_PX = 72;

const movieScrollerTimingStyle = {
  "--movie-scroller-stage-fade-duration": `${FOCUS_STAGE_FADE_DURATION_MS}ms`,
  "--movie-scroller-stage-close-delay": `${CLOSE_STAGE_FADE_DELAY_MS}ms`,
  "--movie-scroller-focus-poster-fade-duration": `${FOCUS_POSTER_FADE_DURATION_MS}ms`,
  "--movie-scroller-ghost-move-duration": `${POSTER_MOVE_DURATION_MS}ms`,
  "--movie-scroller-ghost-opacity-duration": `${POSTER_GHOST_OPACITY_DURATION_MS}ms`,
  "--movie-scroller-detail-swap-duration": `${DETAIL_NAV_DURATION_MS}ms`,
} as CSSProperties;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function mod(value: number, size: number): number {
  const remainder = value % size;
  return remainder < 0 ? remainder + size : remainder;
}

function easeOutCubic(value: number): number {
  return 1 - (1 - value) ** 3;
}

function easeInOutCubic(value: number): number {
  return value < 0.5
    ? 4 * value ** 3
    : 1 - ((-2 * value + 2) ** 3) / 2;
}

function easeInQuad(value: number): number {
  return value ** 2;
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function toPosterSourceRect(
  rect: Pick<DOMRect, "top" | "left" | "width" | "height"> | null | undefined,
  fallback: PosterSourceRect,
): PosterSourceRect {
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

function getPageScrollTop(): number {
  return window.scrollY || window.pageYOffset || 0;
}

function getMaxPageScrollTop(): number {
  const scrollRoot = document.scrollingElement ?? document.documentElement;
  return Math.max(0, scrollRoot.scrollHeight - window.innerHeight);
}

function getTargetDetailViewportTop(panelHeight: number): number {
  const paddedViewportHeight = Math.max(
    0,
    window.innerHeight - DETAIL_FOCUS_VIEWPORT_PADDING_PX * 2,
  );
  const centeredHeight = Math.min(panelHeight, paddedViewportHeight);

  return Math.max(
    DETAIL_FOCUS_VIEWPORT_PADDING_PX,
    (window.innerHeight - centeredHeight) / 2,
  );
}

function getViewportScrollTarget(
  shellTop: number,
  currentScrollTop: number,
  panelHeight: number,
): number {
  return clamp(
    currentScrollTop + shellTop - getTargetDetailViewportTop(panelHeight),
    0,
    getMaxPageScrollTop(),
  );
}

function getCollapsedViewportScrollTarget(
  shellTop: number,
  currentScrollTop: number,
): number {
  const targetViewportTop = clamp(
    window.innerHeight * 0.18,
    EXTERNAL_JUMP_VIEWPORT_MIN_TOP_PX,
    EXTERNAL_JUMP_VIEWPORT_MAX_TOP_PX,
  );

  return clamp(
    currentScrollTop + shellTop - targetViewportTop,
    0,
    getMaxPageScrollTop(),
  );
}

function buildCardOffset(
  cardState: MovieScrollerCardState,
  phase: FocusPhase,
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

function getMaxWidthValue(
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

function getDetailLayout(
  clientWidth: number,
  maxWidth: number | string,
): DetailLayout {
  const viewportFallback =
    typeof window === "undefined" ? 1440 : Math.max(window.innerWidth, 960);
  const safeClientWidth = Math.max(clientWidth || viewportFallback, 360);
  const maxWidthValue = getMaxWidthValue(maxWidth, safeClientWidth);
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
  const previewWidth = clamp(
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

function getCollapsedFocusViewportCenter(
  clientWidth: number,
  cardWidth: number,
  itemSpan: number,
  gap: number,
): number {
  const desiredCenter = clientWidth / 2 - itemSpan;
  const minimumCenter = gap + cardWidth / 2;
  const maximumCenter = Math.max(minimumCenter, clientWidth - gap - cardWidth / 2);

  return clamp(desiredCenter, minimumCenter, maximumCenter);
}

function getCollapsedScrollLeftForItem(
  itemIndex: number,
  clientWidth: number,
  cardWidth: number,
  gap: number,
): number {
  const itemSpan = cardWidth + gap;
  const focusViewportCenter = getCollapsedFocusViewportCenter(
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

function getCollapsedAnchorItemIndexFromScrollLeft(
  scrollLeft: number,
  clientWidth: number,
  cardWidth: number,
  gap: number,
  totalItems: number,
): number {
  const itemSpan = cardWidth + gap;
  const focusViewportCenter = getCollapsedFocusViewportCenter(
    clientWidth,
    cardWidth,
    itemSpan,
    gap,
  );
  const centeredItemIndex = Math.round(
    (Math.max(scrollLeft, 0) + focusViewportCenter - cardWidth / 2 - gap) /
      itemSpan,
  );

  return clamp(centeredItemIndex, 0, Math.max(totalItems - 1, 0));
}

function getDirectionalDistance(value: number): number {
  return Math.max(value, 1);
}

function isInteractiveDetailTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest(
      "button, a, input, textarea, select, summary, [role='button']",
    ),
  );
}

function isDetailSurfaceTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest(".movie-scroller-detail-card, .movie-scroller-side-preview"),
  );
}

function isNavbarInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest(
      ".topbar button, " +
        ".topbar a, " +
        ".topbar input, " +
        ".topbar textarea, " +
        ".topbar select, " +
        ".topbar summary, " +
        ".topbar [role='button'], " +
        ".topbar [role='dialog'], " +
        ".topbar [role='menu'], " +
        ".topbar [role='menuitem'], " +
        ".topbar [role='tab'], " +
        ".topbar [role='tablist']",
    ),
  );
}

export function MovieScroller({
  mode,
  movieItems,
  detailVariant,
  detailEyebrow,
  jumpRequest,
  ...props
}: MovieScrollerProps) {
  const resolvedVariant = mode ?? detailVariant ?? "nowPlaying";
  const resolvedMovieItems =
    movieItems ??
    (resolvedVariant === "comingSoon" ? comingSoonMovies : movies);

  if (resolvedMovieItems.length === 0) {
    return null;
  }

  return (
    <MovieScrollerContent
      {...props}
      movieItems={resolvedMovieItems}
      detailVariant={resolvedVariant}
      jumpRequest={jumpRequest}
      detailEyebrow={
        detailEyebrow ??
        (resolvedVariant === "comingSoon" ? "Coming soon" : "Now playing")
      }
    />
  );
}

function MovieScrollerContent({
  movieItems,
  detailVariant,
  detailEyebrow,
  jumpRequest,
  cardWidth = 240,
  cardHeight = 360,
  gap = 16,
  maxWidth = "100%",
  className,
}: MovieScrollerContentProps) {
  const movieCount = movieItems.length;
  const collapsedRepeatSets = getRepeatSetCount(cardWidth + gap, movieCount);
  const collapsedMiddleStartIndex =
    Math.floor(collapsedRepeatSets / 2) * movieCount;
  const collapsedHeight = Math.ceil(
    cardHeight * (1 + COLLAPSED_CARD_SCALE_BOOST),
  );

  const [phase, setPhase] = useState<FocusPhase>("collapsed");
  const [collapsedAnchorItemIndex, setCollapsedAnchorItemIndex] = useState(
    collapsedMiddleStartIndex,
  );
  const [collapsedSelectedItemIndex, setCollapsedSelectedItemIndex] = useState<
    number | null
  >(null);
  const [collapsedScrollRequest, setCollapsedScrollRequest] =
    useState<MovieScrollerScrollRequest | null>(null);
  const [detailActiveItemIndex, setDetailActiveItemIndex] = useState(
    collapsedMiddleStartIndex,
  );
  const [detailClientWidth, setDetailClientWidth] = useState(0);
  const [isFocusPosterVisible, setIsFocusPosterVisible] = useState(false);
  const [showGhost, setShowGhost] = useState(false);
  const [isReturnHandoffReady, setIsReturnHandoffReady] = useState(false);
  const [ghostTransition, setGhostTransition] =
    useState<GhostTransitionState | null>(null);
  const [detailTransition, setDetailTransition] =
    useState<DetailTransitionState | null>(null);

  const shellRef = useRef<HTMLDivElement | null>(null);
  const detailStageRef = useRef<HTMLDivElement | null>(null);
  const posterRef = useRef<HTMLImageElement | null>(null);
  const ghostRef = useRef<HTMLImageElement | null>(null);
  const targetRectRef = useRef<PosterSourceRect | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const scriptedJumpAnimationFrameRef = useRef<number | null>(null);
  const posterRevealTimeoutRef = useRef<number | null>(null);
  const crossfadeTimeoutRef = useRef<number | null>(null);
  const returnHandoffTimeoutRef = useRef<number | null>(null);
  const completeTimeoutRef = useRef<number | null>(null);
  const detailTransitionTimeoutRef = useRef<number | null>(null);
  const seenPosterSrcRef = useRef(new Set<string>());
  const swipeGestureRef = useRef<SwipeGesture | null>(null);
  const wheelLockUntilRef = useRef(0);
  const transitionKeyRef = useRef(0);
  const pendingViewportBehaviorRef = useRef<ScrollBehavior | null>(null);
  const pendingExternalJumpRef = useRef<PendingExternalJump | null>(null);
  const handledExternalJumpNonceRef = useRef<number | null>(null);
  const collapsedOpenScrollLeftRef = useRef<number | null>(null);
  const collapsedOpenClientWidthRef = useRef<number | null>(null);
  const collapsedOpenAnchorItemIndexRef = useRef<number | null>(null);
  const scrollRequestNonceRef = useRef(0);
  const titleId = useId();

  const isDetailMounted = phase !== "collapsed";
  const detailLayout = getDetailLayout(detailClientWidth, maxWidth);
  const displayItemIndex = detailTransition?.toItemIndex ?? detailActiveItemIndex;
  const displayMovieIndex = mod(displayItemIndex, movieCount);
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

  const clearScheduledExternalJump = useCallback(() => {
    if (scriptedJumpAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(scriptedJumpAnimationFrameRef.current);
      scriptedJumpAnimationFrameRef.current = null;
    }
  }, []);

  const clearAllScheduledWork = useCallback(() => {
    clearScheduledAnimation();
    clearScheduledDetailTransition();
    clearScheduledExternalJump();
  }, [
    clearScheduledAnimation,
    clearScheduledDetailTransition,
    clearScheduledExternalJump,
  ]);

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

  const getCollapsedFallbackPresentation = useCallback(
    (itemIndex: number) => {
      const scroller = shellRef.current?.querySelector<HTMLElement>(
        ".movie-scroller-collapsed",
      );
      const scrollerRect = scroller?.getBoundingClientRect();
      const fallbackClientWidth =
        scroller?.clientWidth ??
        collapsedOpenClientWidthRef.current ??
        (typeof window === "undefined" ? 0 : Math.min(window.innerWidth, 1100));
      const scrollLeft =
        scroller?.scrollLeft ??
        collapsedOpenScrollLeftRef.current ??
        getCollapsedScrollLeftForItem(
          itemIndex,
          fallbackClientWidth,
          cardWidth,
          gap,
        );
      const itemSpan = cardWidth + gap;
      const maxCardHeight = Math.ceil(
        cardHeight * (1 + COLLAPSED_CARD_SCALE_BOOST),
      );
      const focusViewportCenter = getCollapsedFocusViewportCenter(
        fallbackClientWidth,
        cardWidth,
        itemSpan,
        gap,
      );
      const focusTrackCenter = scrollLeft + focusViewportCenter;
      const fullOpacityRadius =
        fallbackClientWidth > 0
          ? clamp(fallbackClientWidth * 0.12, 52, 96)
          : 96;
      const fadeEndDistance =
        fallbackClientWidth > 0
          ? Math.max(fallbackClientWidth / 2 + cardWidth * 0.5, cardWidth)
          : cardWidth;
      const focusPlateau = Math.max(itemSpan * 0.16, 28);
      const waveRadius = Math.max(itemSpan * 1.8, cardWidth * 1.55);
      const leftFadeEndDistance = getDirectionalDistance(
        Math.max(fadeEndDistance * 0.56, focusViewportCenter + cardWidth * 0.32),
      );
      const rightFadeEndDistance = getDirectionalDistance(
        Math.max(
          fadeEndDistance * 1.48,
          fallbackClientWidth - focusViewportCenter + cardWidth * 0.72,
        ),
      );
      const leftWaveRadius = getDirectionalDistance(
        Math.max(waveRadius * 0.72, itemSpan * 1.18),
      );
      const rightWaveRadius = getDirectionalDistance(
        Math.max(waveRadius * 1.72, itemSpan * 3.2),
      );
      const trackLeft = gap + itemIndex * itemSpan;
      const cardCenter = trackLeft + cardWidth / 2;
      const signedDistanceFromFocus = cardCenter - focusTrackCenter;
      const distanceFromCenter = Math.abs(signedDistanceFromFocus);
      const directionalFadeEndDistance =
        signedDistanceFromFocus < 0 ? leftFadeEndDistance : rightFadeEndDistance;
      const fadeProgress =
        directionalFadeEndDistance > fullOpacityRadius
          ? clamp(
              (distanceFromCenter - fullOpacityRadius) /
                (directionalFadeEndDistance - fullOpacityRadius),
              0,
              1,
            )
          : 1;
      const opacity =
        fallbackClientWidth > 0 ? 1 - easeInQuad(fadeProgress) : 1;
      const directionalWaveRadius =
        signedDistanceFromFocus < 0 ? leftWaveRadius : rightWaveRadius;
      const waveProgress =
        fallbackClientWidth > 0 && directionalWaveRadius > focusPlateau
          ? clamp(
              1 -
                Math.max(distanceFromCenter - focusPlateau, 0) /
                  (directionalWaveRadius - focusPlateau),
              0,
              1,
            )
          : 0;
      const waveLift = Math.sin((waveProgress * Math.PI) / 2);
      const scale = 1 + COLLAPSED_CARD_SCALE_BOOST * waveLift;
      const scaledWidth = cardWidth * scale;
      const scaledHeight = cardHeight * scale;
      const screenLeft =
        (scrollerRect?.left ?? 0) +
        (trackLeft - scrollLeft) -
        (scaledWidth - cardWidth) / 2;

      return {
        sourceRect: {
          top: (scrollerRect?.top ?? 0) + maxCardHeight - scaledHeight,
          left: screenLeft,
          width: scaledWidth,
          height: scaledHeight,
        } satisfies PosterSourceRect,
        sourceOpacity: opacity,
      };
    },
    [cardHeight, cardWidth, gap],
  );

  const applyRectToGhost = useCallback((rect: PosterSourceRect) => {
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

    ghost.style.borderRadius = `${lerp(
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
        `[data-movie-scroller-item-index="${itemIndex}"]`,
      );
      const value = item?.dataset.movieScrollerPositionalOpacity;
      const parsed = value ? Number(value) : Number.NaN;

      return Number.isFinite(parsed) ? parsed : fallback;
    },
    [],
  );

  const getCollapsedScrollerElement = useCallback(
    () =>
      shellRef.current?.querySelector<HTMLElement>(".movie-scroller-collapsed") ??
      null,
    [],
  );

  const getCollapsedItemElement = useCallback(
    (itemIndex: number) =>
      shellRef.current?.querySelector<HTMLElement>(
        `[data-movie-scroller-item-index="${itemIndex}"]`,
      ) ?? null,
    [],
  );

  const getCollapsedItemSource = useCallback(
    (itemIndex: number) => {
      const fallbackPresentation = getCollapsedFallbackPresentation(itemIndex);
      const fallbackRect = fallbackPresentation.sourceRect;
      const item = getCollapsedItemElement(itemIndex);

      return {
        sourceRect: toPosterSourceRect(item?.getBoundingClientRect(), fallbackRect),
        sourceOpacity: getCurrentPositionalOpacity(
          itemIndex,
          fallbackPresentation.sourceOpacity,
        ),
      };
    },
    [
      getCollapsedFallbackPresentation,
      getCollapsedItemElement,
      getCurrentPositionalOpacity,
    ],
  );

  const captureCollapsedViewportSnapshot = useCallback(() => {
    const scroller = getCollapsedScrollerElement();

    if (!scroller) {
      collapsedOpenScrollLeftRef.current = null;
      collapsedOpenClientWidthRef.current = null;
      collapsedOpenAnchorItemIndexRef.current = collapsedAnchorItemIndex;
      return;
    }

    collapsedOpenScrollLeftRef.current = scroller.scrollLeft;
    collapsedOpenClientWidthRef.current = scroller.clientWidth;
    collapsedOpenAnchorItemIndexRef.current = getCollapsedAnchorItemIndexFromScrollLeft(
      scroller.scrollLeft,
      scroller.clientWidth,
      cardWidth,
      gap,
      collapsedRepeatSets * movieCount,
    );
  }, [
    cardWidth,
    collapsedAnchorItemIndex,
    collapsedRepeatSets,
    gap,
    getCollapsedScrollerElement,
    movieCount,
  ]);

  const restoreCollapsedViewportSnapshot = useCallback(() => {
    const savedAnchorItemIndex = collapsedOpenAnchorItemIndexRef.current;
    const savedScrollLeft = collapsedOpenScrollLeftRef.current;

    if (savedAnchorItemIndex !== null) {
      setCollapsedAnchorItemIndex(savedAnchorItemIndex);
    }

    if (savedScrollLeft === null) {
      return;
    }

    const scroller = getCollapsedScrollerElement();

    if (scroller && Math.abs(scroller.scrollLeft - savedScrollLeft) > 0.5) {
      scroller.scrollLeft = savedScrollLeft;
    }

    scrollRequestNonceRef.current += 1;
    setCollapsedScrollRequest({
      scrollLeft: savedScrollLeft,
      nonce: scrollRequestNonceRef.current,
    });
  }, [getCollapsedScrollerElement]);

  const recenterCollapsedItemIndex = useCallback(
    (itemIndex: number) => {
      const setIndex = Math.floor(itemIndex / movieCount);
      const minSet = DETAIL_EDGE_BUFFER_SETS;
      const maxSet = collapsedRepeatSets - DETAIL_EDGE_BUFFER_SETS - 1;

      if (setIndex > minSet && setIndex < maxSet) {
        return itemIndex;
      }

      return collapsedMiddleStartIndex + mod(itemIndex, movieCount);
    },
    [collapsedMiddleStartIndex, collapsedRepeatSets, movieCount],
  );

  const beginCollapsedMovieOpen = useCallback(
    (itemIndex: number, sourceRect: PosterSourceRect, sourceOpacity = 1) => {
      if (phase !== "collapsed") {
        return;
      }

      const detailItemIndex = recenterCollapsedItemIndex(itemIndex);

      clearAllScheduledWork();
      captureCollapsedViewportSnapshot();
      swipeGestureRef.current = null;
      targetRectRef.current = null;
      setCollapsedScrollRequest(null);
      setCollapsedAnchorItemIndex(itemIndex);
      setCollapsedSelectedItemIndex(itemIndex);
      setDetailActiveItemIndex(detailItemIndex);
      setDetailTransition(null);
      setGhostTransition({
        itemIndex,
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
    [
      captureCollapsedViewportSnapshot,
      clearAllScheduledWork,
      phase,
      recenterCollapsedItemIndex,
    ],
  );

  const syncDetailViewportToFocusPosition = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const shell = shellRef.current;
      if (!shell) {
        return;
      }

      const currentScrollTop = getPageScrollTop();
      const panelHeight = getDetailLayout(
        measureDetailStage(),
        maxWidth,
      ).panelHeight;
      const targetScrollTop = getViewportScrollTarget(
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

  const finalizeExternalMovieOpen = useCallback(
    (itemIndex: number) => {
      setCollapsedAnchorItemIndex(itemIndex);
      scriptedJumpAnimationFrameRef.current = window.requestAnimationFrame(() => {
        scriptedJumpAnimationFrameRef.current = null;
        const { sourceRect, sourceOpacity } = getCollapsedItemSource(itemIndex);
        beginCollapsedMovieOpen(itemIndex, sourceRect, sourceOpacity);
      });
    },
    [beginCollapsedMovieOpen, getCollapsedItemSource],
  );

  const openMovieFromExternalRequest = useCallback(
    (movieIndex: number, behavior: ScrollBehavior = "smooth") => {
      const itemIndex = collapsedMiddleStartIndex + mod(movieIndex, movieCount);
      const prefersReducedMotion =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const shouldAnimateTravel =
        behavior !== "auto" && !prefersReducedMotion;
      const scroller = getCollapsedScrollerElement();
      const shellRect = shellRef.current?.getBoundingClientRect() ?? null;
      const currentScrollTop = getPageScrollTop();
      const shouldAnimatePage =
        shellRect !== null &&
        (shellRect.top < EXTERNAL_JUMP_VIEWPORT_EDGE_PX ||
          shellRect.bottom > window.innerHeight - EXTERNAL_JUMP_VIEWPORT_EDGE_PX);

      clearAllScheduledWork();
      swipeGestureRef.current = null;
      pendingViewportBehaviorRef.current = behavior;
      setDetailTransition(null);
      setGhostTransition(null);
      setCollapsedScrollRequest(null);
      setCollapsedSelectedItemIndex(null);
      setIsFocusPosterVisible(false);
      setIsReturnHandoffReady(false);
      setShowGhost(false);

      if (!shouldAnimateTravel || !scroller || scroller.clientWidth <= 0) {
        finalizeExternalMovieOpen(itemIndex);
        return;
      }

      const targetScrollLeft = getCollapsedScrollLeftForItem(
        itemIndex,
        scroller.clientWidth,
        cardWidth,
        gap,
      );
      const initialScrollLeft = scroller.scrollLeft;
      const targetScrollTop =
        shellRect === null || !shouldAnimatePage
          ? currentScrollTop
          : getCollapsedViewportScrollTarget(shellRect.top, currentScrollTop);

      if (
        Math.abs(initialScrollLeft - targetScrollLeft) <= 1 &&
        Math.abs(currentScrollTop - targetScrollTop) <= 1
      ) {
        finalizeExternalMovieOpen(itemIndex);
        return;
      }

      scriptedJumpAnimationFrameRef.current = window.requestAnimationFrame(
        (startTime) => {
          const animateTravel = (frameTime: number) => {
            const progress = clamp(
              (frameTime - startTime) / EXTERNAL_JUMP_RUFFLE_DURATION_MS,
              0,
              1,
            );
            const easedProgress = easeInOutCubic(progress);

            scroller.scrollLeft = lerp(
              initialScrollLeft,
              targetScrollLeft,
              easedProgress,
            );

            if (shouldAnimatePage) {
              window.scrollTo({
                top: lerp(currentScrollTop, targetScrollTop, easedProgress),
                behavior: "auto",
              });
            }

            if (progress < 1) {
              scriptedJumpAnimationFrameRef.current =
                window.requestAnimationFrame(animateTravel);
              return;
            }

            scroller.scrollLeft = targetScrollLeft;

            if (shouldAnimatePage) {
              window.scrollTo({
                top: targetScrollTop,
                behavior: "auto",
              });
            }

            scriptedJumpAnimationFrameRef.current = null;
            finalizeExternalMovieOpen(itemIndex);
          };

          animateTravel(startTime);
        },
      );
    },
    [
      cardWidth,
      clearAllScheduledWork,
      collapsedMiddleStartIndex,
      finalizeExternalMovieOpen,
      gap,
      getCollapsedScrollerElement,
      movieCount,
    ],
  );

  const handleSelectCollapsedMovie = useCallback<
    NonNullable<MovieScrollerProps["onSelectMovie"]>
  >(
    (_movie, sourceRect, itemIndex, sourceOpacity = 1) => {
      if (itemIndex === undefined) {
        return;
      }

      beginCollapsedMovieOpen(itemIndex, sourceRect, sourceOpacity);
    },
    [beginCollapsedMovieOpen],
  );

  const handleNavigateDetail = useCallback(
    (direction: NavigationDirection) => {
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
      }, DETAIL_NAV_DURATION_MS);
    },
    [
      clearScheduledDetailTransition,
      detailActiveItemIndex,
      detailTransition,
      movieCount,
      phase,
      recenterCollapsedItemIndex,
    ],
  );

  const handleRequestClose = useCallback(() => {
    if (phase !== "open" || detailTransition) {
      return;
    }

    clearAllScheduledWork();
    restoreCollapsedViewportSnapshot();

    const returnItemIndex =
      collapsedSelectedItemIndex ?? ghostTransition?.itemIndex ?? detailActiveItemIndex;

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
    const targetPresentation = getCollapsedFallbackPresentation(returnItemIndex);
    const targetOpacity = targetPresentation.sourceOpacity;
    const targetRect = targetPresentation.sourceRect;

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
    getCollapsedFallbackPresentation,
    ghostTransition?.itemIndex,
    ghostTransition?.sourceRect,
    phase,
    restoreCollapsedViewportSnapshot,
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

      wheelLockUntilRef.current = now + DETAIL_WHEEL_LOCK_MS;
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
        isInteractiveDetailTarget(event.target)
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
        Math.abs(deltaX) < DETAIL_SWIPE_THRESHOLD_PX ||
        Math.abs(deltaX) <= Math.abs(deltaY) * 1.25
      ) {
        return;
      }

      handleNavigateDetail(deltaX < 0 ? 1 : -1);
    },
    [clearSwipeGesture, handleNavigateDetail],
  );

  useEffect(() => {
    if (phase !== "open") {
      return;
    }

    const handleWindowPointerDown = (event: globalThis.PointerEvent) => {
      if (event.button !== 0) {
        return;
      }

      const target = event.target;

      if (
        isDetailSurfaceTarget(target) ||
        isNavbarInteractiveTarget(target)
      ) {
        return;
      }

      if (event.cancelable) {
        event.preventDefault();
      }

      handleRequestClose();
    };

    window.addEventListener("pointerdown", handleWindowPointerDown, true);

    return () => {
      window.removeEventListener("pointerdown", handleWindowPointerDown, true);
    };
  }, [handleRequestClose, phase]);

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

    const openingPanelHeight = getDetailLayout(
      measureDetailStage(),
      maxWidth,
    ).panelHeight;
    const initialScrollTop = getPageScrollTop();
    const targetScrollTop = getViewportScrollTarget(
      shell.getBoundingClientRect().top,
      initialScrollTop,
      openingPanelHeight,
    );
    const initialTargetRect = toPosterSourceRect(
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
        const linearProgress = clamp(
          (frameTime - startTime) / POSTER_MOVE_DURATION_MS,
          0,
          1,
        );
        const scrollProgress = easeInOutCubic(linearProgress);
        const ghostProgress = easeOutCubic(linearProgress);
        const nextScrollTop = lerp(
          initialScrollTop,
          targetScrollTop,
          scrollProgress,
        );

        window.scrollTo({
          top: nextScrollTop,
          behavior: "auto",
        });

        const liveTargetRect = toPosterSourceRect(
          posterRef.current?.getBoundingClientRect(),
          targetRectRef.current ?? ghostTransition.sourceRect,
        );

        targetRectRef.current = liveTargetRect;
        applyRectToGhost({
          top: lerp(
            ghostTransition.sourceRect.top,
            liveTargetRect.top,
            ghostProgress,
          ),
          left: lerp(
            ghostTransition.sourceRect.left,
            liveTargetRect.left,
            ghostProgress,
          ),
          width: lerp(
            ghostTransition.sourceRect.width,
            liveTargetRect.width,
            ghostProgress,
          ),
          height: lerp(
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
      if (phase === "open") {
        syncDetailViewportToFocusPosition("auto");
      }
    });

    observer.observe(stage);

    return () => {
      observer.disconnect();
    };
  }, [
    isDetailMounted,
    measureDetailStage,
    phase,
    syncDetailViewportToFocusPosition,
  ]);

  useLayoutEffect(() => {
    if (phase !== "open") {
      return;
    }

    const behavior = pendingViewportBehaviorRef.current ?? "auto";
    pendingViewportBehaviorRef.current = null;
    syncDetailViewportToFocusPosition(behavior);
  }, [
    detailActiveItemIndex,
    detailClientWidth,
    phase,
    syncDetailViewportToFocusPosition,
  ]);

  useEffect(() => {
    if (!jumpRequest) {
      return;
    }

    const movieIndex = movieItems.findIndex(
      (movie) => movie.tmdbId === jumpRequest.tmdbId,
    );

    if (movieIndex === -1) {
      return;
    }

    if (handledExternalJumpNonceRef.current === jumpRequest.nonce) {
      return;
    }

    handledExternalJumpNonceRef.current = jumpRequest.nonce;
    pendingExternalJumpRef.current = {
      movieIndex,
      behavior: jumpRequest.behavior ?? "smooth",
      nonce: jumpRequest.nonce,
    };

    if (phase === "collapsed") {
      const pendingJump = pendingExternalJumpRef.current;
      pendingExternalJumpRef.current = null;

      if (pendingJump) {
        openMovieFromExternalRequest(
          pendingJump.movieIndex,
          pendingJump.behavior,
        );
      }
      return;
    }

    if (phase === "open") {
      handleRequestClose();
    }
  }, [
    handleRequestClose,
    jumpRequest,
    movieItems,
    openMovieFromExternalRequest,
    phase,
  ]);

  useEffect(() => {
    const pendingJump = pendingExternalJumpRef.current;
    if (!pendingJump) {
      return;
    }

    if (phase === "collapsed") {
      pendingExternalJumpRef.current = null;
      openMovieFromExternalRequest(pendingJump.movieIndex, pendingJump.behavior);
      return;
    }

    if (phase === "open") {
      handleRequestClose();
    }
  }, [handleRequestClose, openMovieFromExternalRequest, phase]);

  useEffect(() => {
    if (!isDetailMounted) {
      return;
    }

    const handleWindowResize = () => {
      measureDetailStage();
      if (phase === "open") {
        syncDetailViewportToFocusPosition("auto");
      }
    };

    window.addEventListener("resize", handleWindowResize);

    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [
    isDetailMounted,
    measureDetailStage,
    phase,
    syncDetailViewportToFocusPosition,
  ]);

  useEffect(() => {
    if (!isDetailMounted) {
      return;
    }

    const preloadMovieIndexes = new Set<number>();

    for (
      let offset = -DETAIL_PRELOAD_RADIUS;
      offset <= DETAIL_PRELOAD_RADIUS;
      offset += 1
    ) {
      preloadMovieIndexes.add(mod(displayMovieIndex + offset, movieCount));
    }

    preloadMovieIndexes.forEach((movieIndex) => {
      const movie = movieItems[movieIndex];
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
  }, [displayMovieIndex, isDetailMounted, movieCount, movieItems]);

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
    (cardState: MovieScrollerCardState) => {
      const style = buildCardOffset(cardState, phase);

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
    "movie-scroller-shell",
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
    const movie = movieItems[mod(itemIndex, movieCount)];
    const shouldAnimateBackdrop =
      phase === "opening" || motionClassName.includes("is-entering");

    return (
      <div
        key={bodyKey}
        className={["movie-scroller-detail-body", motionClassName]
          .filter(Boolean)
          .join(" ")}
        aria-hidden={motionClassName.includes("leaving") ? "true" : undefined}
      >
        {movie.backdropSrc ? (
          <div className="movie-scroller-detail-backdrop-shell" aria-hidden="true">
            <img
              src={movie.backdropSrc}
              alt=""
              className={`movie-scroller-detail-backdrop${
                shouldAnimateBackdrop ? " is-animating-in" : ""
              }`}
              decoding="async"
              loading="eager"
            />
          </div>
        ) : null}

        <div className="movie-scroller-detail-sheen" aria-hidden="true" />

        <div className="movie-scroller-detail-content">
          <MovieDetailsContent
            movie={movie}
            posterRef={shouldAttachPosterRef ? posterRef : undefined}
            titleId={`${titleId}-${bodyKey}`}
            eyebrow={detailEyebrow}
            variant={detailVariant}
            posterClassName={`details-poster movie-scroller-detail-poster${
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

  const previousPreviewMovie = movieItems[mod(displayMovieIndex - 1, movieCount)];
  const nextPreviewMovie = movieItems[mod(displayMovieIndex + 1, movieCount)];

  return (
    <div
      ref={shellRef}
      className={shellClassName}
      style={{
        ...movieScrollerTimingStyle,
        height: phase === "collapsed" ? collapsedHeight : detailLayout.panelHeight,
      }}
    >
      <div className="movie-scroller-collapsed-layer" aria-hidden={isDetailMounted}>
        <MovieScrollerBase
          movieItems={movieItems}
          cardWidth={cardWidth}
          cardHeight={cardHeight}
          gap={gap}
          maxWidth={maxWidth}
          anchorItemIndex={collapsedAnchorItemIndex}
          scrollRequest={collapsedScrollRequest}
          onSelectMovie={handleSelectCollapsedMovie}
          selectedItemIndex={
            phase === "collapsed" ? null : collapsedSelectedItemIndex
          }
          getCardStyle={getCardStyle}
          className="movie-scroller-collapsed"
        />
      </div>

      {isDetailMounted ? (
        <div className="movie-scroller-detail-layer">
          <div
            ref={detailStageRef}
            className="movie-scroller-detail-stage"
            onWheel={handleDetailWheel}
          >
            {movieCount > 1 ? (
              <>
                <div
                  className={`movie-scroller-side-preview movie-scroller-side-preview--left${
                    canNavigate ? "" : " is-disabled"
                  }`}
                  onClick={() => {
                    if (!canNavigate) {
                      return;
                    }

                    handleNavigateDetail(-1);
                  }}
                  style={{
                    top: detailLayout.previewTop,
                    left: detailLayout.previewLeft,
                    width: detailLayout.previewWidth,
                    height: detailLayout.previewHeight,
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <img
                    src={previousPreviewMovie.imageSrc}
                    alt={previousPreviewMovie.title}
                    className="movie-scroller-side-preview-image"
                    loading="eager"
                    decoding="async"
                    draggable={false}
                  />
                </div>

                <div
                  className={`movie-scroller-side-preview movie-scroller-side-preview--right${
                    canNavigate ? "" : " is-disabled"
                  }`}
                  onClick={() => {
                    if (!canNavigate) {
                      return;
                    }

                    handleNavigateDetail(1);
                  }}
                  style={{
                    top: detailLayout.previewTop,
                    left: detailLayout.previewRight,
                    width: detailLayout.previewWidth,
                    height: detailLayout.previewHeight,
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <img
                    src={nextPreviewMovie.imageSrc}
                    alt={nextPreviewMovie.title}
                    className="movie-scroller-side-preview-image"
                    loading="eager"
                    decoding="async"
                    draggable={false}
                  />
                </div>
              </>
            ) : null}

            <article
              className="movie-scroller-detail-card"
              style={{
                width: detailLayout.panelWidth,
                height: detailLayout.panelHeight,
              }}
              aria-label={`${movieItems[displayMovieIndex].title} details`}
              onPointerDown={handleDetailPointerDown}
              onPointerUp={handleDetailPointerUp}
              onPointerCancel={clearSwipeGesture}
            >
              <button
                type="button"
                className="movie-scroller-close"
                aria-label={`Close ${movieItems[displayMovieIndex].title} details`}
                onClick={handleRequestClose}
                disabled={phase !== "open" || detailTransition !== null}
              >
                <X size={20} strokeWidth={2.1} />
              </button>

              <div className="movie-scroller-detail-stack">{detailBodies}</div>
            </article>
          </div>
        </div>
      ) : null}

      {showGhost && ghostTransition ? (
        <img
          ref={ghostRef}
          src={movieItems[mod(ghostTransition.itemIndex, movieCount)].imageSrc}
          alt=""
          aria-hidden="true"
          className={`movie-scroller-poster-ghost${
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
