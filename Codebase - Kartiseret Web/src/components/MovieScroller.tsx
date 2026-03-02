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
import { type Movie } from "../data/movies";
import "./MovieScroller.css";
import { MovieDetailsContent } from "./MovieDetailsContent";
import {
  MovieScrollerBase,
  type MovieScrollerCardState,
  type MovieScrollerProps,
  type PosterSourceRect,
} from "./MovieScrollerBase";

type FocusMovieScrollerProps = Omit<MovieScrollerProps, "onSelectMovie">;

type SelectedMovieState = {
  movie: Movie;
  sourceRect: PosterSourceRect;
  itemIndex: number;
  sourceOpacity: number;
};

type FocusPhase = "idle" | "opening" | "open" | "closing";

function buildCardOffset(
  cardState: MovieScrollerCardState,
  phase: FocusPhase,
): CSSProperties | undefined {
  if (
    cardState.selectedItemIndex === null ||
    cardState.relativeIndex === null
  ) {
    return undefined;
  }

  const transition =
    "transform 520ms cubic-bezier(0.16, 0.9, 0.24, 1), " +
    "opacity 260ms ease, filter 520ms ease";

  if (cardState.isSelected) {
    if (phase === "closing") {
      return {
        opacity: cardState.positionalOpacity,
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
    return {
      opacity: cardState.positionalOpacity,
      filter: "blur(0px)",
      transition,
      "--card-translate-x": "0px",
      "--card-translate-y": "0px",
      "--card-rotate": "0deg",
      "--card-scale": "1",
    } as CSSProperties;
  }

  const direction = cardState.relativeIndex < 0 ? -1 : 1;
  const absOffset = Math.abs(cardState.relativeIndex);
  const travel = Math.min(760, 210 + absOffset * 86);
  const lift = Math.min(110, 18 + absOffset * 11);
  const rotate = direction * Math.min(20, 5 + absOffset * 2.3);
  const scale = Math.max(0.7, 0.94 - absOffset * 0.05);
  const delay = Math.min(110, absOffset * 16);

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

export function MovieScroller({
  className,
  ...props
}: FocusMovieScrollerProps) {
  const [selectedMovie, setSelectedMovie] = useState<SelectedMovieState | null>(
    null,
  );
  const [phase, setPhase] = useState<FocusPhase>("idle");
  const [isFocusPosterVisible, setIsFocusPosterVisible] = useState(false);
  const [showGhost, setShowGhost] = useState(false);
  const posterRef = useRef<HTMLImageElement | null>(null);
  const ghostRef = useRef<HTMLImageElement | null>(null);
  const targetRectRef = useRef<PosterSourceRect | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const posterRevealTimeoutRef = useRef<number | null>(null);
  const crossfadeTimeoutRef = useRef<number | null>(null);
  const completeTimeoutRef = useRef<number | null>(null);
  const ghostCleanupTimeoutRef = useRef<number | null>(null);
  const titleId = useId();

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

    if (completeTimeoutRef.current !== null) {
      window.clearTimeout(completeTimeoutRef.current);
      completeTimeoutRef.current = null;
    }

    if (ghostCleanupTimeoutRef.current !== null) {
      window.clearTimeout(ghostCleanupTimeoutRef.current);
      ghostCleanupTimeoutRef.current = null;
    }
  }, []);

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

  const handleSelectMovie = useCallback(
    (
      movie: Movie,
      sourceRect: PosterSourceRect,
      itemIndex?: number,
      sourceOpacity = 1,
    ) => {
      if (phase !== "idle" || itemIndex === undefined) {
        return;
      }

      setIsFocusPosterVisible(false);
      setShowGhost(true);
      setSelectedMovie({ movie, sourceRect, itemIndex, sourceOpacity });
      setPhase("opening");
    },
    [phase],
  );

  const handleRequestClose = useCallback(() => {
    if (!selectedMovie || phase === "idle" || phase === "closing") {
      return;
    }

    const currentPosterRect = posterRef.current?.getBoundingClientRect();
    if (currentPosterRect) {
      targetRectRef.current = {
        top: currentPosterRect.top,
        left: currentPosterRect.left,
        width: currentPosterRect.width,
        height: currentPosterRect.height,
      };
    }

    setShowGhost(true);
    setPhase("closing");
  }, [phase, selectedMovie]);

  useEffect(() => {
    if (!selectedMovie) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleRequestClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleRequestClose, selectedMovie]);

  useLayoutEffect(() => {
    if (!selectedMovie) {
      return;
    }

    clearScheduledAnimation();

    if (phase === "opening") {
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

      applyRectToGhost(selectedMovie.sourceRect);
      if (ghostRef.current) {
        ghostRef.current.style.opacity = `${selectedMovie.sourceOpacity}`;
      }

      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = window.requestAnimationFrame(() => {
          if (targetRectRef.current) {
            applyRectToGhost(targetRectRef.current);
          }
          if (ghostRef.current) {
            ghostRef.current.style.opacity = "1";
          }
        });
      });

      posterRevealTimeoutRef.current = window.setTimeout(() => {
        setIsFocusPosterVisible(true);
      }, 150);

      crossfadeTimeoutRef.current = window.setTimeout(() => {
        if (ghostRef.current) {
          ghostRef.current.style.opacity = "0";
        }
      }, 260);

      completeTimeoutRef.current = window.setTimeout(() => {
        setPhase("open");
        ghostCleanupTimeoutRef.current = window.setTimeout(() => {
          setShowGhost(false);
          ghostCleanupTimeoutRef.current = null;
        }, 140);
      }, 440);
    }

    if (phase === "closing") {
      const closeFromRect =
        targetRectRef.current ??
        (posterRef.current
          ? {
              top: posterRef.current.getBoundingClientRect().top,
              left: posterRef.current.getBoundingClientRect().left,
              width: posterRef.current.getBoundingClientRect().width,
              height: posterRef.current.getBoundingClientRect().height,
            }
          : null);

      if (!closeFromRect) {
        completeTimeoutRef.current = window.setTimeout(() => {
          setSelectedMovie(null);
          setPhase("idle");
          setShowGhost(false);
        }, 0);
        return;
      }

      applyRectToGhost(closeFromRect);
      if (ghostRef.current) {
        ghostRef.current.style.opacity = "1";
      }

      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = window.requestAnimationFrame(() => {
          setIsFocusPosterVisible(false);
          applyRectToGhost(selectedMovie.sourceRect);
          if (ghostRef.current) {
            ghostRef.current.style.opacity = `${selectedMovie.sourceOpacity}`;
          }
        });
      });

      completeTimeoutRef.current = window.setTimeout(() => {
        setSelectedMovie(null);
        setPhase("idle");
        setShowGhost(false);
      }, 300);
    }

    return () => {
      clearScheduledAnimation();
    };
  }, [applyRectToGhost, clearScheduledAnimation, phase, selectedMovie]);

  const getCardClassName = useCallback(
    (cardState: MovieScrollerCardState) => {
      if (!selectedMovie) {
        return undefined;
      }

      if (cardState.isSelected) {
        return "movie-scroller__card movie-scroller__card--selected";
      }

      return cardState.relativeIndex !== null && cardState.relativeIndex < 0
        ? "movie-scroller__card movie-scroller__card--dismiss-left"
        : "movie-scroller__card movie-scroller__card--dismiss-right";
    },
    [selectedMovie],
  );

  const getCardStyle = useCallback(
    (cardState: MovieScrollerCardState) => buildCardOffset(cardState, phase),
    [phase],
  );

  const focusStateClass =
    phase === "idle"
      ? ""
      : phase === "closing"
        ? " is-closing"
        : phase === "opening"
          ? " is-opening"
          : " is-open";

  return (
    <div className="movie-scroller-shell">
      <MovieScrollerBase
        {...props}
        selectedItemIndex={selectedMovie?.itemIndex ?? null}
        getCardClassName={getCardClassName}
        getCardStyle={getCardStyle}
        onSelectMovie={handleSelectMovie}
        className={[
          "movie-scroller",
          phase !== "idle" ? "is-focused" : "",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      />

      {selectedMovie ? (
        <div
          className={`movie-scroller-focus-stage${focusStateClass}`}
          onClick={handleRequestClose}
          role="presentation"
        >
          <section
            className="movie-scroller-focus-layout"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <button
              type="button"
              className="movie-scroller-close"
              aria-label="Close spotlight view"
              onClick={handleRequestClose}
            >
              <X size={20} strokeWidth={2.1} />
            </button>

            <div className="movie-scroller-focus-content">
              <MovieDetailsContent
                movie={selectedMovie.movie}
                posterRef={posterRef}
                titleId={titleId}
                posterClassName={`details-poster movie-scroller-focus-poster${
                  isFocusPosterVisible ? " is-visible" : ""
                }`}
                eyebrow="Revival spotlight"
              />
            </div>
          </section>

          {showGhost ? (
            <img
              ref={ghostRef}
              src={selectedMovie.movie.imageSrc}
              alt=""
              aria-hidden="true"
              className={`movie-scroller-poster-ghost${
                phase === "opening" ? " is-opening" : ""
              }${phase === "closing" ? " is-closing" : ""}`}
              style={
                phase === "opening"
                  ? {
                      top: selectedMovie.sourceRect.top,
                      left: selectedMovie.sourceRect.left,
                      width: selectedMovie.sourceRect.width,
                      height: selectedMovie.sourceRect.height,
                      opacity: selectedMovie.sourceOpacity,
                    }
                  : undefined
              }
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
