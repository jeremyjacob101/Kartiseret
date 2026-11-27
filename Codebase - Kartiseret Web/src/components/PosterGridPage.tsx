import { homepageFeatureRating, MAX_HOMEPAGE_FEATURE_RATING } from "@kartiseret/contracts/homepage-featured";
import { type CSSProperties, type FormEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { HomepageMovieHighlight } from "@kartiseret/contracts/homepage-featured";
import { tmdbIdSchema } from "@kartiseret/contracts/runtime";
import { MoviePosterArtwork } from "./MoviePosterArtwork";
import { type Movie } from "../data/movieCatalog";
import { Pencil } from "lucide-react";
import { Star } from "lucide-react";

const POSTER_GRID_MIN_COLUMN_WIDTH_FALLBACK = 150;

function resolvePosterGridColumnCount(gridElement: HTMLDivElement) {
  const computedStyle = window.getComputedStyle(gridElement);
  const gapValue = Number.parseFloat(
    computedStyle.columnGap || computedStyle.gap || "0",
  );
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

  return Math.max(
    1,
    Math.floor((gridWidth + gapValue) / (minimumColumnWidth + gapValue)),
  );
}

function resolveOptionPosterSrc(posterUrl: string | null | undefined): string {
  const normalizedValue = (posterUrl ?? "").trim();

  if (!normalizedValue) {
    return "";
  }

  if (
    normalizedValue.startsWith("http://") ||
    normalizedValue.startsWith("https://")
  ) {
    return normalizedValue;
  }

  return `https://image.tmdb.org/t/p/w342${normalizedValue.startsWith("/") ? normalizedValue : `/${normalizedValue}`}`;
}

type PosterGridPageProps = {
  title: string;
  movies: readonly Movie[];
  onPosterSelect: (movie: Movie) => void;
  isAdmin?: boolean;
  onAdminSaveEdit?: (payload: {
    currentTmdbId: string;
    selectedTmdbId: string;
    selectedTitle?: string | null;
    selectedYear?: number | null;
    selectedPosterUrl?: string | null;
    isManualEntry: boolean;
  }) => Promise<void>;
  onRefreshRequested?: () => Promise<void>;
  homepageHighlights?: readonly HomepageMovieHighlight[];
  onAdminSaveHomepageHighlight?: (
    highlight: HomepageMovieHighlight,
  ) => Promise<void>;
  onAdminRemoveHomepageHighlight?: (tmdbId: string) => Promise<void>;
};

export function PosterGridPage({
  title,
  movies,
  onPosterSelect,
  isAdmin = false,
  onAdminSaveEdit,
  onRefreshRequested,
  homepageHighlights = [],
  onAdminSaveHomepageHighlight,
  onAdminRemoveHomepageHighlight,
}: PosterGridPageProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [columnCount, setColumnCount] = useState(1);
  const [editingMovie, setEditingMovie] = useState<Movie | null>(null);
  const [selectedTmdbId, setSelectedTmdbId] = useState("");
  const [manualTmdbId, setManualTmdbId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveComplete, setSaveComplete] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [highlightingMovie, setHighlightingMovie] = useState<Movie | null>(
    null,
  );
  const [highlightStartsOn, setHighlightStartsOn] = useState("");
  const [highlightEndsOn, setHighlightEndsOn] = useState("");
  const [highlightLabel, setHighlightLabel] =
    useState<HomepageMovieHighlight["label"]>(null);
  const [highlightPriority, setHighlightPriority] = useState(
    homepageFeatureRating,
  );
  const [highlightError, setHighlightError] = useState<string | null>(null);
  const [highlightSaving, setHighlightSaving] = useState(false);
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
        currentColumnCount === nextColumnCount
          ? currentColumnCount
          : nextColumnCount);
    };

    const frameId = window.requestAnimationFrame(() => {
      updateColumnCount();
    });

    if (typeof ResizeObserver === "function") {
      const resizeObserver = new ResizeObserver(() => {
        updateColumnCount();
      });

      resizeObserver.observe(gridElement);

      return () => {
        window.cancelAnimationFrame(frameId);
        resizeObserver.disconnect();
      };
    }

    window.addEventListener("resize", updateColumnCount);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updateColumnCount);
    };
  }, []);

  const editOptions = useMemo(() => {
    if (!editingMovie) {
      return [];
    }

    return [
      {
        tmdbId: editingMovie.tmdbId,
        title: editingMovie.title,
        year: editingMovie.year || null,
        posterUrl: resolveOptionPosterSrc(editingMovie.imageSrc || null),
      },
      ...editingMovie.altOptions.map((option) => ({
        ...option,
        posterUrl: resolveOptionPosterSrc(option.posterUrl),
      })),
    ];
  }, [editingMovie]);

  const openHighlightEditor = (movie: Movie) => {
    const existing = homepageHighlights.find(
      (item) => item.tmdbId === movie.tmdbId,
    );
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jerusalem",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const end = new Date(`${today}T12:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 30);
    setHighlightingMovie(movie);
    setHighlightStartsOn(existing?.startsOn ?? today);
    setHighlightEndsOn(existing?.endsOn ?? end.toISOString().slice(0, 10));
    setHighlightLabel(existing?.label ?? null);
    setHighlightPriority(homepageFeatureRating(existing?.priority));
    setHighlightError(null);
  };

  const saveHighlight = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!highlightingMovie || !onAdminSaveHomepageHighlight) return;
    setHighlightSaving(true);
    setHighlightError(null);
    try {
      await onAdminSaveHomepageHighlight({
        tmdbId: highlightingMovie.tmdbId,
        startsOn: highlightStartsOn,
        endsOn: highlightEndsOn,
        priority: highlightPriority,
        label: highlightLabel,
        enabled: true,
      });
      setHighlightingMovie(null);
    } catch (error) {
      setHighlightError(
        error instanceof Error
          ? error.message
          : "Could not save homepage highlight.",
      );
    } finally {
      setHighlightSaving(false);
    }
  };

  return (
    <section className="poster-grid-page" aria-label={title}>
      <h1 className="poster-grid-page-heading section-title">{title}</h1>
      <div ref={gridRef} className="poster-grid-page-grid" aria-label={title}>
        {posterEntries.map(({ movie, rowIndex }) => (
          <div
            key={movie.tmdbId}
            className="poster-grid-page-tile"
            title={movie.title}
            style={
              {
                "--poster-grid-row-index": rowIndex,
              } as CSSProperties
            }
          >
            {isAdmin ? (
              <>
                <button
                  type="button"
                  className="poster-grid-edit-trigger"
                  aria-label={`Edit mapping for ${movie.title}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setEditingMovie(movie);
                    setSelectedTmdbId(movie.tmdbId);
                    setManualTmdbId("");
                    setError(null);
                    setIsSaving(false);
                    setSaveComplete(false);
                  }}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  className="poster-grid-highlight-trigger"
                  aria-label={`${homepageHighlights.some((item) => item.tmdbId === movie.tmdbId && item.enabled) ? "Edit" : "Feature"} ${movie.title} on homepage`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    openHighlightEditor(movie);
                  }}
                >
                  <Star
                    size={14}
                    fill={
                      homepageHighlights.some(
                        (item) => item.tmdbId === movie.tmdbId && item.enabled,
                      )
                        ? "currentColor"
                        : "none"
                    }
                  />
                </button>
              </>
            ) : null}
            {movie.publicRouteCode ? (
              <a
                className="poster-grid-page-tile-link"
                href={`/${movie.publicRouteCode}`}
                aria-label={`Open ${movie.title} movie page`}
                title={movie.title}
                onClick={(event) => {
                  if (
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  ) {
                    return;
                  }
                  event.preventDefault();
                  onPosterSelect(movie);
                }}
              >
                <MoviePosterArtwork
                  title={movie.title}
                  tmdbId={movie.tmdbId}
                  imageSrc={movie.imageSrc}
                  imageSrcSet={movie.imageSrcSet}
                  imageSizes="(max-width: 640px) 42vw, 210px"
                  alt={movie.title}
                  loading="lazy"
                  decoding="async"
                  className="poster-grid-page-image"
                />
              </a>
            ) : (
              <button
                className="poster-grid-page-tile-link poster-grid-page-tile-button"
                type="button"
                aria-label={`Open ${movie.title} in scroller view`}
                onClick={() => onPosterSelect(movie)}
              >
                <MoviePosterArtwork
                  title={movie.title}
                  tmdbId={movie.tmdbId}
                  imageSrc={movie.imageSrc}
                  imageSrcSet={movie.imageSrcSet}
                  imageSizes="(max-width: 640px) 42vw, 210px"
                  alt={movie.title}
                  loading="lazy"
                  decoding="async"
                  className="poster-grid-page-image"
                />
              </button>
            )}
          </div>
        ))}
      </div>
      {highlightingMovie ? (
        <div
          className="poster-grid-edit-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !highlightSaving)
              setHighlightingMovie(null);
          }}
        >
          <form
            className="poster-grid-edit-modal homepage-feature-edit-form"
            role="dialog"
            aria-modal="true"
            aria-labelledby="poster-grid-highlight-heading"
            onSubmit={saveHighlight}
          >
            <h2
              id="poster-grid-highlight-heading"
              className="poster-grid-edit-heading"
            >
              Feature on homepage
            </h2>
            <p className="poster-grid-edit-subtitle">
              {highlightingMovie.title}
            </p>
            <div className="homepage-promo-date-row">
              <label>
                Starts
                <input
                  type="date"
                  required
                  value={highlightStartsOn}
                  onChange={(event) => setHighlightStartsOn(event.target.value)}
                />
              </label>
              <label>
                Ends
                <input
                  type="date"
                  required
                  value={highlightEndsOn}
                  onChange={(event) => setHighlightEndsOn(event.target.value)}
                />
              </label>
            </div>
            <div className="homepage-promo-date-row">
              <label>
                Label
                <select
                  value={highlightLabel ?? ""}
                  onChange={(event) =>
                    setHighlightLabel(
                      (event.target.value ||
                        null) as HomepageMovieHighlight["label"],
                    )
                  }
                >
                  <option value="">No label</option>
                  <option value="kids">Kids</option>
                  <option value="sci-fi">Sci-Fi</option>
                  <option value="marvel">Marvel</option>
                </select>
              </label>
              <label>
                Feature rating
                <input
                  type="number"
                  min={0}
                  max={MAX_HOMEPAGE_FEATURE_RATING}
                  required
                  value={highlightPriority}
                  onChange={(event) =>
                    setHighlightPriority(Number(event.target.value))
                  }
                />
              </label>
            </div>
            {highlightError ? (
              <p className="homepage-admin-error" role="alert">
                {highlightError}
              </p>
            ) : null}
            <div className="poster-grid-edit-actions">
              {homepageHighlights.some(
                (item) => item.tmdbId === highlightingMovie.tmdbId,
              ) ? (
                <button
                  className="poster-grid-edit-cancel"
                  type="button"
                  disabled={highlightSaving}
                  onClick={async () => {
                    if (!onAdminRemoveHomepageHighlight) return;
                    setHighlightSaving(true);
                    setHighlightError(null);
                    try {
                      await onAdminRemoveHomepageHighlight(
                        highlightingMovie.tmdbId,
                      );
                      setHighlightingMovie(null);
                    } catch (error) {
                      setHighlightError(
                        error instanceof Error
                          ? error.message
                          : "Could not remove homepage highlight.",
                      );
                    } finally {
                      setHighlightSaving(false);
                    }
                  }}
                >
                  Remove
                </button>
              ) : (
                <span />
              )}
              <button
                className="poster-grid-edit-action"
                type="submit"
                disabled={highlightSaving}
              >
                {highlightSaving ? "Saving…" : "Save highlight"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {editingMovie ? (
        <div
          className="poster-grid-edit-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!isSaving) {
              setEditingMovie(null);
            }
          }}
        >
          <div
            className="poster-grid-edit-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Edit ${editingMovie.title}`}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <h2 className="poster-grid-edit-heading">Admin Edit</h2>
            <p className="poster-grid-edit-subtitle">{editingMovie.title}</p>
            <div className="poster-grid-edit-options" role="radiogroup">
              {editOptions.map((option) => (
                <label
                  key={option.tmdbId}
                  className={`poster-grid-edit-option${
                    selectedTmdbId === option.tmdbId ? " is-selected" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="tmdb-option"
                    value={option.tmdbId}
                    checked={selectedTmdbId === option.tmdbId}
                    onChange={(event) => {
                      setSelectedTmdbId(event.target.value);
                      setManualTmdbId("");
                    }}
                  />
                  <MoviePosterArtwork
                    title={option.title}
                    tmdbId={option.tmdbId}
                    imageSrc={option.posterUrl ?? undefined}
                    alt={option.title}
                    className="poster-grid-edit-option-image"
                    fallbackClassName="poster-grid-edit-option-image"
                    loading="lazy"
                    decoding="async"
                  />
                  <span className="poster-grid-edit-option-caption">
                    {option.title}
                    {option.year ? ` (${option.year})` : ""}
                  </span>
                </label>
              ))}
            </div>
            <label className="poster-grid-manual-label">
              Manual TMDB ID
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                className="poster-grid-manual-input"
                value={manualTmdbId}
                onChange={(event) => {
                  setManualTmdbId(event.target.value.replace(/[^\d]/g, ""));
                  setSelectedTmdbId("");
                }}
                placeholder="e.g. 693134"
              />
            </label>
            {error ? <p className="poster-grid-edit-error">{error}</p> : null}
            {saveComplete ? (
              <div className="poster-grid-edit-actions">
                <button
                  type="button"
                  className="poster-grid-edit-action"
                  disabled={isRefreshing}
                  onClick={async () => {
                    if (!onRefreshRequested) {
                      setEditingMovie(null);
                      return;
                    }

                    setIsRefreshing(true);
                    try {
                      await onRefreshRequested();
                      setEditingMovie(null);
                    } catch (refreshError) {
                      setError(
                        refreshError instanceof Error
                          ? refreshError.message
                          : "Refresh failed.",
                      );
                    } finally {
                      setIsRefreshing(false);
                    }
                  }}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh data"}
                </button>
                <button
                  type="button"
                  className="poster-grid-edit-cancel"
                  onClick={() => {
                    setEditingMovie(null);
                  }}
                >
                  Close
                </button>
              </div>
            ) : (
              <div className="poster-grid-edit-actions">
                <button
                  type="button"
                  className="poster-grid-edit-action"
                  disabled={isSaving}
                  onClick={async () => {
                    if (!onAdminSaveEdit || !editingMovie) {
                      return;
                    }

                    const normalizedManualValue = manualTmdbId.trim();
                    const activeIdResult = tmdbIdSchema.safeParse(
                      normalizedManualValue || selectedTmdbId,
                    );

                    if (!activeIdResult.success) {
                      setError(
                        normalizedManualValue
                          ? "Manual TMDB ID must be a positive integer."
                          : "Choose an option or enter a TMDB ID.",
                      );
                      return;
                    }

                    const activeTmdbId = activeIdResult.data;
                    const selectedOption = editOptions.find(
                      (option) => option.tmdbId === activeTmdbId,
                    );
                    const isManualEntry = Boolean(normalizedManualValue.length);

                    setError(null);
                    setIsSaving(true);
                    try {
                      await onAdminSaveEdit({
                        currentTmdbId: editingMovie.tmdbId,
                        selectedTmdbId: activeTmdbId,
                        selectedTitle: selectedOption?.title ?? null,
                        selectedYear: selectedOption?.year ?? null,
                        selectedPosterUrl: selectedOption?.posterUrl ?? null,
                        isManualEntry,
                      });
                      setSaveComplete(true);
                    } catch (saveError) {
                      setError(
                        saveError instanceof Error
                          ? saveError.message
                          : "Failed to update movie.",
                      );
                    } finally {
                      setIsSaving(false);
                    }
                  }}
                >
                  {isSaving ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  className="poster-grid-edit-cancel"
                  disabled={isSaving}
                  onClick={() => {
                    setEditingMovie(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
