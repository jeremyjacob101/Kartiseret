import "./MovieScroller1.css";
import {
  MovieScrollerBase,
  type MovieScrollerProps,
} from "./MovieScrollerBase";

export function MovieScroller1({ className, ...props }: MovieScrollerProps) {
  return (
    <MovieScrollerBase
      {...props}
      className={["movie-scroller-1", className].filter(Boolean).join(" ")}
    />
  );
}
