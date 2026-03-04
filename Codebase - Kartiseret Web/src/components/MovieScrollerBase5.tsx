import {
  MovieScrollerBase3,
  type MovieScroller3CardState,
  type MovieScroller3Props,
  type PosterSourceRect3,
} from "./MovieScrollerBase3";

export type PosterSourceRect5 = PosterSourceRect3;

export type MovieScroller5Props = Omit<
  MovieScroller3Props,
  "focusOffsetItemSpans"
>;

export type MovieScroller5CardState = MovieScroller3CardState;

export function MovieScrollerBase5(props: MovieScroller5Props) {
  return <MovieScrollerBase3 {...props} focusOffsetItemSpans={1} />;
}
