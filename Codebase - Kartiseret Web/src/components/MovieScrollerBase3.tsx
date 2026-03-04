import {
  useCallback,
  useEffect,
  useLayoutEffect,
  type CSSProperties,
  type MouseEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { movies, type Movie } from "../data/movieCatalog";
import { getRepeatSetCount3 } from "./MovieScroller3Shared";

export type PosterSourceRect3 = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type MovieScroller3Props = {
  cardWidth?: number;
  cardHeight?: number;
  gap?: number;
  maxWidth?: number | string;
  className?: string;
  focusOffsetItemSpans?: number;
  anchorItemIndex?: number | null;
  onSelectMovie?: (
    movie: Movie,
    sourceRect: PosterSourceRect3,
    itemIndex?: number,
    sourceOpacity?: number,
  ) => void;
  selectedItemIndex?: number | null;
  getCardClassName?: (state: MovieScroller3CardState) => string | undefined;
  getCardStyle?: (state: MovieScroller3CardState) => CSSProperties | undefined;
};

export type MovieScroller3CardState = {
  itemIndex: number;
  movieIndex: number;
  movie: Movie;
  isVisible: boolean;
  isSelected: boolean;
  selectedItemIndex: number | null;
  relativeIndex: number | null;
  positionalOpacity: number;
};

type WindowRange3 = {
  start: number;
  end: number;
  firstVisible: number;
  visibleCount: number;
};

type ViewportState3 = {
  scrollLeft: number;
  clientWidth: number;
};

type IntroPhase3 = "pre" | "animating" | "done";

const OVERSCAN3_CARDS = 5;
const INTRO3_START_DELAY_MS = 64;
const INTRO3_DURATION_MS = 1120;
const INTRO3_STAGGER_STEP_MS = 72;
const INTRO3_MAX_STAGGER_MS = 320;
const INTRO3_OFFSCREEN_GUTTER_PX = 72;
const INTRO3_TARGET_CARD_COUNT = 5;
const INTRO3_LEADING_CARD_COUNT = 1;

function getFocusViewportCenter3(
  clientWidth: number,
  cardWidth: number,
  itemSpan: number,
  gap: number,
  focusOffsetItemSpans: number,
): number {
  const safeFocusOffsetItemSpans = Number.isFinite(focusOffsetItemSpans)
    ? Math.max(focusOffsetItemSpans, 0)
    : 0;
  const desiredCenter = clientWidth / 2 - itemSpan * safeFocusOffsetItemSpans;
  const minimumCenter = gap + cardWidth / 2;
  const maximumCenter = Math.max(minimumCenter, clientWidth - gap - cardWidth / 2);

  return clamp3(desiredCenter, minimumCenter, maximumCenter);
}

function getDirectionalDistance3(value: number): number {
  return Math.max(value, 1);
}

function getInitialIntroPhase3(): IntroPhase3 {
  if (typeof window === "undefined") {
    return "done";
  }

  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "done"
    : "pre";
}

function clamp3(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function easeInQuad3(value: number): number {
  return value ** 2;
}

export function MovieScrollerBase3({
  cardWidth = 240,
  cardHeight = 360,
  gap = 16,
  maxWidth = "100%",
  className,
  focusOffsetItemSpans = 1,
  anchorItemIndex = null,
  onSelectMovie,
  selectedItemIndex = null,
  getCardClassName,
  getCardStyle,
}: MovieScroller3Props) {
  const movieCount = movies.length;
  const scrollerRef = useRef<HTMLElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const introStartFrameRef = useRef<number | null>(null);
  const introCommitFrameRef = useRef<number | null>(null);
  const introDelayTimeoutRef = useRef<number | null>(null);
  const introCompleteTimeoutRef = useRef<number | null>(null);
  const seenPosterSrcRef = useRef(new Set<string>());
  const focusedScaleBoost = 0.15;
  const maxCardHeight = Math.ceil(cardHeight * (1 + focusedScaleBoost));

  const itemSpan = cardWidth + gap;

  const repeatSets = useMemo(() => {
    return getRepeatSetCount3(itemSpan, movieCount);
  }, [itemSpan, movieCount]);

  const totalItems = movieCount * repeatSets;
  const middleSetStartIndex = Math.floor(repeatSets / 2) * movieCount;
  const centeredAnchorIndex = clamp3(
    anchorItemIndex ?? middleSetStartIndex,
    0,
    totalItems - 1,
  );
  const trackWidth = gap + totalItems * itemSpan;

  const [range, setRange] = useState<WindowRange3>(() => {
    const start = clamp3(
      centeredAnchorIndex - OVERSCAN3_CARDS,
      0,
      totalItems - 1,
    );
    const end = clamp3(
      centeredAnchorIndex + OVERSCAN3_CARDS,
      0,
      totalItems - 1,
    );
    return {
      start,
      end,
      firstVisible: centeredAnchorIndex,
      visibleCount: 1,
    };
  });
  const [viewport, setViewport] = useState<ViewportState3>({
    scrollLeft: 0,
    clientWidth: 0,
  });
  const [introPhase, setIntroPhase] = useState<IntroPhase3>(
    () => getInitialIntroPhase3(),
  );
  const shouldPlayIntroRef = useRef(introPhase !== "done");
  const introFallbackViewportWidth =
    typeof window === "undefined"
      ? cardWidth * INTRO3_TARGET_CARD_COUNT +
        gap * (INTRO3_TARGET_CARD_COUNT - 1)
      : Math.min(
          window.innerWidth,
          typeof maxWidth === "number"
            ? maxWidth
            : Number.parseFloat(maxWidth) || window.innerWidth,
        );
  const effectiveViewportWidth =
    viewport.clientWidth || introFallbackViewportWidth;
  const focusViewportCenter = getFocusViewportCenter3(
    effectiveViewportWidth,
    cardWidth,
    itemSpan,
    gap,
    focusOffsetItemSpans,
  );
  const effectiveScrollLeft =
    viewport.clientWidth > 0
      ? viewport.scrollLeft
      : Math.max(
          0,
          gap +
            centeredAnchorIndex * itemSpan -
            (focusViewportCenter - cardWidth / 2),
        );

  const calculateRange = useCallback(
    (scrollLeft: number, clientWidth: number): WindowRange3 => {
      const adjustedLeft = Math.max(scrollLeft - gap, 0);
      const firstVisible = clamp3(
        Math.floor(adjustedLeft / itemSpan),
        0,
        totalItems - 1,
      );
      const visibleCount = Math.max(
        1,
        Math.ceil((clientWidth + gap) / itemSpan) + 1,
      );
      const start = clamp3(firstVisible - OVERSCAN3_CARDS, 0, totalItems - 1);
      const end = clamp3(
        firstVisible + visibleCount + OVERSCAN3_CARDS - 1,
        0,
        totalItems - 1,
      );
      return { start, end, firstVisible, visibleCount };
    },
    [gap, itemSpan, totalItems],
  );

  const updateWindowFromScroller = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }

    const next = calculateRange(scroller.scrollLeft, scroller.clientWidth);
    setViewport((prev) => {
      if (
        prev.scrollLeft === scroller.scrollLeft &&
        prev.clientWidth === scroller.clientWidth
      ) {
        return prev;
      }
      return {
        scrollLeft: scroller.scrollLeft,
        clientWidth: scroller.clientWidth,
      };
    });
    setRange((prev) => {
      if (
        prev.start === next.start &&
        prev.end === next.end &&
        prev.firstVisible === next.firstVisible &&
        prev.visibleCount === next.visibleCount
      ) {
        return prev;
      }
      return next;
    });
  }, [calculateRange]);

  const centerAnchorMovie = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }

    const targetFocusCenter = getFocusViewportCenter3(
      scroller.clientWidth,
      cardWidth,
      itemSpan,
      gap,
      focusOffsetItemSpans,
    );

    const centeredScrollLeft = Math.max(
      0,
      gap +
        centeredAnchorIndex * itemSpan -
        (targetFocusCenter - cardWidth / 2),
    );

    if (Math.abs(scroller.scrollLeft - centeredScrollLeft) > 0.5) {
      scroller.scrollLeft = centeredScrollLeft;
    }

    updateWindowFromScroller();
  }, [
    cardWidth,
    centeredAnchorIndex,
    focusOffsetItemSpans,
    gap,
    itemSpan,
    updateWindowFromScroller,
  ]);

  const scheduleWindowUpdate = useCallback(() => {
    if (rafRef.current !== null) {
      return;
    }
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      updateWindowFromScroller();
    });
  }, [updateWindowFromScroller]);

  const clearScheduledIntro = useCallback(() => {
    if (introStartFrameRef.current !== null) {
      window.cancelAnimationFrame(introStartFrameRef.current);
      introStartFrameRef.current = null;
    }

    if (introCommitFrameRef.current !== null) {
      window.cancelAnimationFrame(introCommitFrameRef.current);
      introCommitFrameRef.current = null;
    }

    if (introDelayTimeoutRef.current !== null) {
      window.clearTimeout(introDelayTimeoutRef.current);
      introDelayTimeoutRef.current = null;
    }

    if (introCompleteTimeoutRef.current !== null) {
      window.clearTimeout(introCompleteTimeoutRef.current);
      introCompleteTimeoutRef.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    centerAnchorMovie();
  }, [centerAnchorMovie]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }

    const observer = new ResizeObserver(() => {
      centerAnchorMovie();
    });
    observer.observe(scroller);

    return () => {
      observer.disconnect();
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [centerAnchorMovie]);

  useEffect(() => {
    if (!shouldPlayIntroRef.current) {
      return;
    }

    introStartFrameRef.current = window.requestAnimationFrame(() => {
      introStartFrameRef.current = null;
      introCommitFrameRef.current = window.requestAnimationFrame(() => {
        introCommitFrameRef.current = null;
        introDelayTimeoutRef.current = window.setTimeout(() => {
          setIntroPhase("animating");
          introDelayTimeoutRef.current = null;
          introCompleteTimeoutRef.current = window.setTimeout(() => {
            setIntroPhase("done");
            introCompleteTimeoutRef.current = null;
          }, INTRO3_DURATION_MS + INTRO3_MAX_STAGGER_MS);
        }, INTRO3_START_DELAY_MS);
      });
    });

    return () => {
      clearScheduledIntro();
    };
  }, [clearScheduledIntro]);

  useEffect(() => {
    for (let i = range.start; i <= range.end; i += 1) {
      const movie = movies[i % movieCount];
      const imageSources = [movie.imageSrc, movie.backdropSrc].filter(
        Boolean,
      ) as string[];

      for (const src of imageSources) {
        if (seenPosterSrcRef.current.has(src)) {
          continue;
        }

        seenPosterSrcRef.current.add(src);
        const image = new Image();
        image.decoding = "async";
        image.src = src;
      }
    }
  }, [movieCount, range.start, range.end]);

  const visibleStart = range.firstVisible;
  const visibleEnd = range.firstVisible + range.visibleCount - 1;
  const focusTrackCenter = effectiveScrollLeft + focusViewportCenter;
  const fullOpacityRadius =
    effectiveViewportWidth > 0
      ? clamp3(effectiveViewportWidth * 0.12, 52, 96)
      : 96;
  const fadeEndDistance =
    effectiveViewportWidth > 0
      ? Math.max(effectiveViewportWidth / 2 + cardWidth * 0.5, cardWidth)
      : cardWidth;
  const focusPlateau = Math.max(itemSpan * 0.16, 28);
  const waveRadius = Math.max(itemSpan * 1.8, cardWidth * 1.55);
  const hasIntroPhase = introPhase !== "done" && selectedItemIndex === null;
  const isIntroPre = introPhase === "pre" && selectedItemIndex === null;
  const introInteractive = introPhase === "done";
  const introAnimatedStart = clamp3(
    centeredAnchorIndex - INTRO3_LEADING_CARD_COUNT,
    0,
    totalItems - 1,
  );
  const introAnimatedEnd = clamp3(
    introAnimatedStart + INTRO3_TARGET_CARD_COUNT - 1,
    0,
    totalItems - 1,
  );
  const introLeadCardScreenLeft =
    gap + introAnimatedStart * itemSpan - effectiveScrollLeft;
  const introTravelDistance =
    Math.max(0, introLeadCardScreenLeft) +
    cardWidth +
    INTRO3_OFFSCREEN_GUTTER_PX;
  const leftFadeEndDistance = getDirectionalDistance3(
    Math.max(fadeEndDistance * 0.56, focusViewportCenter + cardWidth * 0.32),
  );
  const rightFadeEndDistance = getDirectionalDistance3(
    Math.max(
      fadeEndDistance * 1.48,
      effectiveViewportWidth - focusViewportCenter + cardWidth * 0.72,
    ),
  );
  const leftWaveRadius = getDirectionalDistance3(
    Math.max(waveRadius * 0.72, itemSpan * 1.18),
  );
  const rightWaveRadius = getDirectionalDistance3(
    Math.max(waveRadius * 1.72, itemSpan * 3.2),
  );

  const cards = Array.from(
    { length: range.end - range.start + 1 },
    (_, offset) => {
      const i = range.start + offset;
      const movie = movies[i % movieCount];
      const movieIndex = i % movieCount;
      const isVisible = i >= visibleStart && i <= visibleEnd;
      const isSelected = selectedItemIndex === i;
      const relativeIndex =
        selectedItemIndex === null ? null : i - selectedItemIndex;
      const left = gap + i * itemSpan;
      const cardCenter = left + cardWidth / 2;
      const signedDistanceFromFocus = cardCenter - focusTrackCenter;
      const distanceFromCenter = Math.abs(signedDistanceFromFocus);
      const directionalFadeEndDistance =
        signedDistanceFromFocus < 0 ? leftFadeEndDistance : rightFadeEndDistance;
      const fadeProgress =
        directionalFadeEndDistance > fullOpacityRadius
          ? clamp3(
              (distanceFromCenter - fullOpacityRadius) /
                (directionalFadeEndDistance - fullOpacityRadius),
              0,
              1,
            )
          : 1;
      const opacity =
        effectiveViewportWidth > 0 ? 1 - easeInQuad3(fadeProgress) : 1;
      const shouldAnimateIntroCard =
        hasIntroPhase &&
        i >= introAnimatedStart &&
        i <= introAnimatedEnd;
      const introOrder = shouldAnimateIntroCard
        ? i - introAnimatedStart
        : 0;
      const introDelayMs = Math.min(
        INTRO3_MAX_STAGGER_MS,
        introOrder * INTRO3_STAGGER_STEP_MS,
      );
      const introTranslateX = isIntroPre && shouldAnimateIntroCard
        ? -introTravelDistance
        : 0;
      const introOpacity =
        isIntroPre && shouldAnimateIntroCard ? 0 : opacity;
      const directionalWaveRadius =
        signedDistanceFromFocus < 0 ? leftWaveRadius : rightWaveRadius;
      const waveProgress =
        effectiveViewportWidth > 0 && directionalWaveRadius > focusPlateau
          ? clamp3(
              1 -
                Math.max(distanceFromCenter - focusPlateau, 0) /
                  (directionalWaveRadius - focusPlateau),
              0,
              1,
            )
          : 0;
      const waveLift = Math.sin((waveProgress * Math.PI) / 2);
      const scale = 1 + focusedScaleBoost * waveLift;
      const cardState: MovieScroller3CardState = {
        itemIndex: i,
        movieIndex,
        movie,
        isVisible,
        isSelected,
        selectedItemIndex,
        relativeIndex,
        positionalOpacity: opacity,
      };
      const cardClassName = getCardClassName?.(cardState);
      const cardStyle = getCardStyle?.(cardState);
      const handleSelectMovie = (event: MouseEvent<HTMLButtonElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();

        onSelectMovie?.(
          movie,
          {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          },
          i,
          opacity,
        );
      };

      return (
        <button
          key={i}
          type="button"
          aria-label={`Open details for ${movie.title}`}
          data-scroller3-item-index={i}
          data-scroller3-positional-opacity={opacity.toFixed(6)}
          onClick={handleSelectMovie}
          className={["movie-scroller3__card", cardClassName]
            .filter(Boolean)
            .join(" ")}
          style={{
            position: "absolute",
            left,
            bottom: 0,
            width: cardWidth,
            height: cardHeight,
            padding: 0,
            border: "none",
            borderRadius: 14,
            overflow: "hidden",
            opacity: introOpacity,
            background: "transparent",
            cursor:
              onSelectMovie && introInteractive
                ? "pointer"
                : introInteractive
                  ? "grab"
                  : "default",
            transform:
              `translateZ(0) ` +
              `translateX(calc(${introTranslateX}px + var(--card-translate-x, 0px))) ` +
              `translateY(var(--card-translate-y, 0px)) ` +
              `rotate(var(--card-rotate, 0deg)) ` +
              `scale(calc(${scale} * var(--card-scale, 1)))`,
            transformOrigin: "center bottom",
            transition:
              shouldAnimateIntroCard
                ? `transform ${INTRO3_DURATION_MS}ms cubic-bezier(0.22, 0.86, 0.24, 1) ${introDelayMs}ms, ` +
                  `opacity 540ms ease ${introDelayMs}ms`
                : "transform 72ms cubic-bezier(0.22, 0.9, 0.34, 1), opacity 80ms linear",
            willChange: "transform, opacity",
            zIndex: Math.round(waveLift * 100),
            ...cardStyle,
          }}
        >
          <img
            src={movie.imageSrc}
            alt={movie.title}
            loading={isVisible ? "eager" : "lazy"}
            fetchPriority={isVisible ? "high" : "auto"}
            decoding="async"
            draggable={false}
            style={{
              display: "block",
              width: "100%",
              height: "100%",
              objectFit: "cover",
              userSelect: "none",
            }}
          />
        </button>
      );
    },
  );

  return (
    <section
      ref={scrollerRef}
      onScroll={scheduleWindowUpdate}
      className={className}
      style={{
        position: "relative",
        width: "100%",
        margin: "0 auto",
        maxWidth,
        overflowX: "auto",
        overflowY: "hidden",
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "none",
        msOverflowStyle: "none",
        pointerEvents: introInteractive ? undefined : "none",
      }}
    >
      <div
        style={{
          position: "relative",
          height: maxCardHeight,
          width: trackWidth,
        }}
      >
        {cards}
      </div>
    </section>
  );
}
