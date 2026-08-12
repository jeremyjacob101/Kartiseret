import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type Ref } from "react";
import { createPortal } from "react-dom";
import { Clock8, ExternalLink, MapPin, MoveRight, Star, X } from "lucide-react";
import { Link } from "react-router";
import { MoviePosterArtwork } from "../MoviePosterArtwork";
import { TheaterMapDialog } from "../maps/TheaterMapDialog";
import { fixedAppDateString, getMovieCatalogStatusSnapshot, getMovieShowtimeCities, getMovieShowtimeDays, getNextShowtimePrefetchDayCount, INITIAL_SHOWTIME_WINDOW_DAY_COUNT, loadAdditionalShowtimeDays, loadShowtimesAroundDate, SHOWTIME_PREFETCH_CHUNK_DAY_COUNT, SHOWTIME_WINDOW_DAY_COUNT, subscribeToMovieCatalog, type Movie, type MovieShowtimeDay } from "../../data/movieCatalog";
import { loadCities, type City } from "../../data/theaters";
import { type AppLocation } from "../../prefs/definitions/locations";
import { useUserPreferencesContext } from "../../prefs/useUserPreferences";
import { addCalendarDays, SHOWTIME_LINK_DATE_COUNT } from "../../routing/showtimeLinkCodec";
import { ShowtimeDayPicker } from "../showtimes/ShowtimeDayPicker";
import { ShowtimeFilterMenu } from "../showtimes/ShowtimeFilterMenu";
import { buildShowtimeFilterSelections, filterTheatersBySelections, getShowtimeFilterOptions, getShowtimeFiltersSnapshot, saveShowtimeFilters, subscribeToShowtimeFilters, updateShowtimeFilterState, type ShowtimeFilterOptions, type ShowtimeFilterSelections, type ShowtimeFilterState } from "../showtimes/showtimeFilters";
import { formatReleaseDate, getMetricDisplays, getMovieInfoParts, getShowtimeDateLabel, getTrailerEmbedUrl } from "../showtimes/showtimeUtils";
import { useI18n } from "../../i18n/I18nContext";
import { getLocalizedShowtimeHref, localizeCityName, localizeFilterOption, localizeTheaterName } from "../../i18n/content";
import type { AppLocale } from "../../i18n/locale";

type TheaterTheme = {
  accent: string;
  surface: string;
  glow: string;
  pillBackground?: string;
  pillClassName?: string;
};

const theaterThemes: Record<string, TheaterTheme> = {
  "Yes Planet": {
    accent: "#d9710f",
    surface: "rgba(255, 154, 61, 0.12)",
    glow: "rgba(217, 113, 15, 0.28)",
    pillClassName: "details-time-pill--yes-planet",
  },
  "Cinema City": {
    accent: "#186bdf",
    surface: "rgba(94, 168, 255, 0.12)",
    glow: "rgba(24, 107, 223, 0.3)",
    pillClassName: "details-time-pill--cinema-city",
  },
  "Lev Cinema": {
    accent: "#b50519",
    surface: "rgba(255, 107, 107, 0.12)",
    glow: "rgba(181, 5, 25, 0.28)",
    pillClassName: "details-time-pill--lev-cinema",
  },
  "Rav Hen": {
    accent: "#ab5306",
    surface: "rgba(255, 177, 74, 0.14)",
    glow: "rgba(13, 6, 218, 0.32)",
    pillBackground:
      "linear-gradient(135deg, rgba(79, 146, 255, 0.22), rgba(255, 177, 74, 0.18))",
    pillClassName: "details-time-pill--rav-hen",
  },
  "Hot Cinema": {
    accent: "#f06a87",
    surface: "rgba(255, 79, 160, 0.14)",
    glow: "rgba(240, 106, 135, 0.32)",
    pillClassName: "details-time-pill--hot-cinema",
  },
  MovieLand: {
    accent: "#a80371",
    surface: "rgba(88, 0, 58, 0.12)",
    glow: "rgba(168, 3, 113, 0.3)",
    pillClassName: "details-time-pill--movieland",
  },
};
const fallbackTheaterThemes: TheaterTheme[] = [
  {
    accent: "#d29bff",
    surface: "rgba(210, 155, 255, 0.12)",
    glow: "rgba(210, 155, 255, 0.28)",
  },
  {
    accent: "#ffd166",
    surface: "rgba(255, 209, 102, 0.12)",
    glow: "rgba(255, 209, 102, 0.28)",
  },
  {
    accent: "#7bdff2",
    surface: "rgba(123, 223, 242, 0.12)",
    glow: "rgba(123, 223, 242, 0.28)",
  },
];
const EMPTY_SHOWTIME_DAYS: readonly MovieShowtimeDay[] = Object.freeze([]);

type MovieDetailsContentProps = {
  movie: Movie;
  titleId: string;
  titleAs?: "h1" | "h2";
  posterRef?: Ref<HTMLImageElement>;
  posterClassName?: string;
  eyebrow?: string;
  variant?: MovieDetailsVariant;
  preferredShowtimeDate?: string | null;
  onPreferredShowtimeDateChange?: (date: string) => void;
  targetShowtimeQueries?: boolean;
  exactDateShowtimeQueries?: boolean;
  onExactShowtimeDatePreviewChange?: (date: string) => void;
  locationOverride?: AppLocation;
  onLocationOverrideChange?: (location: AppLocation) => Promise<boolean>;
  showtimeFilterStateOverride?: ShowtimeFilterState;
  onShowtimeFilterStateOverrideChange?: (state: ShowtimeFilterState) => void;
  showtimeDateLoading?: boolean;
  showtimeDateError?: string | null;
  showtimeDateWindowStart?: string | null;
  onShareShowtimes?: (selection: MovieDetailsShareSelection) => void;
  shareFeedback?: string | null;
};

export type MovieDetailsVariant = "nowPlaying" | "comingSoon";

export type MovieDetailsShareSelection = {
  date: string;
  location: AppLocation;
  filterState: ShowtimeFilterState | null;
};

type NearbyCityChoice = {
  name: string;
  targetDate: string;
};

function getTheaterTheme(theater: string, index: number): TheaterTheme {
  return (
    theaterThemes[theater] ??
    fallbackTheaterThemes[index % fallbackTheaterThemes.length]
  );
}

function getShowtimeTargetDate(
  showtimeDays: readonly MovieShowtimeDay[],
  preferredShowtimeDate: string | null | undefined,
): string | null {
  if (showtimeDays.length === 0) {
    return null;
  }

  if (
    preferredShowtimeDate &&
    showtimeDays.some((day) => day.date === preferredShowtimeDate)
  ) {
    return preferredShowtimeDate;
  }

  return showtimeDays[0]?.date ?? null;
}

function getFirstShowtimeDate(
  showtimeDays: readonly MovieShowtimeDay[],
): string | null {
  return showtimeDays.find((day) => day.theaters.length > 0)?.date ?? null;
}

function getOrderedNearbyCityNames(
  currentLocation: string,
  cityByName: ReadonlyMap<string, City>,
  availableCityNames: readonly string[],
): string[] {
  const availableCitySet = new Set(
    availableCityNames.filter((cityName) => cityName !== currentLocation),
  );
  const neighboringCityNames =
    cityByName
      .get(currentLocation)
      ?.neighboringCities.filter((cityName) =>
        availableCitySet.has(cityName)) ?? [];
  const fallbackCityNames = availableCityNames.filter(
    (cityName) => cityName !== currentLocation,
  );

  return neighboringCityNames.length > 0
    ? [...new Set(neighboringCityNames)]
    : [...new Set(fallbackCityNames)];
}

function cloneShowtimeDays(
  showtimeDays: readonly MovieShowtimeDay[],
): MovieShowtimeDay[] {
  return showtimeDays.map((day) => ({
    date: day.date,
    theaters: day.theaters.map((theater) => ({
      theater: theater.theater,
      showtimes: theater.showtimes.map((showtime) => ({
        time: showtime.time,
        href: showtime.href,
        localizedHrefs: showtime.localizedHrefs,
        screeningTech: showtime.screeningTech,
        screeningType: showtime.screeningType,
        dubLanguage: showtime.dubLanguage,
      })),
    })),
  }));
}

function getShowtimeTechLabel(screeningTech: string): string | null {
  const normalizedValue = screeningTech.trim().replace(/\s+/g, " ");

  if (!normalizedValue) {
    return null;
  }

  const strippedValue = normalizedValue.replace(/^2D\b[\s/-]*/i, "").trim();
  const comparableValue = strippedValue.toUpperCase();

  if (!strippedValue || comparableValue === "REGULAR") {
    return null;
  }

  return strippedValue;
}

function getDubFlagSrc(dubLanguage: string | null | undefined): string | null {
  switch (dubLanguage?.trim()) {
    case "Hebrew":
      return "/flags/israel.svg";
    case "French":
      return "/flags/france.svg";
    default:
      return null;
  }
}

function getDubBadgeLabel(
  dubLanguage: string | null | undefined,
  locale: AppLocale,
): string | null {
  const normalizedValue = dubLanguage?.trim().replace(/\s+/g, " ") ?? "";

  return normalizedValue ? localizeFilterOption(normalizedValue, locale) : null;
}

function getScreeningTypeBadgeLabel(
  screeningType: string,
  locale: AppLocale,
): string | null {
  const normalizedValue = screeningType.trim().replace(/\s+/g, " ");

  if (!normalizedValue || normalizedValue.toLowerCase() === "regular") {
    return null;
  }

  return localizeFilterOption(normalizedValue, locale);
}

export function MovieDetailsContent({
  movie,
  titleId,
  titleAs: TitleElement = "h2",
  posterRef,
  posterClassName = "details-poster",
  eyebrow,
  variant = "nowPlaying",
  preferredShowtimeDate = null,
  onPreferredShowtimeDateChange,
  targetShowtimeQueries = false,
  exactDateShowtimeQueries = false,
  onExactShowtimeDatePreviewChange,
  locationOverride,
  onLocationOverrideChange,
  showtimeFilterStateOverride,
  onShowtimeFilterStateOverrideChange,
  showtimeDateLoading = false,
  showtimeDateError = null,
  showtimeDateWindowStart = null,
  onShareShowtimes,
  shareFeedback = null,
}: MovieDetailsContentProps) {
  const { locale, direction, t } = useI18n();
  const {
    sources,
    location: preferenceLocation,
    setLocationPreference,
  } = useUserPreferencesContext();
  const location = locationOverride ?? preferenceLocation;
  const updateLocation = useCallback(
    async (nextLocation: AppLocation) => {
      if (locationOverride !== undefined) {
        return onLocationOverrideChange
          ? onLocationOverrideChange(nextLocation)
          : false;
      }

      return setLocationPreference(nextLocation);
    },
    [locationOverride, onLocationOverrideChange, setLocationPreference],
  );
  const showtimesReady = useSyncExternalStore(
    subscribeToMovieCatalog,
    () => getMovieCatalogStatusSnapshot().showtimesReady,
  );
  const showtimesVersion = useSyncExternalStore(
    subscribeToMovieCatalog,
    () => getMovieCatalogStatusSnapshot().showtimesVersion,
  );
  const [cities, setCities] = useState<readonly City[]>([]);
  const [openTrailerModalId, setOpenTrailerModalId] = useState<string | null>(
    null,
  );
  const [pendingNearbyCity, setPendingNearbyCity] = useState<string | null>(
    null,
  );
  const previousShowtimeLocationRef = useRef(location);
  const requestedShowtimePrefetchRef = useRef<string | null>(null);
  const resolvedEyebrow =
    eyebrow ??
    t(variant === "comingSoon" ? "catalog.comingSoon" : "catalog.nowPlaying");
  const localizedLocation = localizeCityName(location, locale);
  const infoParts = getMovieInfoParts(movie, locale);
  const metaParts =
    movie.genres.length > 0
      ? [...infoParts, movie.genres.join(", ")]
      : infoParts;
  const releaseDateLabel =
    variant === "comingSoon" && movie.releaseDate
      ? formatReleaseDate(movie.releaseDate, locale)
      : null;
  const hasComingSoonShowtimes = useMemo(() => {
    if (variant !== "comingSoon") {
      return false;
    }

    // Targeted showtime loads publish into the shared cache without changing
    // the broad showtimes-ready flag, so the version token is the rerender
    // signal for this Coming Soon-only lookup.
    void showtimesVersion;
    return getMovieShowtimeDays(movie.tmdbId, location).some(
      (day) => day.theaters.length > 0,
    );
  }, [location, movie.tmdbId, showtimesVersion, variant]);
  const shouldRenderShowtimes =
    variant === "nowPlaying" || hasComingSoonShowtimes;
  const showtimeDays = useMemo(() => {
    if (!shouldRenderShowtimes) {
      return EMPTY_SHOWTIME_DAYS;
    }

    // Incremental showtime loading updates the shared store in place, so this
    // version token is the signal that cached day data should be re-cloned.
    void showtimesVersion;
    const loadedShowtimeDays = cloneShowtimeDays(
      getMovieShowtimeDays(movie.tmdbId, location),
    );

    if (!exactDateShowtimeQueries || !showtimeDateWindowStart) {
      return loadedShowtimeDays;
    }

    const windowEnd = addCalendarDays(
      showtimeDateWindowStart,
      SHOWTIME_LINK_DATE_COUNT - 1,
    );

    if (!windowEnd) {
      return loadedShowtimeDays;
    }

    return loadedShowtimeDays.filter(
      (day) => day.date >= showtimeDateWindowStart && day.date <= windowEnd,
    );
  }, [
    exactDateShowtimeQueries,
    location,
    movie.tmdbId,
    showtimeDateWindowStart,
    showtimesVersion,
    shouldRenderShowtimes,
  ]);
  const metrics =
    variant === "nowPlaying" ? getMetricDisplays(movie, sources, locale) : [];
  const trailerEmbedUrl = getTrailerEmbedUrl(movie.trailerKey);
  const trailerModalId = `${variant}:${movie.tmdbId}`;
  const targetShowtimeDate = getShowtimeTargetDate(
    showtimeDays,
    preferredShowtimeDate,
  );
  const cityByName = useMemo(
    () => new Map(cities.map((city) => [city.name, city] as const)),
    [cities],
  );
  const hasLoadedShowtimeWindow =
    shouldRenderShowtimes &&
    (variant === "comingSoon" || exactDateShowtimeQueries || showtimesReady) &&
    showtimeDays.length > 0;
  const hasLoadedCompleteShowtimeWindow =
    hasLoadedShowtimeWindow && showtimeDays.length >= SHOWTIME_WINDOW_DAY_COUNT;
  const firstCityShowtimeDate = hasLoadedShowtimeWindow
    ? getFirstShowtimeDate(showtimeDays)
    : null;
  const hasAnyShowtimesInSelectedCity = firstCityShowtimeDate !== null;
  const hasTodayShowtimes =
    hasLoadedShowtimeWindow && showtimeDays[0]?.theaters.length > 0;
  const shouldShowCityUnavailableState =
    hasLoadedCompleteShowtimeWindow && !hasAnyShowtimesInSelectedCity;
  const shouldShowSkipToShowingDayButton =
    hasLoadedShowtimeWindow &&
    !hasTodayShowtimes &&
    firstCityShowtimeDate !== null &&
    firstCityShowtimeDate !== fixedAppDateString;
  const effectiveVisibleShowtimeDate = targetShowtimeDate;
  const selectedShowtimeDay =
    showtimeDays.find((day) => day.date === effectiveVisibleShowtimeDate) ??
    showtimeDays[0] ??
    null;
  const savedShowtimeFilterState = useSyncExternalStore(
    subscribeToShowtimeFilters,
    getShowtimeFiltersSnapshot,
    getShowtimeFiltersSnapshot,
  );
  const showtimeFilterState =
    showtimeFilterStateOverride ?? savedShowtimeFilterState;
  const allLoadedTheaters = useMemo(
    () => showtimeDays.flatMap((day) => day.theaters),
    [showtimeDays],
  );
  const showtimeFilterOptions = useMemo<ShowtimeFilterOptions>(
    () => getShowtimeFilterOptions(allLoadedTheaters),
    [allLoadedTheaters],
  );
  const showtimeFilterSelections = useMemo<ShowtimeFilterSelections>(
    () =>
      buildShowtimeFilterSelections(showtimeFilterOptions, showtimeFilterState),
    [showtimeFilterOptions, showtimeFilterState],
  );
  const filteredSelectedShowtimeDay = useMemo(
    () =>
      selectedShowtimeDay
        ? {
            ...selectedShowtimeDay,
            theaters: filterTheatersBySelections(
              selectedShowtimeDay.theaters,
              showtimeFilterSelections,
            ),
          }
        : null,
    [selectedShowtimeDay, showtimeFilterSelections],
  );
  const hasFilteredOutAllSelectedShowtimes =
    selectedShowtimeDay !== null &&
    selectedShowtimeDay.theaters.length > 0 &&
    filteredSelectedShowtimeDay !== null &&
    filteredSelectedShowtimeDay.theaters.length === 0;
  const handleShowtimeFilterToggle = useCallback(
    (group: keyof ShowtimeFilterOptions, value: string) => {
      const nextSelections: Record<keyof ShowtimeFilterOptions, Set<string>> = {
        showType: new Set(showtimeFilterSelections.showType),
        screenFormat: new Set(showtimeFilterSelections.screenFormat),
        screeningTech: new Set(showtimeFilterSelections.screeningTech),
        dubLanguage: new Set(showtimeFilterSelections.dubLanguage),
      };
      const groupSet = nextSelections[group];
      const checked = groupSet.has(value);

      if (checked) {
        groupSet.delete(value);
      } else {
        groupSet.add(value);
      }

      const nextState = updateShowtimeFilterState(
        showtimeFilterState,
        showtimeFilterOptions,
        nextSelections,
      );
      if (showtimeFilterStateOverride !== undefined) {
        onShowtimeFilterStateOverrideChange?.(nextState);
      } else {
        saveShowtimeFilters(nextState);
      }
    },
    [
      onShowtimeFilterStateOverrideChange,
      showtimeFilterStateOverride,
      showtimeFilterOptions,
      showtimeFilterSelections,
      showtimeFilterState,
    ],
  );
  const handleShowtimeFilterGroupToggle = useCallback(
    (group: keyof ShowtimeFilterOptions) => {
      const groupOptions = showtimeFilterOptions[group];
      const currentSelected = showtimeFilterSelections[group];
      const areAllSelected =
        groupOptions.length > 0 &&
        groupOptions.every((value) => currentSelected.has(value));
      const nextSelections: Record<keyof ShowtimeFilterOptions, Set<string>> = {
        showType: new Set(showtimeFilterSelections.showType),
        screenFormat: new Set(showtimeFilterSelections.screenFormat),
        screeningTech: new Set(showtimeFilterSelections.screeningTech),
        dubLanguage: new Set(showtimeFilterSelections.dubLanguage),
      };

      nextSelections[group] = areAllSelected
        ? new Set()
        : new Set(groupOptions);

      const nextState = updateShowtimeFilterState(
        showtimeFilterState,
        showtimeFilterOptions,
        nextSelections,
      );
      if (showtimeFilterStateOverride !== undefined) {
        onShowtimeFilterStateOverrideChange?.(nextState);
      } else {
        saveShowtimeFilters(nextState);
      }
    },
    [
      onShowtimeFilterStateOverrideChange,
      showtimeFilterStateOverride,
      showtimeFilterOptions,
      showtimeFilterSelections,
      showtimeFilterState,
    ],
  );
  const effectiveSelectedShowtimeDay =
    filteredSelectedShowtimeDay ?? selectedShowtimeDay;
  const shouldShowTodayReturnButton =
    shouldShowSkipToShowingDayButton &&
    effectiveVisibleShowtimeDate !== null &&
    effectiveVisibleShowtimeDate !== fixedAppDateString &&
    effectiveVisibleShowtimeDate >= firstCityShowtimeDate;
  const showtimeJumpTargetDate = shouldShowTodayReturnButton
    ? fixedAppDateString
    : firstCityShowtimeDate;
  const showtimeJumpButtonLabel = shouldShowTodayReturnButton
    ? t("showtimes.backToday")
    : t("showtimes.skipShowingDay");
  const shouldShowDayPicker =
    hasLoadedShowtimeWindow &&
    showtimeDays.length > 0 &&
    !shouldShowCityUnavailableState;
  const playingCities = useMemo(
    () =>
      hasLoadedShowtimeWindow ? [...getMovieShowtimeCities(movie.tmdbId)] : [],
    [hasLoadedShowtimeWindow, movie.tmdbId],
  );
  const nearbyCityChoices = useMemo<NearbyCityChoice[]>(() => {
    if (!hasLoadedShowtimeWindow || playingCities.length === 0) {
      return [];
    }

    return getOrderedNearbyCityNames(
      location,
      cityByName,
      playingCities,
    ).flatMap((cityName) => {
      const cityShowtimeDays = getMovieShowtimeDays(movie.tmdbId, cityName);
      const selectedDayShowtimeDate =
        effectiveVisibleShowtimeDate &&
        cityShowtimeDays.some(
          (day) =>
            day.date === effectiveVisibleShowtimeDate &&
            day.theaters.length > 0,
        )
          ? effectiveVisibleShowtimeDate
          : null;
      const firstShowtimeDate = getFirstShowtimeDate(cityShowtimeDays);
      const targetDate = selectedDayShowtimeDate ?? firstShowtimeDate;

      return targetDate ? [{ name: cityName, targetDate }] : [];
    });
  }, [
    cityByName,
    effectiveVisibleShowtimeDate,
    hasLoadedShowtimeWindow,
    location,
    movie.tmdbId,
    playingCities,
  ]);
  const isTrailerModalOpen =
    Boolean(trailerEmbedUrl) && openTrailerModalId === trailerModalId;
  const hasTrailerLaunch = variant === "nowPlaying" && Boolean(trailerEmbedUrl);
  const hasMetrics = metrics.length > 0;
  const renderMetricsRow = (className?: string) => {
    if (variant !== "nowPlaying" || (!hasTrailerLaunch && !hasMetrics)) {
      return null;
    }

    return (
      <div
        className={["details-metrics-row", className].filter(Boolean).join(" ")}
      >
        {hasTrailerLaunch ? (
          <button
            type="button"
            className="details-trailer-launch details-trailer-launch--metrics"
            aria-label={t("movie.watchTrailer", { title: movie.title })}
            onClick={() => {
              setOpenTrailerModalId(trailerModalId);
            }}
          >
            <img
              src="/logos/youtube.svg"
              alt=""
              className="details-trailer-launch-logo"
              width={28}
              height={20}
              decoding="async"
            />
          </button>
        ) : null}

        {hasTrailerLaunch && hasMetrics ? (
          <span className="details-metrics-divider" aria-hidden="true" />
        ) : null}

        {hasMetrics ? (
          <div className="details-metrics">
            {metrics.map((metric) => (
              <div
                key={metric.key}
                className="details-metric"
                aria-label={metric.ariaLabel}
              >
                <div className="details-metric-marker">
                  {metric.href ? (
                    <a
                      href={metric.href}
                      target="_blank"
                      rel="noreferrer"
                      className="details-metric-link"
                      aria-label={metric.linkAriaLabel}
                    >
                      <img
                        src={metric.logoSrc}
                        alt=""
                        className={metric.logoClassName}
                        decoding="async"
                      />
                    </a>
                  ) : (
                    <img
                      src={metric.logoSrc}
                      alt=""
                      className={metric.logoClassName}
                      decoding="async"
                    />
                  )}
                </div>
                <strong dir="ltr">{metric.value}</strong>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  const renderNoShowtimesState = (title: string) => (
    <div className="details-empty-state" aria-label={title}>
      <div className="details-empty-state-panel">
        <p className="details-empty-state-title">{title}</p>

        <div className="details-empty-actions">
          <Link to="/showtimes" className="details-empty-link">
            <span className="details-empty-link-copy">
              <Clock8
                size={16}
                strokeWidth={2.1}
                className="details-empty-link-icon"
                aria-hidden="true"
              />
              <span>
                {t("showtimes.seeAllIn", { city: localizedLocation })}
              </span>
            </span>
            <MoveRight
              size={16}
              strokeWidth={2.2}
              className="details-empty-link-arrow"
              aria-hidden="true"
            />
          </Link>

          <div
            className="details-empty-nearby"
            aria-busy={pendingNearbyCity ? "true" : undefined}
          >
            <p className="details-empty-link-heading">
              {t("showtimes.playingNear", { title: movie.title })}
            </p>

            {nearbyCityChoices.length > 0 ? (
              <div
                className="details-empty-city-list"
                aria-label={t("showtimes.citiesPlaying", {
                  title: movie.title,
                })}
              >
                {nearbyCityChoices.map((city) => (
                  <button
                    key={city.name}
                    type="button"
                    className="details-empty-city-button"
                    disabled={pendingNearbyCity !== null}
                    onClick={() => {
                      void handleNearbyCityClick(city.name, city.targetDate);
                    }}
                  >
                    <MapPin
                      size={14}
                      strokeWidth={2.2}
                      className="details-empty-city-icon"
                      aria-hidden="true"
                    />
                    <span>
                      {pendingNearbyCity === city.name
                        ? t("showtimes.switchingCity", {
                            city: localizeCityName(city.name, locale),
                          })
                        : localizeCityName(city.name, locale)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="details-empty-note">{t("showtimes.noneWindow")}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const scrollRailToDate = useCallback(
    (date: string) => {
      if (!showtimeDays.some((day) => day.date === date)) {
        return;
      }

      onPreferredShowtimeDateChange?.(date);
    },
    [onPreferredShowtimeDateChange, showtimeDays],
  );

  const handleShowtimePreviewDateChange = useCallback(
    (date: string) => {
      if (variant !== "nowPlaying") {
        return;
      }

      if (exactDateShowtimeQueries) {
        onExactShowtimeDatePreviewChange?.(date);
        return;
      }

      const previewDayIndex = showtimeDays.findIndex(
        (day) => day.date === date,
      );
      const nextDayCount = getNextShowtimePrefetchDayCount(
        showtimeDays.length,
        previewDayIndex,
      );

      if (nextDayCount === null) {
        return;
      }

      const requestKey = `${location}:${movie.tmdbId}:${nextDayCount}`;

      if (requestedShowtimePrefetchRef.current === requestKey) {
        return;
      }

      requestedShowtimePrefetchRef.current = requestKey;
      void loadAdditionalShowtimeDays(
        location,
        nextDayCount,
        targetShowtimeQueries ? movie.tmdbId : undefined,
      ).catch(() => {
        if (requestedShowtimePrefetchRef.current === requestKey) {
          requestedShowtimePrefetchRef.current = null;
        }
      });
    },
    [
      exactDateShowtimeQueries,
      location,
      movie.tmdbId,
      onExactShowtimeDatePreviewChange,
      showtimeDays,
      targetShowtimeQueries,
      variant,
    ],
  );

  const handleShowtimeJumpClick = useCallback(() => {
    if (!showtimeJumpTargetDate) {
      return;
    }

    scrollRailToDate(showtimeJumpTargetDate);
  }, [scrollRailToDate, showtimeJumpTargetDate]);

  const handleNearbyCityClick = useCallback(
    async (cityName: string, nextShowtimeDate: string) => {
      const previousDate =
        effectiveVisibleShowtimeDate ??
        targetShowtimeDate ??
        fixedAppDateString;

      setPendingNearbyCity(cityName);
      onPreferredShowtimeDateChange?.(nextShowtimeDate);

      let didSave: boolean;

      try {
        didSave = await updateLocation(cityName);
      } catch {
        didSave = false;
      } finally {
        setPendingNearbyCity((current) =>
          current === cityName ? null : current);
      }

      if (!didSave) {
        onPreferredShowtimeDateChange?.(previousDate);
      }
    },
    [
      effectiveVisibleShowtimeDate,
      onPreferredShowtimeDateChange,
      targetShowtimeDate,
      updateLocation,
    ],
  );

  useEffect(() => {
    if (variant !== "nowPlaying" || exactDateShowtimeQueries) {
      return;
    }

    if (previousShowtimeLocationRef.current === location) {
      return;
    }

    previousShowtimeLocationRef.current = location;
    void loadShowtimesAroundDate(
      location,
      preferredShowtimeDate ?? fixedAppDateString,
      targetShowtimeQueries ? movie.tmdbId : undefined,
    ).catch((error: unknown) => {
      console.error("Could not load showtimes for the selected city.", error);
    });
  }, [
    location,
    movie.tmdbId,
    preferredShowtimeDate,
    exactDateShowtimeQueries,
    targetShowtimeQueries,
    variant,
  ]);

  useEffect(() => {
    if (variant !== "nowPlaying") {
      return;
    }

    let isActive = true;

    void loadCities()
      .then((nextCities) => {
        if (isActive) {
          setCities(nextCities);
        }
      })
      .catch((error: unknown) => {
        console.error("Could not load city metadata for detail cards.", error);
      });

    return () => {
      isActive = false;
    };
  }, [variant]);

  useEffect(() => {
    if (
      variant !== "nowPlaying" ||
      exactDateShowtimeQueries ||
      !showtimesReady ||
      showtimeDays.length === 0 ||
      showtimeDays.length > INITIAL_SHOWTIME_WINDOW_DAY_COUNT
    ) {
      return;
    }

    let timeoutId: number | null = null;
    let idleId: number | null = null;
    const windowWithIdleCallbacks = window as Window & {
      cancelIdleCallback?: (handle: number) => void;
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number;
    };
    const nextDayCount = Math.min(
      SHOWTIME_PREFETCH_CHUNK_DAY_COUNT,
      SHOWTIME_WINDOW_DAY_COUNT,
    );
    const requestMoreDays = () => {
      void loadAdditionalShowtimeDays(
        location,
        nextDayCount,
        targetShowtimeQueries ? movie.tmdbId : undefined,
      ).catch(() => {});
    };

    if (typeof windowWithIdleCallbacks.requestIdleCallback === "function") {
      idleId = windowWithIdleCallbacks.requestIdleCallback(
        () => {
          requestMoreDays();
        },
        { timeout: 1800 },
      );
    } else {
      timeoutId = window.setTimeout(() => {
        requestMoreDays();
      }, 700);
    }

    return () => {
      if (
        idleId !== null &&
        typeof windowWithIdleCallbacks.cancelIdleCallback === "function"
      ) {
        windowWithIdleCallbacks.cancelIdleCallback(idleId);
      }

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    location,
    movie.tmdbId,
    exactDateShowtimeQueries,
    showtimeDays.length,
    showtimesReady,
    targetShowtimeQueries,
    variant,
  ]);

  useEffect(() => {
    if (!isTrailerModalOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenTrailerModalId(null);
      }
    };

    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isTrailerModalOpen]);

  const trailerModal =
    isTrailerModalOpen && trailerEmbedUrl && typeof document !== "undefined"
      ? createPortal(
          <div
            className="movie-trailer-modal"
            data-movie-scroller-detail-overlay="true"
            dir={direction}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setOpenTrailerModalId(null);
              }
            }}
          >
            <div
              className="movie-trailer-modal-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={t("movie.trailer", { title: movie.title })}
            >
              <button
                type="button"
                className="movie-trailer-modal-close"
                aria-label={t("movie.closeTrailer")}
                onClick={() => {
                  setOpenTrailerModalId(null);
                }}
              >
                <X size={20} strokeWidth={2.6} />
              </button>
              <div className="movie-trailer-modal-frame">
                <iframe
                  src={`${trailerEmbedUrl}&autoplay=1`}
                  title={t("movie.trailer", { title: movie.title })}
                  loading="eager"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div className="details-hero" dir={direction}>
        <div className="details-media-column">
          <div className="details-poster-shell">
            <MoviePosterArtwork
              ref={posterRef}
              title={movie.title}
              imageSrc={movie.imageSrc}
              alt={movie.title}
              className={posterClassName}
              draggable={false}
            />
          </div>
        </div>

        <div className="details-copy">
          <p className="details-eyebrow">{resolvedEyebrow}</p>
          <TitleElement id={titleId} className="details-title" dir="auto">
            {movie.title}
          </TitleElement>
          {metaParts.length > 0 ? (
            <div className="details-subtitle details-subtitle--meta-row">
              {metaParts.map((part) => (
                <span
                  key={`${movie.tmdbId}-meta-${part}`}
                  className="details-subtitle-item"
                  dir="auto"
                >
                  {part}
                </span>
              ))}
            </div>
          ) : null}

          {releaseDateLabel ? (
            <p className="details-release-date">
              {t("movie.releaseDate", { date: releaseDateLabel })}
            </p>
          ) : null}

          {renderMetricsRow("details-metrics-row--copy")}
        </div>

        {renderMetricsRow("details-metrics-row--mobile")}
      </div>

      {shouldRenderShowtimes ? (
        <div
          className="details-showtimes"
          data-movie-scroller-swipe-ignore="true"
          dir={direction}
        >
          {shouldShowDayPicker ? (
            <div className="details-day-picker-shell">
              <TheaterMapDialog
                className="details-day-picker-city city-map-trigger"
                triggerLabel={localizedLocation}
                locationOverride={locationOverride}
                onLocationOverrideChange={onLocationOverrideChange}
              />
              <ShowtimeDayPicker
                ariaLabel={t("showtimes.chooseMovieDay", {
                  title: movie.title,
                })}
                dates={showtimeDays.map((day) => day.date)}
                selectedDate={effectiveVisibleShowtimeDate}
                disabledBeforeDate={
                  showtimeDateWindowStart ?? fixedAppDateString
                }
                trailingPlaceholderCount={
                  exactDateShowtimeQueries
                    ? 0
                    : Math.min(
                        showtimeDays.length < SHOWTIME_PREFETCH_CHUNK_DAY_COUNT
                          ? SHOWTIME_PREFETCH_CHUNK_DAY_COUNT -
                              showtimeDays.length
                          : SHOWTIME_PREFETCH_CHUNK_DAY_COUNT,
                        SHOWTIME_WINDOW_DAY_COUNT - showtimeDays.length,
                      )
                }
                onPreviewDateChange={handleShowtimePreviewDateChange}
                onSelect={(date) => {
                  scrollRailToDate(date);
                }}
              />
              <div className="details-day-picker-actions">
                <ShowtimeFilterMenu
                  className="details-day-picker-filter"
                  options={showtimeFilterOptions}
                  selections={showtimeFilterSelections}
                  onToggleOption={handleShowtimeFilterToggle}
                  onToggleGroup={handleShowtimeFilterGroupToggle}
                />
                {onShareShowtimes ? (
                  <div className="details-share-shell">
                    <button
                      type="button"
                      className="details-share-trigger"
                      aria-label={t("showtimes.share")}
                      title={t("showtimes.share")}
                      onClick={() => {
                        if (effectiveVisibleShowtimeDate) {
                          onShareShowtimes({
                            date: effectiveVisibleShowtimeDate,
                            location,
                            filterState: showtimeFilterState,
                          });
                        }
                      }}
                    >
                      <ExternalLink
                        size={20}
                        strokeWidth={2.75}
                        className="app-accent-icon"
                        aria-hidden="true"
                      />
                    </button>
                    <span
                      className={`details-share-feedback${shareFeedback ? " is-visible" : ""}`}
                      role="status"
                      aria-live="polite"
                    >
                      {shareFeedback ?? ""}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {exactDateShowtimeQueries &&
          showtimeDateLoading &&
          !effectiveSelectedShowtimeDay ? (
            renderNoShowtimesState(t("showtimes.loading"))
          ) : shouldShowCityUnavailableState ? (
            renderNoShowtimesState(
              t("showtimes.movieNotPlaying", { city: localizedLocation }),
            )
          ) : (
            <div
              className="details-rail"
              aria-label={t("showtimes.ariaInCity", {
                title: movie.title,
                city: localizedLocation,
              })}
            >
              {effectiveSelectedShowtimeDay ? (
                <article
                  className="details-day-panel"
                  data-showtime-date={effectiveSelectedShowtimeDay.date}
                  key={effectiveSelectedShowtimeDay.date}
                >
                  <>
                    {shouldShowSkipToShowingDayButton ? (
                      <div className="details-day-header">
                        <button
                          type="button"
                          className="details-day-jump-button"
                          onClick={handleShowtimeJumpClick}
                        >
                          {showtimeJumpButtonLabel}
                        </button>
                      </div>
                    ) : null}

                    {showtimeDateLoading ? (
                      renderNoShowtimesState(t("showtimes.loading"))
                    ) : showtimeDateError ? (
                      renderNoShowtimesState(showtimeDateError)
                    ) : effectiveSelectedShowtimeDay.theaters.length === 0 ? (
                      renderNoShowtimesState(
                        hasFilteredOutAllSelectedShowtimes
                          ? t("showtimes.noneFiltered", {
                              date: getShowtimeDateLabel(
                                effectiveSelectedShowtimeDay.date,
                                locale,
                              ),
                              city: localizedLocation,
                            })
                          : t("showtimes.noneDay", {
                              date: getShowtimeDateLabel(
                                effectiveSelectedShowtimeDay.date,
                                locale,
                              ),
                              city: localizedLocation,
                            }),
                      )
                    ) : (
                      <div className="details-theaters">
                        {effectiveSelectedShowtimeDay.theaters.map((
                          theater,
                          theaterIndex,
                        ) => {
                          const colors = getTheaterTheme(
                            theater.theater,
                            theaterIndex,
                          );

                          return (
                            <section
                              className="details-theater"
                              key={theater.theater}
                            >
                              <div className="details-theater-name">
                                <span
                                  className="details-theater-dot"
                                  style={{
                                    backgroundColor: colors.accent,
                                    boxShadow: `0 0 18px ${colors.glow}`,
                                  }}
                                />
                                <span dir="auto">
                                  {localizeTheaterName(theater.theater, locale)}
                                </span>
                              </div>

                              <div className="details-time-grid">
                                {theater.showtimes.map((showtime) => {
                                  const showtimeTech = getShowtimeTechLabel(
                                    showtime.screeningTech,
                                  );
                                  const dubFlagSrc = getDubFlagSrc(
                                    showtime.dubLanguage,
                                  );
                                  const dubBadgeLabel = getDubBadgeLabel(
                                    showtime.dubLanguage,
                                    locale,
                                  );
                                  const screeningTypeBadgeLabel =
                                    getScreeningTypeBadgeLabel(
                                      showtime.screeningType,
                                      locale,
                                    );
                                  const localizedShowtimeHref =
                                    getLocalizedShowtimeHref(showtime, locale);
                                  const showtimeSlotClassName = [
                                    "details-showtime-slot",
                                    showtimeTech
                                      ? "details-showtime-slot--with-tech"
                                      : null,
                                    dubFlagSrc
                                      ? "details-showtime-slot--with-flag"
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" ");
                                  const showtimeCardClassName = [
                                    "details-showtime-card",
                                    localizedShowtimeHref
                                      ? "details-showtime-card--link"
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" ");
                                  const showtimePillClassName = [
                                    "details-time-pill",
                                    colors.pillClassName,
                                  ]
                                    .filter(Boolean)
                                    .join(" ");
                                  const showtimeCardStyle = colors.pillClassName
                                    ? undefined
                                    : {
                                        background:
                                          colors.pillBackground ??
                                          `linear-gradient(180deg, color-mix(in srgb, ${colors.accent} 88%, white 12%), color-mix(in srgb, ${colors.accent} 72%, black 28%))`,
                                      };
                                  const showtimeLabel = [
                                    t("showtimes.openTicket", {
                                      title: movie.title,
                                      time: showtime.time,
                                      theater: localizeTheaterName(
                                        theater.theater,
                                        locale,
                                      ),
                                    }),
                                    showtimeTech,
                                    screeningTypeBadgeLabel,
                                    dubBadgeLabel,
                                  ]
                                    .filter(Boolean)
                                    .join(", ");
                                  const key = [
                                    theater.theater,
                                    effectiveSelectedShowtimeDay.date,
                                    showtime.time,
                                    showtime.screeningTech,
                                    showtime.screeningType,
                                    showtime.dubLanguage ?? "original",
                                  ].join("-");
                                  const showtimeCard = localizedShowtimeHref ? (
                                    <a
                                      href={localizedShowtimeHref}
                                      target="_blank"
                                      rel="noreferrer"
                                      className={showtimeCardClassName}
                                      aria-label={showtimeLabel}
                                    >
                                      {showtimeTech ? (
                                        <span
                                          className="details-showtime-tech"
                                          aria-hidden="true"
                                          dir="ltr"
                                        >
                                          {showtimeTech}
                                        </span>
                                      ) : null}

                                      <div className="details-time-card-shell">
                                        <span
                                          className={showtimePillClassName}
                                          style={showtimeCardStyle}
                                        >
                                          {dubFlagSrc && dubBadgeLabel ? (
                                            <span className="details-time-pill-flag-shell">
                                              <img
                                                src={dubFlagSrc}
                                                alt=""
                                                className="details-time-pill-flag"
                                                width={17}
                                                height={13}
                                                decoding="async"
                                              />
                                              <span className="details-time-pill-flag-tooltip">
                                                {dubBadgeLabel}
                                              </span>
                                            </span>
                                          ) : null}
                                          {screeningTypeBadgeLabel ? (
                                            <span className="details-time-pill-type-shell">
                                              <Star
                                                size={10}
                                                strokeWidth={2.2}
                                                className="details-time-pill-type-icon"
                                                aria-hidden="true"
                                              />
                                              <span className="details-time-pill-type-tooltip">
                                                {screeningTypeBadgeLabel}
                                              </span>
                                            </span>
                                          ) : null}
                                          <span
                                            className="details-time-pill-label"
                                            dir="ltr"
                                          >
                                            {showtime.time}
                                          </span>
                                        </span>
                                      </div>
                                    </a>
                                  ) : (
                                    <span
                                      className={showtimeCardClassName}
                                      aria-label={showtimeLabel}
                                    >
                                      {showtimeTech ? (
                                        <span
                                          className="details-showtime-tech"
                                          aria-hidden="true"
                                          dir="ltr"
                                        >
                                          {showtimeTech}
                                        </span>
                                      ) : null}

                                      <div className="details-time-card-shell">
                                        <span
                                          className={showtimePillClassName}
                                          style={showtimeCardStyle}
                                        >
                                          {dubFlagSrc && dubBadgeLabel ? (
                                            <span className="details-time-pill-flag-shell">
                                              <img
                                                src={dubFlagSrc}
                                                alt=""
                                                className="details-time-pill-flag"
                                                width={17}
                                                height={13}
                                                decoding="async"
                                              />
                                              <span className="details-time-pill-flag-tooltip">
                                                {dubBadgeLabel}
                                              </span>
                                            </span>
                                          ) : null}
                                          {screeningTypeBadgeLabel ? (
                                            <span className="details-time-pill-type-shell">
                                              <Star
                                                size={10}
                                                strokeWidth={2.2}
                                                className="details-time-pill-type-icon"
                                                aria-hidden="true"
                                              />
                                              <span className="details-time-pill-type-tooltip">
                                                {screeningTypeBadgeLabel}
                                              </span>
                                            </span>
                                          ) : null}
                                          <span
                                            className="details-time-pill-label"
                                            dir="ltr"
                                          >
                                            {showtime.time}
                                          </span>
                                        </span>
                                      </div>
                                    </span>
                                  );

                                  return (
                                    <div
                                      key={key}
                                      className={showtimeSlotClassName}
                                    >
                                      {showtimeCard}
                                    </div>
                                  );
                                })}
                              </div>
                            </section>
                          );
                        })}
                      </div>
                    )}
                  </>
                </article>
              ) : null}
            </div>
          )}
        </div>
      ) : (
        <section
          className="details-showtimes details-showtimes--trailer"
          data-movie-scroller-swipe-ignore="true"
          aria-label={t("movie.trailer", { title: movie.title })}
          dir={direction}
        >
          {trailerEmbedUrl ? (
            <div className="details-trailer-shell">
              <div className="details-trailer-frame">
                <iframe
                  src={trailerEmbedUrl}
                  title={t("movie.officialTrailer", { title: movie.title })}
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
            </div>
          ) : (
            <p className="details-showtime-empty">
              {t("movie.trailerUnavailable")}
            </p>
          )}
        </section>
      )}
      {trailerModal}
    </>
  );
}
