import { MovieScroller3 } from "./MovieScroller3";
import type { MovieScroller3Props } from "./MovieScrollerBase3";

export type MovieScroller4Props = Omit<
  MovieScroller3Props,
  "focusOffsetItemSpans"
>;

export function MovieScroller4(props: MovieScroller4Props) {
  return <MovieScroller3 {...props} focusOffsetItemSpans={1} />;
}
