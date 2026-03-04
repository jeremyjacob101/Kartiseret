import { comingSoonMovies } from "../data/movieCatalog";
import {
  MovieScroller5,
  type MovieScroller5Props,
} from "./MovieScroller5";

export function MovieScroller6(
  props: Omit<MovieScroller5Props, "movieItems" | "detailVariant" | "detailEyebrow">,
) {
  if (comingSoonMovies.length === 0) {
    return null;
  }

  return (
    <MovieScroller5
      {...props}
      movieItems={comingSoonMovies}
      detailVariant="comingSoon"
      detailEyebrow="Coming soon"
    />
  );
}
