import {
  type CSSProperties,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { type Movie } from "../data/movieCatalog";

const POSTER_GRID_MIN_COLUMN_WIDTH_FALLBACK = 150;

function resolvePosterGridColumnCount(gridElement: HTMLDivElement) {
  const computedStyle = window.getComputedStyle(gridElement);
  const gapValue = Number.parseFloat(computedStyle.columnGap || computedStyle.gap || "0");
  const configuredMinColumnWidth = Number.parseFloat(
    computedStyle.getPropertyValue("--poster-grid-min-column-width"),
  );
  const minimumColumnWidth =
    Number.isFinite(configuredMinColumnWidth) && configuredMinColumnWidth > 0
      ? configuredMinColumnWidth
      : POSTER_GRID_MIN_COLUMN_WIDTH_FALLBACK;
  const gridWidth = gridElement.getBoundingClientRect().width;

  if (!(gridWidth > 0)) {
    return 1;
  }

  return Math.max(1, Math.floor((gridWidth + gapValue) / (minimumColumnWidth + gapValue)));
}

type PosterGridPageProps = {
  kicker: string;
  title: string;
  movies: readonly Movie[];
  revealVersion: number;
  onPosterSelect: (movie: Movie) => void;
};

export function PosterGridPage({
  kicker,
  title,
  movies,
  revealVersion,
  onPosterSelect,
}: PosterGridPageProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [columnCount, setColumnCount] = useState(1);
  const [isRevealed, setIsRevealed] = useState(false);
  const posterEntries = useMemo(
    () =>
      movies.map((movie, index) => ({
        movie,
        rowIndex: Math.floor(index / Math.max(columnCount, 1)),
      })),
    [columnCount, movies],
  );

  useLayoutEffect(() => {
    const gridElement = gridRef.current;

    if (!gridElement || typeof window === "undefined") {
      return undefined;
    }

    const updateColumnCount = () => {
      const nextColumnCount = resolvePosterGridColumnCount(gridElement);
      setColumnCount((currentColumnCount) =>
        currentColumnCount === nextColumnCount ? currentColumnCount : nextColumnCount,
      );
    };

    updateColumnCount();

    if (typeof ResizeObserver === "function") {
      const resizeObserver = new ResizeObserver(() => {
        updateColumnCount();
      });

      resizeObserver.observe(gridElement);

      return () => {
        resizeObserver.disconnect();
      };
    }

    window.addEventListener("resize", updateColumnCount);

    return () => {
      window.removeEventListener("resize", updateColumnCount);
    };
  }, []);

  useLayoutEffect(() => {
    setIsRevealed(false);

    const frameId = window.requestAnimationFrame(() => {
      setIsRevealed(true);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [revealVersion, title]);

  return (
    <section className="poster-grid-page" aria-label={title}>
      <div className="section-heading poster-grid-page__heading">
        <p className="section-kicker">{kicker}</p>
        <h1 className="section-title">{title}</h1>
      </div>
      <div ref={gridRef} className="poster-grid-page__grid" aria-label={title}>
        {posterEntries.map(({ movie, rowIndex }) => (
          <button
            key={movie.tmdbId}
            type="button"
            className={[
              "poster-grid-page__tile",
              isRevealed ? "poster-grid-page__tile--revealed" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-label={`Open ${movie.title} in scroller view`}
            title={movie.title}
            style={
              {
                "--poster-grid-row-index": rowIndex,
              } as CSSProperties
            }
            onClick={() => {
              onPosterSelect(movie);
            }}
          >
            <img
              src={movie.imageSrc}
              alt={movie.title}
              loading="lazy"
              decoding="async"
              className="poster-grid-page__image"
            />
          </button>
        ))}
      </div>
    </section>
  );
}
