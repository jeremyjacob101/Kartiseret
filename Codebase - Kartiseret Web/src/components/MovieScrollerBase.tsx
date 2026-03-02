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
import { movies, type Movie } from "../data/movies";

export type PosterSourceRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type MovieScrollerProps = {
  cardWidth?: number;
  cardHeight?: number;
  gap?: number;
  maxWidth?: number | string;
  className?: string;
  onSelectMovie?: (
    movie: Movie,
    sourceRect: PosterSourceRect,
    itemIndex?: number,
    sourceOpacity?: number,
  ) => void;
  selectedItemIndex?: number | null;
  getCardClassName?: (state: MovieScrollerCardState) => string | undefined;
  getCardStyle?: (state: MovieScrollerCardState) => CSSProperties | undefined;
};

export type MovieScrollerCardState = {
  itemIndex: number;
  movieIndex: number;
  movie: Movie;
  isVisible: boolean;
  isSelected: boolean;
  selectedItemIndex: number | null;
  relativeIndex: number | null;
  positionalOpacity: number;
};

type WindowRange = {
  start: number;
  end: number;
  firstVisible: number;
  visibleCount: number;
};

type ViewportState = {
  scrollLeft: number;
  clientWidth: number;
};

const OVERSCAN_CARDS = 5;
const MAX_TRACK_PX = 12_000_000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function easeOutQuad(value: number): number {
  return 1 - (1 - value) ** 2;
}

export function MovieScrollerBase({
  cardWidth = 240,
  cardHeight = 360,
  gap = 16,
  maxWidth = "100%",
  className,
  onSelectMovie,
  selectedItemIndex = null,
  getCardClassName,
  getCardStyle,
}: MovieScrollerProps) {
  const movieCount = movies.length;
  const scrollerRef = useRef<HTMLElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const seenPosterSrcRef = useRef(new Set<string>());
  const focusedScaleBoost = 0.15;
  const maxCardHeight = Math.ceil(cardHeight * (1 + focusedScaleBoost));

  const itemSpan = cardWidth + gap;

  const repeatSets = useMemo(() => {
    const setsByWidth = Math.floor(
      MAX_TRACK_PX / Math.max(itemSpan * movieCount, 1),
    );
    const bounded = Math.max(101, setsByWidth);
    return bounded % 2 === 0 ? bounded + 1 : bounded;
  }, [itemSpan, movieCount]);

  const totalItems = movieCount * repeatSets;
  const middleSetStartIndex = Math.floor(repeatSets / 2) * movieCount;
  const trackWidth = gap + totalItems * itemSpan;

  const [range, setRange] = useState<WindowRange>(() => {
    const start = clamp(
      middleSetStartIndex - OVERSCAN_CARDS,
      0,
      totalItems - 1,
    );
    const end = clamp(middleSetStartIndex + OVERSCAN_CARDS, 0, totalItems - 1);
    return {
      start,
      end,
      firstVisible: middleSetStartIndex,
      visibleCount: 1,
    };
  });
  const [viewport, setViewport] = useState<ViewportState>({
    scrollLeft: 0,
    clientWidth: 0,
  });

  const calculateRange = useCallback(
    (scrollLeft: number, clientWidth: number): WindowRange => {
      const adjustedLeft = Math.max(scrollLeft - gap, 0);
      const firstVisible = clamp(
        Math.floor(adjustedLeft / itemSpan),
        0,
        totalItems - 1,
      );
      const visibleCount = Math.max(
        1,
        Math.ceil((clientWidth + gap) / itemSpan) + 1,
      );
      const start = clamp(firstVisible - OVERSCAN_CARDS, 0, totalItems - 1);
      const end = clamp(
        firstVisible + visibleCount + OVERSCAN_CARDS - 1,
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
        middleSetStartIndex * itemSpan -
        (scroller.clientWidth - cardWidth) / 2,
    );

    if (Math.abs(scroller.scrollLeft - centeredScrollLeft) > 0.5) {
      scroller.scrollLeft = centeredScrollLeft;
    }

    updateWindowFromScroller();
  }, [cardWidth, gap, itemSpan, middleSetStartIndex, updateWindowFromScroller]);

  const scheduleWindowUpdate = useCallback(() => {
    if (rafRef.current !== null) {
      return;
    }
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      updateWindowFromScroller();
    });
  }, [updateWindowFromScroller]);

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
  const viewportCenter = viewport.scrollLeft + viewport.clientWidth / 2;
  const fullOpacityRadius =
    viewport.clientWidth > 0 ? clamp(viewport.clientWidth * 0.12, 52, 96) : 96;
  const fadeEndDistance =
    viewport.clientWidth > 0
      ? Math.max(viewport.clientWidth / 2 + cardWidth * 0.5, cardWidth)
      : cardWidth;
  const focusPlateau = Math.max(itemSpan * 0.16, 28);
  const waveRadius = Math.max(itemSpan * 1.8, cardWidth * 1.55);

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
          ? clamp(
              (distanceFromCenter - fullOpacityRadius) /
                (fadeEndDistance - fullOpacityRadius),
              0,
              1,
            )
          : 1;
      const opacity =
        viewport.clientWidth > 0 ? 1 - easeOutQuad(fadeProgress) : 1;
      const waveProgress =
        viewport.clientWidth > 0 && waveRadius > focusPlateau
          ? clamp(
              1 -
                Math.max(distanceFromCenter - focusPlateau, 0) /
                  (waveRadius - focusPlateau),
              0,
              1,
            )
          : 0;
      const waveLift = Math.sin((waveProgress * Math.PI) / 2);
      const scale = 1 + focusedScaleBoost * waveLift;
      const cardState: MovieScrollerCardState = {
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
          data-scroller-item-index={i}
          data-scroller-positional-opacity={opacity.toFixed(6)}
          onClick={handleSelectMovie}
          className={["movie-scroller__card", cardClassName]
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
            opacity,
            background: "transparent",
            cursor: onSelectMovie ? "pointer" : "grab",
            transform:
              `translateZ(0) ` +
              `translateX(var(--card-translate-x, 0px)) ` +
              `translateY(var(--card-translate-y, 0px)) ` +
              `rotate(var(--card-rotate, 0deg)) ` +
              `scale(calc(${scale} * var(--card-scale, 1)))`,
            transformOrigin: "center bottom",
            transition:
              "transform 72ms cubic-bezier(0.22, 0.9, 0.34, 1), opacity 80ms linear",
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
        maxWidth,
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
