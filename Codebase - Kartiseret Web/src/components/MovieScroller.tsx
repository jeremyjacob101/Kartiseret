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
  targetRect: PosterSourceRect;
  itemIndex: number;
  sourceOpacity: number;
  targetOpacity: number;
};

type FocusPhase = "idle" | "opening" | "open" | "closing";

const CARD_MOVE_DURATION_MS = 520;
const CARD_OPACITY_DURATION_MS = 260;
const CARD_STAGGER_STEP_MS = 16;
const CARD_MAX_STAGGER_MS = 110;
const SCROLLER_CARD_RADIUS_PX = 14;
const FOCUS_POSTER_RADIUS_PX = 24;
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

const movieScrollerTimingStyle = {
  "--movie-scroller-stage-fade-duration": `${FOCUS_STAGE_FADE_DURATION_MS}ms`,
  "--movie-scroller-stage-close-delay": `${CLOSE_STAGE_FADE_DELAY_MS}ms`,
  "--movie-scroller-focus-poster-fade-duration": `${FOCUS_POSTER_FADE_DURATION_MS}ms`,
  "--movie-scroller-ghost-move-duration": `${POSTER_MOVE_DURATION_MS}ms`,
  "--movie-scroller-ghost-opacity-duration": `${POSTER_GHOST_OPACITY_DURATION_MS}ms`,
} as CSSProperties;

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
  const [isReturnHandoffReady, setIsReturnHandoffReady] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const posterRef = useRef<HTMLImageElement | null>(null);
  const ghostRef = useRef<HTMLImageElement | null>(null);
  const targetRectRef = useRef<PosterSourceRect | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const posterRevealTimeoutRef = useRef<number | null>(null);
  const crossfadeTimeoutRef = useRef<number | null>(null);
  const returnHandoffTimeoutRef = useRef<number | null>(null);
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

    if (returnHandoffTimeoutRef.current !== null) {
      window.clearTimeout(returnHandoffTimeoutRef.current);
      returnHandoffTimeoutRef.current = null;
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
        `[data-scroller-item-index="${itemIndex}"]`,
      );
      const value = item?.dataset.scrollerPositionalOpacity;
      const parsed = value ? Number(value) : Number.NaN;

      return Number.isFinite(parsed) ? parsed : fallback;
    },
    [],
  );

  const getCurrentDestinationRect = useCallback(
    (itemIndex: number, fallback: PosterSourceRect) => {
      const item = shellRef.current?.querySelector<HTMLElement>(
        `[data-scroller-item-index="${itemIndex}"]`,
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
      setIsReturnHandoffReady(false);
      setShowGhost(true);
      setSelectedMovie({
        movie,
        sourceRect,
        targetRect: sourceRect,
        itemIndex,
        sourceOpacity,
        targetOpacity: sourceOpacity,
      });
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

    const targetOpacity = getCurrentPositionalOpacity(
      selectedMovie.itemIndex,
      selectedMovie.sourceOpacity,
    );
    const targetRect = getCurrentDestinationRect(
      selectedMovie.itemIndex,
      selectedMovie.sourceRect,
    );

    setSelectedMovie((current) =>
      current ? { ...current, targetOpacity, targetRect } : current,
    );
    setIsReturnHandoffReady(false);
    setShowGhost(true);
    setPhase("closing");
  }, [
    getCurrentDestinationRect,
    getCurrentPositionalOpacity,
    phase,
    selectedMovie,
  ]);

  useEffect(() => {
    if (!selectedMovie) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const computedPaddingRight =
      Number.parseFloat(window.getComputedStyle(document.body).paddingRight) ||
      0;
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${computedPaddingRight + scrollbarWidth}px`;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleRequestClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
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
      applyGhostScrollerAppearance();
      if (ghostRef.current) {
        ghostRef.current.style.opacity = `${selectedMovie.sourceOpacity}`;
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
        ghostCleanupTimeoutRef.current = window.setTimeout(() => {
          setShowGhost(false);
          ghostCleanupTimeoutRef.current = null;
        }, POSTER_HANDOFF_TOTAL_MS - POSTER_MOVE_DURATION_MS);
      }, POSTER_HANDOFF_TOTAL_MS);
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
      applyGhostFocusAppearance();
      if (ghostRef.current) {
        ghostRef.current.style.opacity = "1";
      }

      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = window.requestAnimationFrame(() => {
          setIsFocusPosterVisible(false);
          applyRectToGhost(selectedMovie.targetRect);
          applyGhostScrollerAppearance();
          if (ghostRef.current) {
            ghostRef.current.style.opacity = `${selectedMovie.targetOpacity}`;
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
        setSelectedMovie(null);
        setPhase("idle");
        setShowGhost(false);
      }, POSTER_HANDOFF_TOTAL_MS);
    }

    return () => {
      clearScheduledAnimation();
    };
  }, [
    applyGhostFocusAppearance,
    applyGhostScrollerAppearance,
    applyRectToGhost,
    clearScheduledAnimation,
    phase,
    selectedMovie,
  ]);

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
    (cardState: MovieScrollerCardState) => {
      const style = buildCardOffset(cardState, phase);
      if (
        phase === "closing" &&
        selectedMovie &&
        cardState.isSelected &&
        style
      ) {
        return isReturnHandoffReady
          ? {
              ...style,
              opacity: selectedMovie.targetOpacity,
              transition: "none",
            }
          : style;
      }

      return style;
    },
    [isReturnHandoffReady, phase, selectedMovie],
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
    <div
      ref={shellRef}
      className="movie-scroller-shell"
      style={movieScrollerTimingStyle}
    >
      <MovieScrollerBase
        {...props}
        selectedItemIndex={selectedMovie?.itemIndex ?? null}
        getCardClassName={getCardClassName}
        getCardStyle={getCardStyle}
        onSelectMovie={handleSelectMovie}
        className={[
          "movie-scroller",
          phase === "opening" || phase === "open" ? "is-focused" : "",
          phase === "closing" ? "is-restoring" : "",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      />

      {selectedMovie ? (
        <>
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
              {selectedMovie.movie.backdropSrc ? (
                <div
                  className={`movie-scroller-focus-backdrop-shell${focusStateClass}`}
                  aria-hidden="true"
                >
                  <img
                    src={selectedMovie.movie.backdropSrc}
                    alt=""
                    className="movie-scroller-focus-backdrop"
                    decoding="async"
                    fetchPriority="high"
                  />
                </div>
              ) : null}

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
          </div>

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
        </>
      ) : null}
    </div>
  );
}
