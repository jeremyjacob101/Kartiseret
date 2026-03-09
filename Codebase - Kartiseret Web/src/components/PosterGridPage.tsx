import { type Movie } from "../data/movieCatalog";

type PosterGridPageProps = {
  kicker: string;
  title: string;
  movies: readonly Movie[];
  onPosterSelect: (movie: Movie) => void;
};

export function PosterGridPage({
  kicker,
  title,
  movies,
  onPosterSelect,
}: PosterGridPageProps) {
  return (
    <section className="poster-grid-page" aria-label={title}>
      <div className="section-heading poster-grid-page__heading">
        <p className="section-kicker">{kicker}</p>
        <h1 className="section-title">{title}</h1>
      </div>
      <div className="poster-grid-page__grid" aria-label={title}>
        {movies.map((movie) => (
          <button
            key={movie.tmdbId}
            type="button"
            className="poster-grid-page__tile"
            aria-label={`Open ${movie.title} in scroller view`}
            title={movie.title}
            onClick={() => {
              onPosterSelect(movie);
            }}
          >
            <img
              src={movie.imageSrc}
              alt={movie.title}
              loading="lazy"
              decoding="async"
              className="poster-grid-page__image"
            />
          </button>
        ))}
      </div>
    </section>
  );
}
