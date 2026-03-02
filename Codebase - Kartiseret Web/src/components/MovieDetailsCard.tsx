import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { X } from "lucide-react";
import type { Movie } from "../data/movies";
import type { PosterSourceRect } from "./MovieScrollerBase";
import { MovieDetailsContent } from "./MovieDetailsContent";

type MovieDetailsCardProps = {
  movie: Movie;
  sourceRect?: PosterSourceRect | null;
  onClose: () => void;
};

export function MovieDetailsCard({
  movie,
  sourceRect,
  onClose,
}: MovieDetailsCardProps) {
  const posterRef = useRef<HTMLImageElement | null>(null);
  const ghostRef = useRef<HTMLImageElement | null>(null);
  const targetRectRef = useRef<PosterSourceRect | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const settleTimeoutRef = useRef<number | null>(null);
  const titleId = useId();
  const [phase, setPhase] = useState<"opening" | "open" | "closing">(
    sourceRect ? "opening" : "open",
  );

  const clearScheduledAnimation = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (settleTimeoutRef.current !== null) {
      window.clearTimeout(settleTimeoutRef.current);
      settleTimeoutRef.current = null;
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

  const handleRequestClose = useCallback(() => {
    if (phase === "closing") {
      return;
    }

    if (!sourceRect) {
      onClose();
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

    setPhase("closing");
  }, [onClose, phase, sourceRect]);

  useEffect(() => {
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
  }, [handleRequestClose]);

  useLayoutEffect(() => {
    if (!sourceRect) {
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

      applyRectToGhost(sourceRect);

      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = window.requestAnimationFrame(() => {
          if (targetRectRef.current) {
            applyRectToGhost(targetRectRef.current);
          }
        });
      });

      settleTimeoutRef.current = window.setTimeout(() => {
        setPhase("open");
      }, 260);
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
        onClose();
        return;
      }

      applyRectToGhost(closeFromRect);

      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = window.requestAnimationFrame(() => {
          applyRectToGhost(sourceRect);
        });
      });

      settleTimeoutRef.current = window.setTimeout(() => {
        onClose();
      }, 260);
    }

    return () => {
      clearScheduledAnimation();
    };
  }, [
    applyRectToGhost,
    clearScheduledAnimation,
    movie,
    onClose,
    phase,
    sourceRect,
  ]);

  return (
    <div
      className={`details-overlay${
        phase === "opening" ? " is-opening" : ""
      }${phase === "closing" ? " is-closing" : ""}`}
      onClick={handleRequestClose}
      role="presentation"
    >
      <section
        className={`details-card${
          phase === "opening" ? " is-opening" : ""
        }${phase === "closing" ? " is-closing" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <button
          type="button"
          className="details-close"
          aria-label="Close movie details"
          onClick={handleRequestClose}
        >
          <X size={20} strokeWidth={2.1} />
        </button>

        <MovieDetailsContent
          movie={movie}
          posterRef={posterRef}
          titleId={titleId}
          posterClassName={`details-poster${
            phase === "open" ? " is-visible" : ""
          }${phase === "opening" ? " is-revealing" : ""}`}
        />
      </section>

      {sourceRect && phase !== "open" ? (
        <img
          ref={ghostRef}
          src={movie.imageSrc}
          alt=""
          aria-hidden="true"
          className={`details-poster-ghost${
            phase === "opening" ? " is-opening" : ""
          }${phase === "closing" ? " is-closing" : ""}`}
          style={
            phase === "opening"
              ? {
                  top: sourceRect.top,
                  left: sourceRect.left,
                  width: sourceRect.width,
                  height: sourceRect.height,
                }
              : undefined
          }
        />
      ) : null}
    </div>
  );
}
