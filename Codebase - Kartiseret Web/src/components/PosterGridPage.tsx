import { type CSSProperties, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pencil } from "lucide-react";

import { MoviePosterArtwork } from "./MoviePosterArtwork";
import { type Movie } from "../data/movieCatalog";
import { useI18n } from "../i18n/I18nContext";
import { getEnglishMovieTitle } from "../i18n/content";

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
};

export function PosterGridPage({
  title,
  movies,
  onPosterSelect,
  isAdmin = false,
  onAdminSaveEdit,
  onRefreshRequested,
}: PosterGridPageProps) {
  const { t } = useI18n();
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [columnCount, setColumnCount] = useState(1);
  const [editingMovie, setEditingMovie] = useState<Movie | null>(null);
  const [selectedTmdbId, setSelectedTmdbId] = useState("");
  const [manualTmdbId, setManualTmdbId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveComplete, setSaveComplete] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
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
        title: getEnglishMovieTitle(editingMovie),
        year: editingMovie.year || null,
        posterUrl: resolveOptionPosterSrc(
          editingMovie.localizations.en.imageSrc ?? editingMovie.imageSrc,
        ),
      },
      ...editingMovie.altOptions.map((option) => ({
        ...option,
        posterUrl: resolveOptionPosterSrc(option.posterUrl),
      })),
    ];
  }, [editingMovie]);

  return (
    <section className="poster-grid-page" aria-label={title}>
      <div ref={gridRef} className="poster-grid-page-grid" aria-label={title}>
        {posterEntries.map(({ movie, rowIndex }) => (
          <button
            key={movie.tmdbId}
            type="button"
            className="poster-grid-page-tile"
            aria-label={t("catalog.openInScroller", { title: movie.title })}
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
            {isAdmin ? (
              <button
                type="button"
                className="poster-grid-edit-trigger"
                aria-label={t("admin.editMapping", { title: movie.title })}
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
            ) : null}
            <MoviePosterArtwork
              title={movie.title}
              imageSrc={movie.imageSrc}
              alt={movie.title}
              loading="lazy"
              decoding="async"
              className="poster-grid-page-image"
            />
          </button>
        ))}
      </div>
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
            aria-label={t("admin.editMovie", { title: editingMovie.title })}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <h2 className="poster-grid-edit-heading">{t("admin.edit")}</h2>
            <p className="poster-grid-edit-subtitle" dir="auto">
              {editingMovie.title}
            </p>
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
                    imageSrc={option.posterUrl ?? undefined}
                    alt={option.title}
                    className="poster-grid-edit-option-image"
                    fallbackClassName="poster-grid-edit-option-image"
                    loading="lazy"
                    decoding="async"
                  />
                  <span className="poster-grid-edit-option-caption" dir="auto">
                    {option.title}
                    {option.year ? ` (${option.year})` : ""}
                  </span>
                </label>
              ))}
            </div>
            <label className="poster-grid-manual-label">
              {t("admin.manualTmdb")}
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
                placeholder={t("admin.manualTmdbPlaceholder")}
                dir="ltr"
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
                      console.error(
                        "Could not refresh movie data.",
                        refreshError,
                      );
                      setError(t("admin.refreshFailed"));
                    } finally {
                      setIsRefreshing(false);
                    }
                  }}
                >
                  {isRefreshing ? t("admin.refreshing") : t("admin.refresh")}
                </button>
                <button
                  type="button"
                  className="poster-grid-edit-cancel"
                  onClick={() => {
                    setEditingMovie(null);
                  }}
                >
                  {t("admin.close")}
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
                    const manualValueAsNumber = Number.parseInt(
                      normalizedManualValue,
                      10,
                    );
                    const hasValidManualValue =
                      normalizedManualValue.length > 0 &&
                      Number.isFinite(manualValueAsNumber) &&
                      manualValueAsNumber > 0;
                    const activeTmdbId = hasValidManualValue
                      ? String(manualValueAsNumber)
                      : selectedTmdbId;

                    if (!activeTmdbId) {
                      setError(t("admin.chooseOption"));
                      return;
                    }

                    if (
                      normalizedManualValue.length > 0 &&
                      !hasValidManualValue
                    ) {
                      setError(t("admin.invalidTmdb"));
                      return;
                    }

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
                      console.error(
                        "Could not update movie mapping.",
                        saveError,
                      );
                      setError(t("admin.updateFailed"));
                    } finally {
                      setIsSaving(false);
                    }
                  }}
                >
                  {isSaving ? t("admin.saving") : t("admin.save")}
                </button>
                <button
                  type="button"
                  className="poster-grid-edit-cancel"
                  disabled={isSaving}
                  onClick={() => {
                    setEditingMovie(null);
                  }}
                >
                  {t("admin.cancel")}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
