import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { X } from "lucide-react";
import { movies } from "../data/movies";
import {
  MovieScrollerBase2,
  type MovieScroller2CardState,
  type MovieScroller2Props,
  type PosterSourceRect2,
} from "./MovieScrollerBase2";
import { getRepeatSetCount2 } from "./MovieScroller2Shared";
import { MovieDetailsContent } from "./MovieDetailsContent";
import "./MovieScroller2.css";

type FocusPhase2 = "collapsed" | "opening" | "open" | "closing";

type GhostTransitionState2 = {
  itemIndex: number;
  sourceRect: PosterSourceRect2;
  targetRect: PosterSourceRect2;
  sourceOpacity: number;
  targetOpacity: number;
};

type DetailLayout2 = {
  panelWidth: number;
  itemSpan: number;
  panelHeight: number;
  trackWidth: number;
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

const DETAIL2_REPEAT_SETS = 7;
const DETAIL2_SCROLL_SETTLE_MS = 110;
const DETAIL2_EDGE_BUFFER_SETS = 1;
const DETAIL2_READY_RADIUS = 2;
const DETAIL2_PRELOAD_RADIUS = 4;
const COLLAPSED_CARD_SCALE_BOOST = 0.15;

const movieScroller2TimingStyle = {
  "--movie-scroller2-stage-fade-duration": `${FOCUS_STAGE_FADE_DURATION_MS}ms`,
  "--movie-scroller2-stage-close-delay": `${CLOSE_STAGE_FADE_DELAY_MS}ms`,
  "--movie-scroller2-focus-poster-fade-duration": `${FOCUS_POSTER_FADE_DURATION_MS}ms`,
  "--movie-scroller2-ghost-move-duration": `${POSTER_MOVE_DURATION_MS}ms`,
  "--movie-scroller2-ghost-opacity-duration": `${POSTER_GHOST_OPACITY_DURATION_MS}ms`,
} as CSSProperties;

function clamp2(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function mod2(value: number, size: number): number {
  const remainder = value % size;
  return remainder < 0 ? remainder + size : remainder;
}

function buildCardOffset2(
  cardState: MovieScroller2CardState,
  phase: FocusPhase2,
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

function getMaxWidthValue2(
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

function getDetailLayout2(
  clientWidth: number,
  gap: number,
  maxWidth: number | string,
  totalItems: number,
): DetailLayout2 {
  const viewportFallback =
    typeof window === "undefined" ? 1200 : Math.max(window.innerWidth - 48, 760);
  const safeClientWidth = Math.max(clientWidth || viewportFallback, 520);
  const maxWidthValue = getMaxWidthValue2(maxWidth, safeClientWidth);
  const peekInset = safeClientWidth < 720 ? 28 : 72;
  const panelWidth = Math.max(
    320,
    Math.min(maxWidthValue, safeClientWidth - peekInset * 2),
  );
  const itemSpan = panelWidth + gap;
  const trackWidth = gap + totalItems * itemSpan;
  const panelHeight = safeClientWidth < 720 ? 720 : 760;

  return {
    panelWidth,
    itemSpan,
    panelHeight,
    trackWidth,
  };
}

function getCenteredScrollLeft2(
  itemIndex: number,
  clientWidth: number,
  gap: number,
  panelWidth: number,
  itemSpan: number,
): number {
  return Math.max(
    0,
    gap + itemIndex * itemSpan - (clientWidth - panelWidth) / 2,
  );
}

function getCenteredDetailIndex2(
  scrollLeft: number,
  clientWidth: number,
  gap: number,
  panelWidth: number,
  itemSpan: number,
  totalItems: number,
): number {
  return clamp2(
    Math.round(
      (scrollLeft + clientWidth / 2 - gap - panelWidth / 2) / itemSpan,
    ),
    0,
    totalItems - 1,
  );
}

export function MovieScroller2({
  cardWidth = 240,
  cardHeight = 360,
  gap = 16,
  maxWidth = "100%",
  className,
}: MovieScroller2Props) {
  const movieCount = movies.length;
  const collapsedRepeatSets = getRepeatSetCount2(cardWidth + gap, movieCount);
  const collapsedMiddleStartIndex =
    Math.floor(collapsedRepeatSets / 2) * movieCount;
  const detailMiddleStartIndex =
    Math.floor(DETAIL2_REPEAT_SETS / 2) * movieCount;
  const detailTotalItems = DETAIL2_REPEAT_SETS * movieCount;
  const collapsedHeight = Math.ceil(
    cardHeight * (1 + COLLAPSED_CARD_SCALE_BOOST),
  );

  const [phase, setPhase] = useState<FocusPhase2>("collapsed");
  const collapsedAnchorIndex = collapsedMiddleStartIndex;
  const [collapsedSelectedItemIndex, setCollapsedSelectedItemIndex] = useState<
    number | null
  >(null);
  const [detailActiveIndex, setDetailActiveIndex] = useState(
    detailMiddleStartIndex,
  );
  const [detailClientWidth, setDetailClientWidth] = useState(0);
  const [isFocusPosterVisible, setIsFocusPosterVisible] = useState(false);
  const [showGhost, setShowGhost] = useState(false);
  const [isReturnHandoffReady, setIsReturnHandoffReady] = useState(false);
  const [ghostTransition, setGhostTransition] =
    useState<GhostTransitionState2 | null>(null);

  const shellRef = useRef<HTMLDivElement | null>(null);
  const detailScrollerRef = useRef<HTMLDivElement | null>(null);
  const posterRef = useRef<HTMLImageElement | null>(null);
  const ghostRef = useRef<HTMLImageElement | null>(null);
  const targetRectRef = useRef<PosterSourceRect2 | null>(null);
  const pendingOpenIndexRef = useRef(detailMiddleStartIndex);
  const detailScrollFrameRef = useRef<number | null>(null);
  const detailSettleTimeoutRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const posterRevealTimeoutRef = useRef<number | null>(null);
  const crossfadeTimeoutRef = useRef<number | null>(null);
  const returnHandoffTimeoutRef = useRef<number | null>(null);
  const completeTimeoutRef = useRef<number | null>(null);
  const seenPosterSrcRef = useRef(new Set<string>());
  const titleId = useId();

  const isDetailMounted = phase !== "collapsed";
  const activeMovieIndex = mod2(detailActiveIndex, movieCount);
  const detailLayout = getDetailLayout2(
    detailClientWidth,
    gap,
    maxWidth,
    detailTotalItems,
  );

  const clearScheduledScrollWork = useCallback(() => {
    if (detailScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(detailScrollFrameRef.current);
      detailScrollFrameRef.current = null;
    }

    if (detailSettleTimeoutRef.current !== null) {
      window.clearTimeout(detailSettleTimeoutRef.current);
      detailSettleTimeoutRef.current = null;
    }
  }, []);

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

  const clearAllScheduledWork = useCallback(() => {
    clearScheduledScrollWork();
    clearScheduledAnimation();
  }, [clearScheduledAnimation, clearScheduledScrollWork]);

  const measureDetailScroller = useCallback(() => {
    const scroller = detailScrollerRef.current;
    if (!scroller) {
      return 0;
    }

    const nextClientWidth = scroller.clientWidth;
    setDetailClientWidth((previous) =>
      previous === nextClientWidth ? previous : nextClientWidth,
    );

    return nextClientWidth;
  }, []);

  const applyRectToGhost = useCallback((rect: PosterSourceRect2) => {
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

  const getCurrentPositionalOpacity = useCallback(
    (itemIndex: number, fallback: number) => {
      const item = shellRef.current?.querySelector<HTMLElement>(
        `[data-scroller2-item-index="${itemIndex}"]`,
      );
      const value = item?.dataset.scroller2PositionalOpacity;
      const parsed = value ? Number(value) : Number.NaN;

      return Number.isFinite(parsed) ? parsed : fallback;
    },
    [],
  );

  const getCurrentDestinationRect = useCallback(
    (itemIndex: number, fallback: PosterSourceRect2) => {
      const item = shellRef.current?.querySelector<HTMLElement>(
        `[data-scroller2-item-index="${itemIndex}"]`,
      );
      const rect = item?.getBoundingClientRect();

      if (!rect) {
        return fallback;
      }

      return {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
    },
    [],
  );

  const scrollDetailToIndex = useCallback(
    (itemIndex: number, behavior: ScrollBehavior = "auto") => {
      const scroller = detailScrollerRef.current;
      if (!scroller) {
        return;
      }

      const clientWidth = measureDetailScroller();
      if (clientWidth === 0) {
        return;
      }

      const layout = getDetailLayout2(
        clientWidth,
        gap,
        maxWidth,
        detailTotalItems,
      );
      const centeredScrollLeft = getCenteredScrollLeft2(
        itemIndex,
        clientWidth,
        gap,
        layout.panelWidth,
        layout.itemSpan,
      );

      if (behavior === "auto") {
        scroller.scrollLeft = centeredScrollLeft;
        return;
      }

      scroller.scrollTo({
        left: centeredScrollLeft,
        behavior,
      });
    },
    [detailTotalItems, gap, maxWidth, measureDetailScroller],
  );

  const getCenteredIndexFromScroller = useCallback(() => {
    const scroller = detailScrollerRef.current;
    if (!scroller) {
      return detailActiveIndex;
    }

    const clientWidth = measureDetailScroller();
    if (clientWidth === 0) {
      return detailActiveIndex;
    }

    const layout = getDetailLayout2(
      clientWidth,
      gap,
      maxWidth,
      detailTotalItems,
    );

    return getCenteredDetailIndex2(
      scroller.scrollLeft,
      clientWidth,
      gap,
      layout.panelWidth,
      layout.itemSpan,
      detailTotalItems,
    );
  }, [detailActiveIndex, detailTotalItems, gap, maxWidth, measureDetailScroller]);

  const recenterDetailIndex = useCallback(
    (itemIndex: number) => {
      const scroller = detailScrollerRef.current;
      const setIndex = Math.floor(itemIndex / movieCount);
      const minSet = DETAIL2_EDGE_BUFFER_SETS;
      const maxSet = DETAIL2_REPEAT_SETS - DETAIL2_EDGE_BUFFER_SETS - 1;

      if (setIndex > minSet && setIndex < maxSet) {
        return itemIndex;
      }

      const centeredIndex = detailMiddleStartIndex + mod2(itemIndex, movieCount);

      if (scroller) {
        const clientWidth = measureDetailScroller();
        if (clientWidth > 0) {
          const layout = getDetailLayout2(
            clientWidth,
            gap,
            maxWidth,
            detailTotalItems,
          );
          const centeredScrollLeft = getCenteredScrollLeft2(
            centeredIndex,
            clientWidth,
            gap,
            layout.panelWidth,
            layout.itemSpan,
          );

          if (Math.abs(scroller.scrollLeft - centeredScrollLeft) > 0.5) {
            scroller.scrollLeft = centeredScrollLeft;
          }
        }
      }

      return centeredIndex;
    },
    [
      detailMiddleStartIndex,
      detailTotalItems,
      gap,
      maxWidth,
      measureDetailScroller,
      movieCount,
    ],
  );

  const commitCenteredDetailIndex = useCallback(() => {
    const centeredIndex = recenterDetailIndex(getCenteredIndexFromScroller());

    pendingOpenIndexRef.current = centeredIndex;
    setDetailActiveIndex((previous) =>
      previous === centeredIndex ? previous : centeredIndex,
    );
  }, [getCenteredIndexFromScroller, recenterDetailIndex]);

  const scheduleSettledCommit = useCallback(() => {
    if (detailSettleTimeoutRef.current !== null) {
      window.clearTimeout(detailSettleTimeoutRef.current);
    }

    detailSettleTimeoutRef.current = window.setTimeout(() => {
      commitCenteredDetailIndex();
      detailSettleTimeoutRef.current = null;
    }, DETAIL2_SCROLL_SETTLE_MS);
  }, [commitCenteredDetailIndex]);

  const handleSelectCollapsedMovie = useCallback<
    NonNullable<MovieScroller2Props["onSelectMovie"]>
  >(
    (_movie, sourceRect, itemIndex, sourceOpacity = 1) => {
      if (phase !== "collapsed" || itemIndex === undefined) {
        return;
      }

      const movieIndex = mod2(itemIndex, movieCount);
      const nextDetailIndex = detailMiddleStartIndex + movieIndex;

      clearAllScheduledWork();
      pendingOpenIndexRef.current = nextDetailIndex;
      setCollapsedSelectedItemIndex(itemIndex);
      setDetailActiveIndex(nextDetailIndex);
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
      clearAllScheduledWork,
      detailMiddleStartIndex,
      movieCount,
      phase,
    ],
  );

  const handleFocusDetailMovie = useCallback(
    (itemIndex: number) => {
      if (phase !== "open") {
        return;
      }

      clearScheduledScrollWork();

      const normalizedIndex = recenterDetailIndex(itemIndex);

      pendingOpenIndexRef.current = normalizedIndex;
      setDetailActiveIndex(normalizedIndex);
      scrollDetailToIndex(normalizedIndex, "smooth");
      scheduleSettledCommit();
    },
    [
      clearScheduledScrollWork,
      phase,
      recenterDetailIndex,
      scheduleSettledCommit,
      scrollDetailToIndex,
    ],
  );

  const handleDetailScroll = useCallback(() => {
    if (phase !== "open") {
      return;
    }

    if (detailScrollFrameRef.current === null) {
      detailScrollFrameRef.current = window.requestAnimationFrame(() => {
        detailScrollFrameRef.current = null;
        measureDetailScroller();
      });
    }

    scheduleSettledCommit();
  }, [measureDetailScroller, phase, scheduleSettledCommit]);

  const handleRequestClose = useCallback(() => {
    if (phase !== "open") {
      return;
    }

    clearAllScheduledWork();

    const centeredIndex = recenterDetailIndex(getCenteredIndexFromScroller());
    const returnItemIndex =
      collapsedSelectedItemIndex ?? ghostTransition?.itemIndex ?? centeredIndex;
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
    const targetOpacity = getCurrentPositionalOpacity(
      returnItemIndex,
      ghostTransition?.sourceOpacity ?? 1,
    );
    const targetRect = getCurrentDestinationRect(
      returnItemIndex,
      ghostTransition?.sourceRect ?? fallbackSourceRect,
    );

    pendingOpenIndexRef.current = centeredIndex;
    targetRectRef.current = sourceRect;
    setDetailActiveIndex(centeredIndex);
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
    getCenteredIndexFromScroller,
    getCurrentDestinationRect,
    getCurrentPositionalOpacity,
    ghostTransition?.itemIndex,
    ghostTransition?.sourceRect,
    ghostTransition?.sourceOpacity,
    phase,
    recenterDetailIndex,
  ]);

  useLayoutEffect(() => {
    if (phase !== "opening" || !ghostTransition) {
      return;
    }

    clearScheduledAnimation();
    scrollDetailToIndex(pendingOpenIndexRef.current, "auto");

    const targetRect = posterRef.current?.getBoundingClientRect();
    if (!targetRect) {
      return;
    }

    targetRectRef.current = {
      top: targetRect.top,
      left: targetRect.left,
      width: targetRect.width,
      height: targetRect.height,
    };

    applyRectToGhost(ghostTransition.sourceRect);
    applyGhostScrollerAppearance();

    if (ghostRef.current) {
      ghostRef.current.style.opacity = `${ghostTransition.sourceOpacity}`;
    }

    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = window.requestAnimationFrame(() => {
        if (targetRectRef.current) {
          applyRectToGhost(targetRectRef.current);
        }
        applyGhostFocusAppearance();
        if (ghostRef.current) {
          ghostRef.current.style.opacity = "1";
        }
      });
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
    applyGhostScrollerAppearance,
    applyRectToGhost,
    clearScheduledAnimation,
    ghostTransition,
    phase,
    scrollDetailToIndex,
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

    const scroller = detailScrollerRef.current;
    if (!scroller) {
      return;
    }

    const observer = new ResizeObserver(() => {
      measureDetailScroller();
      scrollDetailToIndex(
        phase === "opening" ? pendingOpenIndexRef.current : detailActiveIndex,
        "auto",
      );
    });

    observer.observe(scroller);

    return () => {
      observer.disconnect();
    };
  }, [
    detailActiveIndex,
    isDetailMounted,
    measureDetailScroller,
    phase,
    scrollDetailToIndex,
  ]);

  useEffect(() => {
    if (!isDetailMounted) {
      return;
    }

    const preloadMovieIndexes = new Set<number>();

    for (
      let offset = -DETAIL2_PRELOAD_RADIUS;
      offset <= DETAIL2_PRELOAD_RADIUS;
      offset += 1
    ) {
      preloadMovieIndexes.add(mod2(activeMovieIndex + offset, movieCount));
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
  }, [activeMovieIndex, isDetailMounted, movieCount]);

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
        handleFocusDetailMovie(clamp2(detailActiveIndex + 1, 0, detailTotalItems - 1));
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        handleFocusDetailMovie(clamp2(detailActiveIndex - 1, 0, detailTotalItems - 1));
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    detailActiveIndex,
    detailTotalItems,
    handleFocusDetailMovie,
    handleRequestClose,
    phase,
  ]);

  useEffect(() => {
    return () => {
      clearAllScheduledWork();
    };
  }, [clearAllScheduledWork]);

  const getCardStyle = useCallback(
    (cardState: MovieScroller2CardState) => {
      const style = buildCardOffset2(cardState, phase);

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
    "movie-scroller2-shell",
    phase === "opening" ? "is-opening" : "",
    phase === "open" ? "is-open" : "",
    phase === "closing" ? "is-closing" : "",
    phase !== "collapsed" ? "is-detail-mode" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const detailPanels = Array.from({ length: detailTotalItems }, (_, itemIndex) => {
    const movie = movies[mod2(itemIndex, movieCount)];
    const isActive = itemIndex === detailActiveIndex;
    const distanceFromActive = Math.abs(itemIndex - detailActiveIndex);
    const isDetailReady = distanceFromActive <= DETAIL2_READY_RADIUS;

    return (
      <article
        key={`${movie.title}-${itemIndex}`}
        className={`movie-scroller2-detail-panel${isActive ? " is-active" : ""}${
          isDetailReady ? " is-detail-ready" : ""
        }`}
        style={{
          left: gap + itemIndex * detailLayout.itemSpan,
          width: detailLayout.panelWidth,
          height: detailLayout.panelHeight,
          zIndex: isActive ? 20 : Math.max(1, 10 - distanceFromActive),
        }}
        aria-labelledby={`${titleId}-${itemIndex}`}
      >
        {isDetailReady && movie.backdropSrc ? (
          <div className="movie-scroller2-detail-backdrop-shell" aria-hidden="true">
            <img
              src={movie.backdropSrc}
              alt=""
              className="movie-scroller2-detail-backdrop"
              decoding="async"
              loading={distanceFromActive <= 1 ? "eager" : "lazy"}
            />
          </div>
        ) : null}

        <div className="movie-scroller2-detail-sheen" aria-hidden="true" />

        {isDetailReady ? (
          <>
            {isActive ? (
              <button
                type="button"
                className="movie-scroller2-close"
                aria-label={`Close ${movie.title} details`}
                onClick={handleRequestClose}
              >
                <X size={20} strokeWidth={2.1} />
              </button>
            ) : (
              <button
                type="button"
                className="movie-scroller2-detail-focus-overlay"
                aria-label={`Focus ${movie.title}`}
                onClick={() => {
                  handleFocusDetailMovie(itemIndex);
                }}
              />
            )}

            <div className="movie-scroller2-detail-content">
              <MovieDetailsContent
                movie={movie}
                posterRef={isActive ? posterRef : undefined}
                titleId={`${titleId}-${itemIndex}`}
                eyebrow="Now playing"
                posterClassName={`details-poster movie-scroller2-detail-poster${
                  isActive
                    ? isFocusPosterVisible
                      ? " is-visible"
                      : ""
                    : " is-visible"
                }`}
              />
            </div>
          </>
        ) : (
          <button
            type="button"
            className="movie-scroller2-detail-preview"
            aria-label={`Focus ${movie.title}`}
            onClick={() => {
              handleFocusDetailMovie(itemIndex);
            }}
          >
            <img
              src={movie.imageSrc}
              alt={movie.title}
              className="movie-scroller2-detail-preview-image"
              loading={distanceFromActive <= 2 ? "eager" : "lazy"}
              decoding="async"
              draggable={false}
            />
          </button>
        )}
      </article>
    );
  });

  return (
    <div
      ref={shellRef}
      className={shellClassName}
      style={{
        ...movieScroller2TimingStyle,
        height: phase === "collapsed" ? collapsedHeight : detailLayout.panelHeight,
      }}
    >
      <div className="movie-scroller2-collapsed-layer" aria-hidden={isDetailMounted}>
        <MovieScrollerBase2
          cardWidth={cardWidth}
          cardHeight={cardHeight}
          gap={gap}
          maxWidth={maxWidth}
          anchorItemIndex={collapsedAnchorIndex}
          onSelectMovie={handleSelectCollapsedMovie}
          selectedItemIndex={
            phase === "collapsed" ? null : collapsedSelectedItemIndex
          }
          getCardStyle={getCardStyle}
          className="movie-scroller2-collapsed"
        />
      </div>

      {isDetailMounted ? (
        <div className="movie-scroller2-detail-layer">
          <div
            ref={detailScrollerRef}
            className="movie-scroller2-detail-rail"
            onScroll={handleDetailScroll}
          >
            <div
              className="movie-scroller2-detail-track"
              style={{
                height: detailLayout.panelHeight,
                width: detailLayout.trackWidth,
              }}
            >
              {detailPanels}
            </div>
          </div>
        </div>
      ) : null}

      {showGhost && ghostTransition ? (
        <img
          ref={ghostRef}
          src={movies[mod2(ghostTransition.itemIndex, movieCount)].imageSrc}
          alt=""
          aria-hidden="true"
          className={`movie-scroller2-poster-ghost${
            phase === "opening" ? " is-opening" : ""
          }${phase === "closing" ? " is-closing" : ""}`}
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
