import { Search } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { type Movie } from "../data/movieCatalog";

export type MovieSearchMode = "nowPlaying" | "comingSoon";

export type MovieSearchCollection = {
  mode: MovieSearchMode;
  label: string;
  movies: readonly Movie[];
};

export type MovieSearchResult = {
  tmdbId: string;
  title: string;
  year: number;
  imageSrc: string;
  mode: MovieSearchMode;
  sectionLabel: string;
};

type MovieSearchMenuProps = {
  collections: readonly MovieSearchCollection[];
  loading?: boolean;
  onOpen?: () => void;
  onSelectResult: (result: MovieSearchResult) => void;
};

const MAX_RESULTS = 10;

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function getSearchScore(movie: Movie, query: string): number {
  const title = normalizeSearchText(movie.title);
  const year = String(movie.year);

  if (title === query) {
    return 500;
  }

  if (title.startsWith(query)) {
    return 400;
  }

  if (title.includes(` ${query}`)) {
    return 320;
  }

  if (title.includes(query)) {
    return 240;
  }

  if (year === query) {
    return 180;
  }

  if (`${title} ${year}`.includes(query)) {
    return 120;
  }

  return 0;
}

export function MovieSearchMenu({
  collections,
  loading = false,
  onOpen,
  onSelectResult,
}: MovieSearchMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    onOpen?.();

    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);

    function handleOutsidePointerDown(event: PointerEvent) {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (!menuRef.current?.contains(target)) {
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    window.addEventListener("pointerdown", handleOutsidePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("pointerdown", handleOutsidePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onOpen]);

  const normalizedQuery = normalizeSearchText(query);

  const results = useMemo(() => {
    if (!normalizedQuery) {
      return [] as MovieSearchResult[];
    }

    return collections
      .flatMap((collection) =>
        collection.movies
          .map((movie) => ({
            result: {
              tmdbId: movie.tmdbId,
              title: movie.title,
              year: movie.year,
              imageSrc: movie.imageSrc,
              mode: collection.mode,
              sectionLabel: collection.label,
            } satisfies MovieSearchResult,
            score: getSearchScore(movie, normalizedQuery),
          }))
          .filter((entry) => entry.score > 0),
      )
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        if (left.result.year !== right.result.year) {
          return right.result.year - left.result.year;
        }

        return left.result.title.localeCompare(right.result.title);
      })
      .slice(0, MAX_RESULTS)
      .map((entry) => entry.result);
  }, [collections, normalizedQuery]);

  function handleQueryChange(event: ChangeEvent<HTMLInputElement>) {
    setQuery(event.target.value);
  }

  function handleResultSelect(result: MovieSearchResult) {
    onSelectResult(result);
    setIsOpen(false);
    setQuery("");
  }

  return (
    <div className="movie-search" ref={menuRef}>
      <button
        type="button"
        className={`movie-search-trigger${isOpen ? " is-open" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label="Search movies"
        onClick={() => {
          setIsOpen((open) => !open);
        }}
      >
        <Search size={18} strokeWidth={1.9} />
      </button>

      {isOpen ? (
        <div className="movie-search-panel" role="dialog" aria-label="Search movies">
          <label className="movie-search-field">
            <span className="movie-search-title">Search movies</span>
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={handleQueryChange}
              placeholder="Search now playing and coming soon"
            />
          </label>

          <div className="movie-search-results" role="list">
            {!normalizedQuery ? (
              <p className="movie-search-empty">Type a movie title to search.</p>
            ) : loading && results.length === 0 ? (
              <p className="movie-search-empty">Loading movie library...</p>
            ) : results.length === 0 ? (
              <p className="movie-search-empty">No movies found.</p>
            ) : (
              results.map((result) => (
                <button
                  key={`${result.mode}-${result.tmdbId}`}
                  type="button"
                  className="movie-search-result"
                  onClick={() => {
                    handleResultSelect(result);
                  }}
                >
                  <img
                    src={result.imageSrc}
                    alt=""
                    aria-hidden="true"
                    className="movie-search-result-image"
                    decoding="async"
                    loading="lazy"
                  />
                  <span className="movie-search-result-copy">
                    <span className="movie-search-result-title">
                      {result.title}
                    </span>
                    <span className="movie-search-result-meta">
                      {result.sectionLabel} • {result.year || "Unknown year"}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
