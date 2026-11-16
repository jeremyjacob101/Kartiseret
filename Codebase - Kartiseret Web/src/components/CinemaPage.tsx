import { isCanonicalShowtimeFilterMatch, SHOWTIME_FILTER_OPTIONS, type ShowtimeFilterGroup } from "@kartiseret/contracts/showtime-links";
import { buildShowtimeFilterSelections, updateShowtimeFilterState } from "@kartiseret/contracts/showtime-filters";
import { useShowtimeViewPreferences } from "./showtimes/useShowtimeViewPreferences";
import { publicCinemaPageResponseSchema } from "@kartiseret/contracts/public-data";
import { getCanonicalShowtimeMeta } from "@kartiseret/contracts/showtime-filters";
import { getCinemaIdentityById } from "@kartiseret/contracts/cinema-identities";
import { ShowtimeFilterMenu } from "./showtimes/ShowtimeFilterMenu";
import { setSeoMetadata } from "../routing/seoMetadata";
import { getApiResponse } from "../data/apiClient";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { useEffect, useMemo } from "react";
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
  const viewPreferences = useShowtimeViewPreferences(
    `cinema:${identity?.id ?? cinemaId ?? "unknown"}`,
  );
  const showtimeSelections = useMemo(
    () =>
      buildShowtimeFilterSelections(
        SHOWTIME_FILTER_OPTIONS,
        viewPreferences.screeningFilters,
      ),
    [viewPreferences.screeningFilters],
  );
  const filteredScreenings = useMemo(
    () =>
      (cinema?.screenings ?? []).filter(({ screening }) => {
        const meta = getCanonicalShowtimeMeta({
          time: screening.showtime,
          screeningTech: screening.screeningTech,
          screeningType: screening.screeningType,
          dubLanguage: screening.dubLanguage,
        });
        return isCanonicalShowtimeFilterMatch(meta, showtimeSelections);
      }),
    [cinema?.screenings, showtimeSelections],
  );

  const handleShowtimeFilterToggle = (
    group: ShowtimeFilterGroup,
    value: string,
  ) => {
    const nextSelections: Record<ShowtimeFilterGroup, Set<string>> = {
      showType: new Set(showtimeSelections.showType),
      screenFormat: new Set(showtimeSelections.screenFormat),
      screeningTech: new Set(showtimeSelections.screeningTech),
      dubLanguage: new Set(showtimeSelections.dubLanguage),
    };
    const selected = nextSelections[group];
    if (selected.has(value)) selected.delete(value);
    else selected.add(value);
    viewPreferences.setScreeningFilters(
      updateShowtimeFilterState(
        viewPreferences.screeningFilters,
        SHOWTIME_FILTER_OPTIONS,
        nextSelections,
      ),
    );
  };

  const handleShowtimeFilterGroupToggle = (group: ShowtimeFilterGroup) => {
    const groupValues = SHOWTIME_FILTER_OPTIONS[group];
    const allSelected = groupValues.every((value) =>
      showtimeSelections[group].has(value));
    const nextSelections: Record<ShowtimeFilterGroup, Set<string>> = {
      showType: new Set(showtimeSelections.showType),
      screenFormat: new Set(showtimeSelections.screenFormat),
      screeningTech: new Set(showtimeSelections.screeningTech),
      dubLanguage: new Set(showtimeSelections.dubLanguage),
    };
    nextSelections[group] = allSelected ? new Set() : new Set(groupValues);
    viewPreferences.setScreeningFilters(
      updateShowtimeFilterState(
        viewPreferences.screeningFilters,
        SHOWTIME_FILTER_OPTIONS,
        nextSelections,
      ),
    );
  };

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
      jsonLd: cinema
        ? {
            "@context": "https://schema.org",
            "@type": "MovieTheater",
            name: cinema.displayName,
            url: `https://seret.site/c/${cinema.id}`,
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

  if (!viewPreferences.ready) {
    return (
      <section
        className="page-panel"
        aria-labelledby={`cinema-title-${identity.id}`}
      >
        <h1 id={`cinema-title-${identity.id}`}>{identity.displayName}</h1>
        <p role={viewPreferences.loadError ? "alert" : "status"}>
          {viewPreferences.loadError
            ? "Your showtime preferences could not be loaded."
            : "Loading your showtime preferences…"}
        </p>
        {viewPreferences.loadError ? (
          <button type="button" onClick={viewPreferences.retry}>
            Retry
          </button>
        ) : null}
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
        <div className="cinema-page-filter-row">
          <p>
            Screening preferences are applied. This cinema is included while
            you’re on its page.
          </p>
          <ShowtimeFilterMenu
            options={SHOWTIME_FILTER_OPTIONS}
            selections={showtimeSelections}
            onToggleOption={handleShowtimeFilterToggle}
            onToggleGroup={handleShowtimeFilterGroupToggle}
            onShowEverything={viewPreferences.showEverything}
            onRestoreDefaults={viewPreferences.restoreDefaults}
          />
        </div>
        {filteredScreenings.length ? (
          <ul>
            {filteredScreenings.map(({ movie, screening }, index) => (
              <li
                key={`${screening.tmdbId}-${screening.dateOfShowing}-${screening.showtime}-${index}`}
              >
                {movie.movieCode ? (
                  <Link to={`/${encodeURIComponent(movie.movieCode)}`}>
                    {movie.title}
                  </Link>
                ) : (
                  <span>{movie.title}</span>
                )}
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
        ) : cinema.screenings.length > 0 ? (
          <div className="details-empty-state">
            <div className="details-empty-state-panel">
              <p className="details-empty-state-title">
                No showtimes match your screening preferences.
              </p>
              <button type="button" onClick={viewPreferences.showEverything}>
                Show everything
              </button>
              <Link to="/user">Change saved preferences</Link>
            </div>
          </div>
        ) : (
          <p>No upcoming showtimes are currently listed.</p>
        )}
      </article>
    </section>
  );
}
