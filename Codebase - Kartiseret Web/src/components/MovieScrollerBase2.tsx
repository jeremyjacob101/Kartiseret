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
import { getRepeatSetCount2 } from "./MovieScroller2Shared";

export type PosterSourceRect2 = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type MovieScroller2Props = {
  cardWidth?: number;
  cardHeight?: number;
  gap?: number;
  maxWidth?: number | string;
  className?: string;
  anchorItemIndex?: number | null;
  onSelectMovie?: (
    movie: Movie,
    sourceRect: PosterSourceRect2,
    itemIndex?: number,
    sourceOpacity?: number,
  ) => void;
  selectedItemIndex?: number | null;
  getCardClassName?: (state: MovieScroller2CardState) => string | undefined;
  getCardStyle?: (state: MovieScroller2CardState) => CSSProperties | undefined;
};

export type MovieScroller2CardState = {
  itemIndex: number;
  movieIndex: number;
  movie: Movie;
  isVisible: boolean;
  isSelected: boolean;
  selectedItemIndex: number | null;
  relativeIndex: number | null;
  positionalOpacity: number;
};

type WindowRange2 = {
  start: number;
  end: number;
  firstVisible: number;
  visibleCount: number;
};

type ViewportState2 = {
  scrollLeft: number;
  clientWidth: number;
};

type IntroPhase2 = "pre" | "animating" | "done";

const OVERSCAN2_CARDS = 5;
const INTRO2_START_DELAY_MS = 64;
const INTRO2_DURATION_MS = 1120;
const INTRO2_STAGGER_STEP_MS = 72;
const INTRO2_MAX_STAGGER_MS = 320;
const INTRO2_OFFSCREEN_GUTTER_PX = 72;
const INTRO2_TARGET_CARD_COUNT = 5;

function getInitialIntroPhase2(): IntroPhase2 {
  if (typeof window === "undefined") {
    return "done";
  }

  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "done"
    : "pre";
}

function clamp2(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function easeInQuad2(value: number): number {
  return value ** 2;
}

export function MovieScrollerBase2({
  cardWidth = 240,
  cardHeight = 360,
  gap = 16,
  maxWidth = "100%",
  className,
  anchorItemIndex = null,
  onSelectMovie,
  selectedItemIndex = null,
  getCardClassName,
  getCardStyle,
}: MovieScroller2Props) {
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
    return getRepeatSetCount2(itemSpan, movieCount);
  }, [itemSpan, movieCount]);

  const totalItems = movieCount * repeatSets;
  const middleSetStartIndex = Math.floor(repeatSets / 2) * movieCount;
  const centeredAnchorIndex = clamp2(
    anchorItemIndex ?? middleSetStartIndex,
    0,
    totalItems - 1,
  );
  const trackWidth = gap + totalItems * itemSpan;

  const [range, setRange] = useState<WindowRange2>(() => {
    const start = clamp2(
      centeredAnchorIndex - OVERSCAN2_CARDS,
      0,
      totalItems - 1,
    );
    const end = clamp2(
      centeredAnchorIndex + OVERSCAN2_CARDS,
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
  const [viewport, setViewport] = useState<ViewportState2>({
    scrollLeft: 0,
    clientWidth: 0,
  });
  const [introPhase, setIntroPhase] = useState<IntroPhase2>(
    () => getInitialIntroPhase2(),
  );
  const shouldPlayIntroRef = useRef(introPhase !== "done");
  const introFallbackViewportWidth =
    typeof window === "undefined"
      ? cardWidth * INTRO2_TARGET_CARD_COUNT +
        gap * (INTRO2_TARGET_CARD_COUNT - 1)
      : Math.min(
          window.innerWidth,
          typeof maxWidth === "number"
            ? maxWidth
            : Number.parseFloat(maxWidth) || window.innerWidth,
        );
  const effectiveViewportWidth =
    viewport.clientWidth || introFallbackViewportWidth;
  const effectiveScrollLeft =
    viewport.clientWidth > 0
      ? viewport.scrollLeft
      : Math.max(
          0,
          gap +
            centeredAnchorIndex * itemSpan -
            (effectiveViewportWidth - cardWidth) / 2,
        );

  const calculateRange = useCallback(
    (scrollLeft: number, clientWidth: number): WindowRange2 => {
      const adjustedLeft = Math.max(scrollLeft - gap, 0);
      const firstVisible = clamp2(
        Math.floor(adjustedLeft / itemSpan),
        0,
        totalItems - 1,
      );
      const visibleCount = Math.max(
        1,
        Math.ceil((clientWidth + gap) / itemSpan) + 1,
      );
      const start = clamp2(firstVisible - OVERSCAN2_CARDS, 0, totalItems - 1);
      const end = clamp2(
        firstVisible + visibleCount + OVERSCAN2_CARDS - 1,
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

    const centeredScrollLeft = Math.max(
      0,
      gap +
        centeredAnchorIndex * itemSpan -
        (scroller.clientWidth - cardWidth) / 2,
    );

    if (Math.abs(scroller.scrollLeft - centeredScrollLeft) > 0.5) {
      scroller.scrollLeft = centeredScrollLeft;
    }

    updateWindowFromScroller();
  }, [cardWidth, centeredAnchorIndex, gap, itemSpan, updateWindowFromScroller]);

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
          }, INTRO2_DURATION_MS + INTRO2_MAX_STAGGER_MS);
        }, INTRO2_START_DELAY_MS);
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
  const viewportCenter = effectiveScrollLeft + effectiveViewportWidth / 2;
  const fullOpacityRadius =
    effectiveViewportWidth > 0
      ? clamp2(effectiveViewportWidth * 0.12, 52, 96)
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
  const introAnimatedStart = clamp2(
    centeredAnchorIndex - Math.floor(INTRO2_TARGET_CARD_COUNT / 2),
    0,
    totalItems - 1,
  );
  const introAnimatedEnd = clamp2(
    introAnimatedStart + INTRO2_TARGET_CARD_COUNT - 1,
    0,
    totalItems - 1,
  );
  const introLeadCardScreenLeft =
    gap + introAnimatedStart * itemSpan - effectiveScrollLeft;
  const introTravelDistance =
    Math.max(0, introLeadCardScreenLeft) +
    cardWidth +
    INTRO2_OFFSCREEN_GUTTER_PX;

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
      const distanceFromCenter = Math.abs(cardCenter - viewportCenter);
      const fadeProgress =
        fadeEndDistance > fullOpacityRadius
          ? clamp2(
              (distanceFromCenter - fullOpacityRadius) /
                (fadeEndDistance - fullOpacityRadius),
              0,
              1,
            )
          : 1;
      const opacity =
        effectiveViewportWidth > 0 ? 1 - easeInQuad2(fadeProgress) : 1;
      const shouldAnimateIntroCard =
        hasIntroPhase &&
        i >= introAnimatedStart &&
        i <= introAnimatedEnd;
      const introOrder = shouldAnimateIntroCard
        ? i - introAnimatedStart
        : 0;
      const introDelayMs = Math.min(
        INTRO2_MAX_STAGGER_MS,
        introOrder * INTRO2_STAGGER_STEP_MS,
      );
      const introTranslateX = isIntroPre && shouldAnimateIntroCard
        ? -introTravelDistance
        : 0;
      const introOpacity =
        isIntroPre && shouldAnimateIntroCard ? 0 : opacity;
      const waveProgress =
        effectiveViewportWidth > 0 && waveRadius > focusPlateau
          ? clamp2(
              1 -
                Math.max(distanceFromCenter - focusPlateau, 0) /
                  (waveRadius - focusPlateau),
              0,
              1,
            )
          : 0;
      const waveLift = Math.sin((waveProgress * Math.PI) / 2);
      const scale = 1 + focusedScaleBoost * waveLift;
      const cardState: MovieScroller2CardState = {
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
          data-scroller2-item-index={i}
          data-scroller2-positional-opacity={opacity.toFixed(6)}
          onClick={handleSelectMovie}
          className={["movie-scroller2__card", cardClassName]
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
                ? `transform ${INTRO2_DURATION_MS}ms cubic-bezier(0.22, 0.86, 0.24, 1) ${introDelayMs}ms, ` +
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
