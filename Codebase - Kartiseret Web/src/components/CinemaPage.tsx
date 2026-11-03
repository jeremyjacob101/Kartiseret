import { publicCinemaPageResponseSchema } from "@kartiseret/contracts/public-data";
import { getCinemaIdentityById } from "@kartiseret/contracts/cinema-identities";
import { setSeoMetadata } from "../routing/seoMetadata";
import { getApiResponse } from "../data/apiClient";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { useEffect } from "react";

function useCinemaPage(cinemaId: string | undefined) {
  return useQuery({
    queryKey: ["publicCinema", cinemaId],
    enabled: cinemaId !== undefined,
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const result = await getApiResponse(
        `/api/v1/cinemas/${encodeURIComponent(cinemaId!)}`,
        publicCinemaPageResponseSchema,
        signal,
      );
      return result.data;
    },
  });
}

export function CinemaPage() {
  const { cinemaId } = useParams();
  const identity = cinemaId ? getCinemaIdentityById(cinemaId) : null;
  const cinemaQuery = useCinemaPage(identity?.id);
  const cinema = cinemaQuery.data;

  useEffect(() => {
    if (!identity) {
      setSeoMetadata({
        title: "Cinema not found | Kartiseret",
        description: "This cinema page is not available.",
        canonicalPath: window.location.pathname,
        robots: "noindex, nofollow",
      });
      return;
    }
    setSeoMetadata({
      title: `${identity.displayName} showtimes | Kartiseret`,
      description: `Upcoming movie showtimes at ${identity.displayName} in ${identity.city}.`,
      canonicalPath: `/c/${identity.id}`,
      robots: cinema ? "index, follow" : "noindex, nofollow",
    });
  }, [cinema, identity]);

  if (!identity) {
    return (
      <section className="page-panel">
        <h1>Cinema not found</h1>
        <p>This cinema page is not available.</p>
        <Link to="/">Return to Kartiseret</Link>
      </section>
    );
  }

  if (cinemaQuery.isError && !cinema) {
    return (
      <section className="page-panel">
        <h1>{identity.displayName}</h1>
        <p role="alert">Cinema information is temporarily unavailable.</p>
      </section>
    );
  }

  if (!cinema) {
    return (
      <section className="page-panel" aria-busy="true">
        <h1>{identity.displayName}</h1>
        <p role="status">Loading cinema details…</p>
      </section>
    );
  }

  return (
    <section className="page-panel">
      <article>
        <p className="eyebrow">CINEMA · {cinema.city.toUpperCase()}</p>
        <h1>{cinema.displayName}</h1>
        {cinema.address ? <p>{cinema.address}</p> : null}
        <p>
          <a href={cinema.mapUrl} target="_blank" rel="noreferrer">
            View location
          </a>
        </p>
        <h2>Upcoming movie showtimes</h2>
        {cinema.screenings.length ? (
          <ul>
            {cinema.screenings.map(({ movie, screening }, index) => (
              <li
                key={`${screening.tmdbId}-${screening.dateOfShowing}-${screening.showtime}-${index}`}
              >
                <Link to={`/${encodeURIComponent(movie.movieCode!)}`}>
                  {movie.title}
                </Link>
                {movie.year ? ` (${movie.year})` : ""} ·{" "}
                {screening.dateOfShowing} · {screening.showtime}
                {screening.englishHref ? (
                  <>
                    {" · "}
                    <a
                      href={screening.englishHref}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Booking information
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p>No upcoming showtimes are currently listed.</p>
        )}
      </article>
    </section>
  );
}
