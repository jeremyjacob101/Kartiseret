import { publicCinemaPageResponseSchema } from "@kartiseret/contracts/public-data";
import { getCinemaIdentityById } from "@kartiseret/contracts/cinema-identities";
import { getShowtimesCityPath } from "@kartiseret/contracts/showtime-routes";
import { PublicRouteLink } from "../routing/PublicRouteLink";
import { setSeoMetadata } from "../routing/seoMetadata";
import { AllShowtimesPage } from "./AllShowtimesPage";
import { getApiResponse } from "../data/apiClient";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { useEffect } from "react";
import "./CinemaPage.css";

function useCinemaPage(cinemaId: string | undefined) {
  return useQuery({
    queryKey: ["publicCinema", cinemaId],
    enabled: cinemaId !== undefined,
    staleTime: 90_000,
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
  const alias = identity?.cinemaNameKeys.find((name) =>
    /^Yes Planet\s/i.test(name));

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
      title: `${identity.displayName}${alias ? ` (${alias})` : ""} showtimes in ${identity.city} | Kartiseret`,
      description: `Browse upcoming movie showtimes at ${identity.displayName}${alias ? `, also known as ${alias}` : ""}, in ${identity.city}.`,
      canonicalPath: window.location.pathname,
      robots: cinema?.screenings.length ? "index, follow" : "noindex, nofollow",
      jsonLd: cinema
        ? {
            "@context": "https://schema.org",
            "@type": "MovieTheater",
            name: cinema.displayName,
            ...(alias ? { alternateName: alias } : {}),
            url: `https://seret.site${window.location.pathname}`,
            address: {
              "@type": "PostalAddress",
              ...(cinema.address ? { streetAddress: cinema.address } : {}),
              addressLocality: cinema.city,
              addressCountry: "IL",
            },
            geo: {
              "@type": "GeoCoordinates",
              latitude: cinema.latitude,
              longitude: cinema.longitude,
            },
          }
        : undefined,
    });
  }, [alias, cinema, identity]);

  if (!identity) {
    return (
      <section className="page-panel cinema-page-shell">
        <div className="cinema-page-state">
          <h1>Cinema not found</h1>
          <p>This cinema page is not available.</p>
          <PublicRouteLink to="/showtimes">
            Browse movie showtimes
          </PublicRouteLink>
        </div>
      </section>
    );
  }

  if (cinemaQuery.isError && !cinema) {
    return (
      <section className="page-panel cinema-page-shell">
        <div className="cinema-page-state" role="alert">
          <h1>{identity.displayName}</h1>
          <p>Cinema information is temporarily unavailable.</p>
          <PublicRouteLink to={getShowtimesCityPath(identity.city)}>
            Browse more showtimes in {identity.city}
          </PublicRouteLink>
        </div>
      </section>
    );
  }

  if (!cinema) {
    return (
      <section className="page-panel cinema-page-shell" aria-busy="true">
        <div className="cinema-page-state">
          <h1>{identity.displayName}</h1>
          <p role="status">Loading showtimes…</p>
        </div>
      </section>
    );
  }

  return (
    <section className="page-panel cinema-page-shell">
      <AllShowtimesPage cinema={cinema} />
    </section>
  );
}
