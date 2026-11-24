import { directMoviePageKey, adminMovieEditMutationOptions, loadComingSoonMovies, loadNowPlayingMovies, loadShowtimes, movieCollectionQueryOptions, reloadComingSoonMovies, reloadNowPlayingMovies, showtimeCityQueryOptions, type Movie } from "./data/movieCatalog";
import { loadAllShowtimesPageModule, loadCinemaPageModule, loadCinemathequesPageModule, loadMoviePageModule, loadPosterGridPageModule, loadUserPreferencesPageModule } from "./routing/publicRouteModuleLoaders.js";
import { homepageAdminQueryOptions, homepageHighlightMutationOptions, removeHomepageHighlightMutationOptions, homepageFeaturedQueryOptions, type HomepageMovieHighlight } from "./data/homepageFeatured";
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEventHandler, type ReactNode } from "react";
import { filterMoviesByReleaseCategory, getMovieReleaseCategory, MOVIE_RELEASE_CATEGORY_LABELS, type MovieReleaseCategory } from "./domain/movieRelease";
import { INTRO_LEADING_CARD_COUNT, INTRO_TARGET_CARD_COUNT } from "./components/scroller/MovieScrollerBase";
import { getCinemathequeDateRange, nationwideCinemathequeQueryOptions } from "./data/cinemathequeCatalog";
import { getShowtimesCityFromPath, getShowtimesCityPath } from "@kartiseret/contracts/showtime-routes";
import { MovieScroller, type MovieScrollerJumpRequest } from "./components/scroller/MovieScroller";
import { DeleteAccountConfirmationPage } from "./components/DeleteAccountConfirmationPage";
import type { HomepageFeaturedResponse } from "@kartiseret/contracts/homepage-featured";
import { useMovieDisplayPreferences } from "./contexts/MovieDisplayPreferencesContext";
import { preloadCityLocationPicker } from "./components/maps/loadCityLocationPicker";
import { usePublicRouteComponents } from "./routing/PublicRouteComponentsContext.js";
import { getCurrentRobotsDirectives, setSeoMetadata } from "./routing/seoMetadata";
import { LetterboxdUnsubscribePage } from "./components/LetterboxdUnsubscribePage";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { HomepageFeaturedCarousel } from "./components/HomepageFeaturedCarousel";
import { ReleaseCategorySwitcher } from "./components/ReleaseCategorySwitcher";
import type { ApplicationIdentity } from "@kartiseret/contracts/private-data";
import { applyMovieDisplayPreferences } from "./data/movieDisplayPreferences";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { backdropPreloader } from "./components/scroller/backdropPreloader";
import { useUserPreferencesStore } from "./stores/userPreferencesStore";
import { usePublicationRevision } from "./hooks/usePublicationRevision";
import { type MovieSearchResult } from "./components/MovieSearchMenu";
import { PasswordResetPage } from "./components/PasswordResetPage";
import { siteInformationPages } from "./routing/siteInformation";
import { movieCodeSchema } from "@kartiseret/contracts/runtime";
import { adminStatusQueryOptions } from "./data/adminStatus";
import { BottomBar } from "./components/bars/BottomBar";
import { useDeviceStore } from "./device/useDeviceType";
import { PASSWORD_RESET_PATH } from "./lib/authRoutes";
import { useShallow } from "zustand/react/shallow";
import { Navbar } from "./components/bars/Navbar";
import "./index.css";

const SCROLLER_CARD_WIDTH = 220;
const SCROLLER_CARD_HEIGHT = 330;
const SCROLLER_GAP = 22;
const SCROLLER_MAX_WIDTH = 1100;
const SCROLLER_SLOT_MIN_HEIGHT = 420;
const MOBILE_SCROLLER_CARD_WIDTH = 160;
const MOBILE_SCROLLER_CARD_HEIGHT = 240;
const MOBILE_SCROLLER_GAP = 18;
const MOBILE_SCROLLER_SLOT_MIN_HEIGHT = 300;
const FIXED_APP_PATHS = new Set([
  "/",
  "/movies",
  "/showtimes",
  "/cinematheques",
  "/soons",
  "/user",
  ...siteInformationPages.map(({ path }) => path),
  PASSWORD_RESET_PATH,
  "/confirm-account-deletion",
  "/unsubscribe/letterboxd",
]);
const SiteInformation = lazy(
  () => import("./components/legal/SiteInformation"),
);

const CinemaPage = lazy(async () => {
  const module = await loadCinemaPageModule();
  return { default: module.CinemaPage };
});

const UserPreferencesPage = lazy(async () => {
  const module = await loadUserPreferencesPageModule();
  return { default: module.UserPreferencesPage };
});

const PosterGridPage = lazy(async () => {
  const module = await loadPosterGridPageModule();
  return { default: module.PosterGridPage };
});

const AllShowtimesPage = lazy(async () => {
  const module = await loadAllShowtimesPageModule();
  return { default: module.AllShowtimesPage };
});

const CinemathequesPage = lazy(async () => {
  const module = await loadCinemathequesPageModule();
  return { default: module.CinemathequesPage };
});

const MoviePage = lazy(async () => {
  const module = await loadMoviePageModule();
  return { default: module.MoviePage };
});

type MovieSearchMode = "nowPlaying" | "comingSoon";
type CatalogPageView = "grid" | "scroller";

type CatalogMovieJumpRequest = MovieScrollerJumpRequest & {
  mode: MovieSearchMode;
};

function subscribeToHydrationState() {
  return () => {};
}

function getClientHydrationState() {
  return true;
}

function getServerHydrationState() {
  return false;
}

function ClientMounted({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const isMounted = useSyncExternalStore(
    subscribeToHydrationState,
    getClientHydrationState,
    getServerHydrationState,
  );

  return isMounted ? children : fallback;
}

function isPotentialStandaloneMoviePath(pathname: string): boolean {
  if (FIXED_APP_PATHS.has(pathname)) {
    return false;
  }

  const segment = pathname.startsWith("/") ? pathname.slice(1) : pathname;

  return (
    !segment.includes("/") &&
    movieCodeSchema.safeParse(segment.slice(0, 3)).success
  );
}

type CatalogRouteProps = {
  catalogMovieJumpRequest: CatalogMovieJumpRequest | null;
  cardHeight: number;
  cardWidth: number;
  gap: number;
  jumpMode: MovieSearchMode;
  movies: readonly Movie[];
  onExitDetail: () => void;
  onPosterSelect: (tmdbId: string) => void;
  isAdmin: boolean;
  view: CatalogPageView;
  onAdminSaveEdit: (payload: {
    mode: MovieSearchMode;
    currentTmdbId: string;
    selectedTmdbId: string;
    selectedTitle?: string | null;
    selectedYear?: number | null;
    selectedPosterUrl?: string | null;
    isManualEntry: boolean;
  }) => Promise<void>;
  onRefreshRequested: (mode: MovieSearchMode) => Promise<void>;
  releaseCategory: MovieReleaseCategory;
  onReleaseCategoryChange: (category: MovieReleaseCategory) => void;
  showReleaseCategorySwitcher?: boolean;
  scrollerSlotMinHeight: number;
  homepageHighlights?: readonly HomepageMovieHighlight[];
  onAdminSaveHomepageHighlight?: (
    highlight: HomepageMovieHighlight,
  ) => Promise<void>;
  onAdminRemoveHomepageHighlight?: (tmdbId: string) => Promise<void>;
};

type HomeRouteProps = {
  catalogError: string | null;
  cardHeight: number;
  cardWidth: number;
  comingSoonReady: boolean;
  comingSoonMovies: readonly Movie[];
  gap: number;
  nowPlayingReady: boolean;
  nowPlayingMovies: readonly Movie[];
  nowPlayingReReleaseMovies: readonly Movie[];
  hideReReleases?: boolean;
  scrollerSlotMinHeight: number;
  isAdmin?: boolean;
  userId?: string | null;
  homepageFeaturedConfig?: HomepageFeaturedResponse["data"];
  homepageHighlights?: readonly HomepageMovieHighlight[];
  onAdminSaveHomepageHighlight?: (
    highlight: HomepageMovieHighlight,
  ) => Promise<void>;
  onAdminRemoveHomepageHighlight?: (tmdbId: string) => Promise<void>;
};

function CatalogErrorNote({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <p className="app-inline-note" role="status">
      {message}
    </p>
  );
}

function NotFoundRoute() {
  useEffect(() => {
    setSeoMetadata({
      title: "Page not found | Kartiseret",
      description: "This Kartiseret page is not available.",
      canonicalPath: window.location.pathname,
      robots: "noindex, nofollow",
    });
  }, []);

  return (
    <section className="page-panel">
      <h1>Page not found</h1>
      <p>This page is not available.</p>
      <a href="/">Return to Kartiseret</a>
    </section>
  );
}

export function CatalogRoute({
  catalogMovieJumpRequest,
  cardHeight,
  cardWidth,
  gap,
  jumpMode,
  movies,
  onExitDetail,
  onPosterSelect,
  isAdmin,
  view,
  onAdminSaveEdit,
  onRefreshRequested,
  releaseCategory,
  onReleaseCategoryChange,
  showReleaseCategorySwitcher = true,
  scrollerSlotMinHeight,
  homepageHighlights = [],
  onAdminSaveHomepageHighlight = async () => undefined,
  onAdminRemoveHomepageHighlight = async () => undefined,
}: CatalogRouteProps) {
  const routeLabel = jumpMode === "nowPlaying" ? "Now Playing" : "Coming Soon";
  const releaseLabel = MOVIE_RELEASE_CATEGORY_LABELS[releaseCategory];
  const catalogContent =
    movies.length === 0 ? (
      <p className="catalog-empty-state" role="status">
        No {releaseLabel.toLowerCase()} are currently available.
      </p>
    ) : view === "grid" ? (
      <Suspense fallback={null}>
        <PosterGridPage
          title={routeLabel + " " + releaseLabel}
          movies={movies}
          onPosterSelect={(movie) => {
            onPosterSelect(movie.tmdbId);
          }}
          isAdmin={isAdmin}
          onAdminSaveEdit={async (payload) => {
            await onAdminSaveEdit({ mode: jumpMode, ...payload });
          }}
          onRefreshRequested={async () => {
            await onRefreshRequested(jumpMode);
          }}
          homepageHighlights={homepageHighlights}
          onAdminSaveHomepageHighlight={onAdminSaveHomepageHighlight}
          onAdminRemoveHomepageHighlight={onAdminRemoveHomepageHighlight}
        />
      </Suspense>
    ) : (
      <div
        className="scroller-slot"
        style={{ minHeight: scrollerSlotMinHeight }}
      >
        <ClientMounted>
          <MovieScroller
            mode={jumpMode}
            movieItems={movies}
            jumpRequest={
              catalogMovieJumpRequest?.mode === jumpMode
                ? catalogMovieJumpRequest
                : null
            }
            jumpOpenMode="detail"
            onExitDetail={onExitDetail}
            cardWidth={cardWidth}
            cardHeight={cardHeight}
            gap={gap}
            maxWidth={SCROLLER_MAX_WIDTH}
          />
        </ClientMounted>
      </div>
    );

  return (
    <section className="catalog-browser-page" aria-label={routeLabel}>
      <div className="catalog-page-header">
        <div>
          <p className="section-kicker">{routeLabel}</p>
          <h1 className="section-title">{releaseLabel}</h1>
        </div>
        {showReleaseCategorySwitcher ? (
          <ReleaseCategorySwitcher
            category={releaseCategory}
            onChange={onReleaseCategoryChange}
            routeLabel={routeLabel}
          />
        ) : null}
      </div>
      {catalogContent}
    </section>
  );
}

function HomePosterRow({
  movies,
  prioritize = false,
}: {
  movies: readonly Movie[];
  prioritize?: boolean;
}) {
  return (
    <ul className="home-poster-row">
      {movies.map((movie, index) => {
        // The looping scroller opens with one card before the centered
        // first movie and four cards beginning at the center.
        const visible =
          prioritize &&
          (index < INTRO_TARGET_CARD_COUNT - INTRO_LEADING_CARD_COUNT ||
            index >= movies.length - INTRO_LEADING_CARD_COUNT);
        const card = (
          <>
            {movie.imageSrc ? (
              <img
                src={movie.imageSrc}
                srcSet={movie.imageSrcSet}
                sizes="(max-width: 699px) 160px, 220px"
                width={220}
                height={330}
                alt=""
                loading={visible ? "eager" : "lazy"}
                fetchPriority={prioritize && index === 0 ? "high" : undefined}
              />
            ) : (
              <span className="home-poster-placeholder" />
            )}
            <span className="home-poster-title">{movie.title}</span>
          </>
        );
        return (
          <li key={movie.tmdbId}>
            {movie.movieCode ? (
              <a href={`/${movie.movieCode}`}>{card}</a>
            ) : (
              card
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function HomeRoute({
  catalogError,
  cardHeight,
  cardWidth,
  comingSoonReady,
  comingSoonMovies,
  gap,
  nowPlayingReady,
  nowPlayingMovies,
  nowPlayingReReleaseMovies,
  hideReReleases = false,
  scrollerSlotMinHeight,
  isAdmin = false,
  userId = null,
  homepageFeaturedConfig,
  homepageHighlights = [],
  onAdminSaveHomepageHighlight = async () => undefined,
  onAdminRemoveHomepageHighlight = async () => undefined,
}: HomeRouteProps) {
  const skipLateIntro =
    typeof document !== "undefined" &&
    document.documentElement.dataset.homeIntro === "fallback";
  return (
    <section className="scroller-panel" aria-label="Movie releases">
      <CatalogErrorNote message={catalogError} />
      <HomepageFeaturedCarousel
        config={homepageFeaturedConfig}
        nowPlayingMovies={nowPlayingMovies}
        comingSoonMovies={comingSoonMovies}
        isAdmin={isAdmin}
        userId={userId}
        homepageHighlights={homepageHighlights}
        onAdminSaveHomepageHighlight={onAdminSaveHomepageHighlight}
        onAdminRemoveHomepageHighlight={onAdminRemoveHomepageHighlight}
      />
      <div className="section-heading">
        <p className="section-kicker">Now Playing</p>
        <h1 className="section-title">New Releases</h1>
      </div>
      <div
        className="scroller-slot"
        style={{ minHeight: scrollerSlotMinHeight }}
      >
        {nowPlayingReady && nowPlayingMovies.length > 0 ? (
          <ClientMounted
            fallback={<HomePosterRow movies={nowPlayingMovies} prioritize />}
          >
            <MovieScroller
              skipIntro={skipLateIntro}
              mode="nowPlaying"
              movieItems={nowPlayingMovies}
              showScrollArrows
              cardWidth={cardWidth}
              cardHeight={cardHeight}
              gap={gap}
              maxWidth={SCROLLER_MAX_WIDTH}
            />
          </ClientMounted>
        ) : nowPlayingReady ? (
          <p className="app-inline-note" role="status">
            No new releases are currently available.
          </p>
        ) : null}
      </div>
      <div className="section-heading">
        <p className="section-kicker">To Be Released</p>
        <h2 className="section-title">Coming Soon</h2>
      </div>
      <div
        className="scroller-slot"
        style={{ minHeight: scrollerSlotMinHeight }}
      >
        {comingSoonReady && comingSoonMovies.length > 0 ? (
          <ClientMounted fallback={<HomePosterRow movies={comingSoonMovies} />}>
            <MovieScroller
              skipIntro={skipLateIntro}
              mode="comingSoon"
              movieItems={comingSoonMovies}
              showScrollArrows
              cardWidth={cardWidth}
              cardHeight={cardHeight}
              gap={gap}
              maxWidth={SCROLLER_MAX_WIDTH}
            />
          </ClientMounted>
        ) : comingSoonReady ? (
          <p className="app-inline-note" role="status">
            No new releases are currently available.
          </p>
        ) : null}
      </div>
      {hideReReleases ? null : (
        <>
          <div className="section-heading">
            <p className="section-kicker">Now Playing</p>
            <h2 className="section-title">Re-Releases</h2>
          </div>
          <div
            className="scroller-slot"
            style={{ minHeight: scrollerSlotMinHeight }}
          >
            {nowPlayingReady && nowPlayingReReleaseMovies.length > 0 ? (
              <ClientMounted
                fallback={<HomePosterRow movies={nowPlayingReReleaseMovies} />}
              >
                <MovieScroller
                  skipIntro={skipLateIntro}
                  mode="nowPlaying"
                  movieItems={nowPlayingReReleaseMovies}
                  showScrollArrows
                  cardWidth={cardWidth}
                  cardHeight={cardHeight}
                  gap={gap}
                  maxWidth={SCROLLER_MAX_WIDTH}
                />
              </ClientMounted>
            ) : nowPlayingReady ? (
              <p className="app-inline-note" role="status">
                No re-releases are currently available.
              </p>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

function ShowtimesRoute({ catalogError }: { catalogError: string | null }) {
  const routeLocation = useLocation();
  const { allShowtimesPage: StaticAllShowtimesPage } =
    usePublicRouteComponents();
  if (
    routeLocation.pathname.startsWith("/showtimes/") &&
    !getShowtimesCityFromPath(routeLocation.pathname)
  ) {
    return <NotFoundRoute />;
  }

  return (
    <section className="page-panel">
      <CatalogErrorNote message={catalogError} />
      {StaticAllShowtimesPage ? (
        <StaticAllShowtimesPage />
      ) : (
        <Suspense fallback={null}>
          <AllShowtimesPage />
        </Suspense>
      )}
    </section>
  );
}

function UserRoute({
  user,
  loading,
}: {
  user: ApplicationIdentity | null;
  loading: boolean;
}) {
  if (!user && loading)
    return (
      <section className="page-panel">
        <p role="status">Loading your account…</p>
      </section>
    );
  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <section className="page-panel">
      <Suspense fallback={null}>
        <UserPreferencesPage />
      </Suspense>
    </section>
  );
}

export function App() {
  const location = useLocation();
  if (location.pathname === "/unsubscribe/letterboxd") {
    return <LetterboxdUnsubscribePage />;
  }
  return <MainApplication />;
}

function MainApplication() {
  const { cinemaPage: StaticCinemaPage } = usePublicRouteComponents();
  const publicationRevision = usePublicationRevision();
  const displayPreferences = useMovieDisplayPreferences();
  const routeLocation = useLocation();
  const navigate = useNavigate();
  const isMobile = useDeviceStore((state) => state.isMobile);
  const { user, loading, selectedCity, hideReReleases } =
    useUserPreferencesStore(
      useShallow((state) => ({
        user: state.user,
        loading: state.loading,
        selectedCity: state.preferences.location,
        hideReReleases: state.preferences.hideReReleases,
      })),
    );
  const pathname = routeLocation.pathname;
  const informationPage = siteInformationPages.find(
    ({ path }) => path === pathname,
  );
  const generalShowtimesRobots = useRef(
    pathname === "/showtimes" && typeof document !== "undefined"
      ? getCurrentRobotsDirectives()
      : "index, follow",
  );
  const routeShowtimesCity = getShowtimesCityFromPath(pathname);
  const isShowtimesPage =
    pathname === "/showtimes" || routeShowtimesCity !== null;
  const showtimesDataCity = routeShowtimesCity ?? selectedCity;
  const [cinemathequeSearchEnabled, setCinemathequeSearchEnabled] =
    useState(false);
  const { data: isAdmin = false } = useQuery({
    ...adminStatusQueryOptions(user?.id ?? null),
    enabled: Boolean(user),
  });
  const { data: homepageFeaturedResponse } = useQuery({
    ...homepageFeaturedQueryOptions(),
    enabled: pathname === "/",
  });
  const queryClient = useQueryClient();
  const adminHomepageQuery = useQuery({
    ...homepageAdminQueryOptions(isAdmin ? (user?.id ?? null) : null),
    enabled: isAdmin && ["/", "/movies", "/soons"].includes(pathname),
  });
  const saveHomepageHighlight = useMutation(
    homepageHighlightMutationOptions(user?.id ?? "", queryClient),
  );
  const removeHomepageHighlight = useMutation(
    removeHomepageHighlightMutationOptions(user?.id ?? "", queryClient),
  );
  const homepageHighlights = adminHomepageQuery.data?.data.highlights ?? [];
  const saveHomepageHighlightFromUi = useCallback(
    async (highlight: HomepageMovieHighlight) => {
      await saveHomepageHighlight.mutateAsync(highlight);
    },
    [saveHomepageHighlight],
  );
  const removeHomepageHighlightFromUi = useCallback(
    async (tmdbId: string) => {
      await removeHomepageHighlight.mutateAsync(tmdbId);
    },
    [removeHomepageHighlight],
  );
  const directMovieReady =
    isPotentialStandaloneMoviePath(pathname) &&
    queryClient.getQueryData(
      directMoviePageKey(pathname.slice(1, 4), publicationRevision),
    ) !== undefined;
  const shouldLoadCatalog =
    pathname !== "/user" &&
    !informationPage &&
    pathname !== PASSWORD_RESET_PATH &&
    (!directMovieReady || cinemathequeSearchEnabled);
  const nowPlayingQuery = useQuery({
    ...movieCollectionQueryOptions("nowPlaying"),
    enabled:
      shouldLoadCatalog && (pathname !== "/soons" || cinemathequeSearchEnabled),
  });
  const comingSoonQuery = useQuery({
    ...movieCollectionQueryOptions("comingSoon"),
    enabled:
      shouldLoadCatalog &&
      (pathname !== "/movies" || cinemathequeSearchEnabled),
  });
  const cinemathequeSearchQuery = useQuery({
    ...nationwideCinemathequeQueryOptions(
      getCinemathequeDateRange().endDate,
      publicationRevision,
    ),
    enabled: cinemathequeSearchEnabled,
  });
  const showtimeCityQuery = useQuery({
    ...showtimeCityQueryOptions(showtimesDataCity, publicationRevision),
    enabled: isShowtimesPage,
  });
  const { mutateAsync: saveAdminMovieEdit } = useMutation(
    adminMovieEditMutationOptions(),
  );
  const nowPlayingMovies = useMemo(
    () =>
      applyMovieDisplayPreferences(
        nowPlayingQuery.data?.movies ?? [],
        displayPreferences.preferencesById,
      ),
    [displayPreferences.preferencesById, nowPlayingQuery.data?.movies],
  );
  const comingSoonMovies = useMemo(
    () =>
      applyMovieDisplayPreferences(
        comingSoonQuery.data?.movies ?? [],
        displayPreferences.preferencesById,
      ),
    [comingSoonQuery.data?.movies, displayPreferences.preferencesById],
  );
  const nowPlayingNewReleaseMovies = useMemo(
    () => filterMoviesByReleaseCategory(nowPlayingMovies, "newReleases"),
    [nowPlayingMovies],
  );
  const nowPlayingReReleaseMovies = useMemo(
    () => filterMoviesByReleaseCategory(nowPlayingMovies, "reReleases"),
    [nowPlayingMovies],
  );
  const comingSoonNewReleaseMovies = useMemo(
    () => filterMoviesByReleaseCategory(comingSoonMovies, "newReleases"),
    [comingSoonMovies],
  );
  const comingSoonReReleaseMovies = useMemo(
    () => filterMoviesByReleaseCategory(comingSoonMovies, "reReleases"),
    [comingSoonMovies],
  );
  const nowPlayingReady = nowPlayingQuery.data !== undefined;
  const comingSoonReady = comingSoonQuery.data !== undefined;
  const catalogReady = nowPlayingReady && comingSoonReady;
  const movieCodesReady =
    catalogReady &&
    nowPlayingQuery.data?.movieCodesStatus === "ready" &&
    comingSoonQuery.data?.movieCodesStatus === "ready";
  const showtimesReady = showtimeCityQuery.data?.broadReady ?? false;
  const catalogQueryError =
    (nowPlayingQuery.data === undefined ? nowPlayingQuery.error : null) ??
    (comingSoonQuery.data === undefined ? comingSoonQuery.error : null) ??
    (isShowtimesPage && showtimeCityQuery.data === undefined
      ? showtimeCityQuery.error
      : null);
  const catalogError = catalogQueryError
    ? catalogQueryError instanceof Error
      ? catalogQueryError.message
      : "Failed to load movie data."
    : null;
  const [catalogMovieJumpRequest, setCatalogMovieJumpRequest] =
    useState<CatalogMovieJumpRequest | null>(null);
  const [moviesPageView, setMoviesPageView] = useState<CatalogPageView>("grid");
  const [soonsPageView, setSoonsPageView] = useState<CatalogPageView>("grid");
  const [moviesReleaseCategory, setMoviesReleaseCategory] =
    useState<MovieReleaseCategory>("newReleases");
  const [soonsReleaseCategory, setSoonsReleaseCategory] =
    useState<MovieReleaseCategory>("newReleases");
  const moviesDisplayReleaseCategory = hideReReleases
    ? "newReleases"
    : moviesReleaseCategory;
  const soonsDisplayReleaseCategory = hideReReleases
    ? "newReleases"
    : soonsReleaseCategory;
  const moviesPageMovies =
    moviesDisplayReleaseCategory === "reReleases"
      ? nowPlayingReReleaseMovies
      : nowPlayingNewReleaseMovies;
  const soonsPageMovies =
    soonsDisplayReleaseCategory === "reReleases"
      ? comingSoonReReleaseMovies
      : comingSoonNewReleaseMovies;
  const nonCriticalPreloadStartedRef = useRef(false);
  const scrollerCardWidth = isMobile
    ? MOBILE_SCROLLER_CARD_WIDTH
    : SCROLLER_CARD_WIDTH;
  const scrollerCardHeight = isMobile
    ? MOBILE_SCROLLER_CARD_HEIGHT
    : SCROLLER_CARD_HEIGHT;
  const scrollerGap = isMobile ? MOBILE_SCROLLER_GAP : SCROLLER_GAP;
  const scrollerSlotMinHeight = isMobile
    ? MOBILE_SCROLLER_SLOT_MIN_HEIGHT
    : SCROLLER_SLOT_MIN_HEIGHT;

  useLayoutEffect(() => {
    if (pathname === "/") {
      setSeoMetadata({
        title: "Kartiseret — Movie showtimes across Israel",
        description:
          "Find movie showtimes across Israeli cinemas in one place.",
        canonicalPath: "/",
        jsonLd: {
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "WebSite",
              name: "Kartiseret",
              url: "https://seret.site/",
            },
            {
              "@type": "Organization",
              name: "Kartiseret",
              url: "https://seret.site/",
              logo: "https://seret.site/logos/kartiseret1.svg",
            },
          ],
        },
      });
      return;
    }
    if (pathname === "/movies" || pathname === "/soons") {
      const isSoon = pathname === "/soons";
      const listingCodeStatus = isSoon
        ? comingSoonQuery.data?.movieCodesStatus
        : nowPlayingQuery.data?.movieCodesStatus;
      const catalogMovies = isSoon
        ? (comingSoonQuery.data?.movies ?? [])
        : (nowPlayingQuery.data?.movies ?? []);
      const hasPublicMovies = catalogMovies.some((movie) => movie.movieCode);
      setSeoMetadata({
        title: isSoon
          ? "Coming soon movies in Israel | Kartiseret"
          : "Movies showing in Israel | Kartiseret",
        description: isSoon
          ? "Browse upcoming movie releases on Kartiseret."
          : "Browse movies showing at cinemas across Israel.",
        canonicalPath: pathname,
        robots:
          listingCodeStatus === "ready"
            ? hasPublicMovies
              ? "index, follow"
              : "noindex, nofollow"
            : getCurrentRobotsDirectives(),
      });
      return;
    }
    if (isShowtimesPage) {
      const hasPublicShowtimes = Object.entries(
        showtimeCityQuery.data?.movieShowtimesByTmdbId ?? {},
      ).some(
        ([tmdbId, days]) =>
          (nowPlayingQuery.data?.movies ?? []).some(
            (movie) => movie.tmdbId === tmdbId && movie.movieCode,
          ) && days.some((day) => day.theaters.length > 0),
      );
      setSeoMetadata({
        title: routeShowtimesCity
          ? `Movie showtimes in ${routeShowtimesCity} — Now Playing | Kartiseret`
          : "Movie showtimes in Israel — Now Playing | Kartiseret",
        description: routeShowtimesCity
          ? `Browse movies currently showing in ${routeShowtimesCity}, with local cinema times and booking links.`
          : "Browse movies currently showing at cinemas across Israel, with showtimes and booking links.",
        canonicalPath: routeShowtimesCity
          ? getShowtimesCityPath(routeShowtimesCity)
          : "/showtimes",
        robots: routeShowtimesCity
          ? showtimesReady
            ? hasPublicShowtimes
              ? "index, follow"
              : "noindex, nofollow"
            : getCurrentRobotsDirectives()
          : generalShowtimesRobots.current,
      });
      return;
    }
    if (informationPage) {
      setSeoMetadata({
        title: `${"title" in informationPage ? informationPage.title : informationPage.label} | Kartiseret`,
        description: "Kartiseret support and site information.",
        canonicalPath: pathname,
        robots: "noindex, nofollow",
      });
      return;
    }
    if (pathname === "/user" || pathname === PASSWORD_RESET_PATH) {
      setSeoMetadata({
        title:
          pathname === "/user"
            ? "Account | Kartiseret"
            : "Reset password | Kartiseret",
        description: "Kartiseret account information.",
        canonicalPath: pathname,
        robots: "noindex, nofollow",
      });
    }
  }, [
    comingSoonQuery.data?.movies,
    comingSoonQuery.data?.movieCodesStatus,
    informationPage,
    nowPlayingQuery.data?.movies,
    nowPlayingQuery.data?.movieCodesStatus,
    pathname,
    selectedCity,
    isShowtimesPage,
    routeLocation.pathname,
    routeShowtimesCity,
    showtimeCityQuery.data,
    showtimesReady,
  ]);

  useEffect(() => {
    if (
      pathname !== "/" ||
      !nowPlayingReady ||
      !comingSoonReady ||
      nonCriticalPreloadStartedRef.current
    ) {
      return;
    }

    let cancelPosterWait: (() => void) | undefined;
    let timeoutId: number | null = null;
    let idleId: number | null = null;
    const windowWithIdleCallbacks = window as Window & {
      cancelIdleCallback?: (handle: number) => void;
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number;
    };
    const preloadNonCriticalExperience = () => {
      cancelPosterWait = backdropPreloader.afterCriticalPosters(() => {
        nonCriticalPreloadStartedRef.current = true;
        preloadCityLocationPicker();
        void Promise.allSettled([
          loadUserPreferencesPageModule(),
          loadPosterGridPageModule(),
        ]);
      });
    };

    if (typeof windowWithIdleCallbacks.requestIdleCallback === "function") {
      idleId = windowWithIdleCallbacks.requestIdleCallback(
        () => {
          preloadNonCriticalExperience();
        },
        { timeout: 900 },
      );
    } else {
      timeoutId = window.setTimeout(() => {
        preloadNonCriticalExperience();
      }, 180);
    }

    return () => {
      cancelPosterWait?.();
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
  }, [comingSoonReady, nowPlayingReady, pathname]);

  useEffect(() => {
    if (
      isShowtimesPage ||
      pathname === "/cinematheques" ||
      pathname === "/user" ||
      informationPage ||
      pathname === PASSWORD_RESET_PATH ||
      isPotentialStandaloneMoviePath(pathname) ||
      !nowPlayingReady ||
      !comingSoonReady ||
      showtimesReady
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
    const requestShowtimes = () => {
      void loadShowtimes(showtimesDataCity).catch(() => {});
    };

    if (typeof windowWithIdleCallbacks.requestIdleCallback === "function") {
      idleId = windowWithIdleCallbacks.requestIdleCallback(
        () => {
          requestShowtimes();
        },
        { timeout: 1500 },
      );
    } else {
      timeoutId = window.setTimeout(() => {
        requestShowtimes();
      }, 500);
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
    informationPage,
    comingSoonReady,
    nowPlayingReady,
    pathname,
    selectedCity,
    showtimesDataCity,
    isShowtimesPage,
    showtimesReady,
  ]);

  useEffect(() => {
    if (!showtimesReady || pathname !== "/") {
      return;
    }

    let cancelPosterWait: (() => void) | undefined;
    let timeoutId: number | null = null;
    let idleId: number | null = null;
    const windowWithIdleCallbacks = window as Window & {
      cancelIdleCallback?: (handle: number) => void;
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number;
    };
    const runPreload = () => {
      cancelPosterWait = backdropPreloader.afterCriticalPosters(() => {
        void loadAllShowtimesPageModule();
      });
    };

    if (typeof windowWithIdleCallbacks.requestIdleCallback === "function") {
      idleId = windowWithIdleCallbacks.requestIdleCallback(
        () => {
          runPreload();
        },
        { timeout: 1200 },
      );
    } else {
      timeoutId = window.setTimeout(() => {
        runPreload();
      }, 300);
    }

    return () => {
      cancelPosterWait?.();
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
  }, [pathname, showtimesReady]);

  const handleCatalogLoadRequest = useCallback(() => {
    void Promise.all([loadNowPlayingMovies(), loadComingSoonMovies()]).catch((
      error: unknown,
    ) => {
      console.error("Failed to load movie catalog.", error);
    });
  }, []);

  const handleSearchOpen = useCallback(() => {
    handleCatalogLoadRequest();
    setCinemathequeSearchEnabled(true);
  }, [handleCatalogLoadRequest]);

  const handleAdminSaveEdit = useCallback(
    async (payload: {
      mode: MovieSearchMode;
      currentTmdbId: string;
      selectedTmdbId: string;
      selectedTitle?: string | null;
      selectedYear?: number | null;
      selectedPosterUrl?: string | null;
      isManualEntry: boolean;
    }) => {
      await saveAdminMovieEdit(payload);
    },
    [saveAdminMovieEdit],
  );

  const handleAdminRefreshRequested = useCallback(async (
    mode: MovieSearchMode,
  ) => {
    if (mode === "nowPlaying") {
      await reloadNowPlayingMovies();
      return;
    }

    await reloadComingSoonMovies();
  }, []);

  const handleReleaseCategoryChange = useCallback((
    mode: MovieSearchMode,
    category: MovieReleaseCategory,
  ) => {
    setCatalogMovieJumpRequest(null);

    if (mode === "nowPlaying") {
      setMoviesReleaseCategory(category);
      setMoviesPageView("grid");
      return;
    }

    setSoonsReleaseCategory(category);
    setSoonsPageView("grid");
  }, []);

    navigate("/user");
  }, [loading, navigate, user]);

  const resetCatalogPage = useCallback((mode: MovieSearchMode) => {
    if (mode === "nowPlaying") {
      setMoviesPageView("grid");
      setMoviesReleaseCategory("newReleases");
    } else {
      setSoonsPageView("grid");
      setSoonsReleaseCategory("newReleases");
    }

    setCatalogMovieJumpRequest(null);
  }, []);

  const openCatalogMovie = useCallback(
    (mode: MovieSearchMode, tmdbId: string) => {
      handleCatalogLoadRequest();

      setCatalogMovieJumpRequest({
        tmdbId,
        mode,
        nonce: Date.now(),
        behavior: "smooth",
      });

      if (mode === "nowPlaying") {
        setMoviesPageView("scroller");
      } else {
        setSoonsPageView("scroller");
      }
    },
    [handleCatalogLoadRequest],
  );

  const handleMovieSearchSelect = useCallback(
    (result: MovieSearchResult) => {
      if (result.mode === "cinematheque") {
        navigate("/cinematheques");
        return;
      }
      if (result.movieCode) {
        navigate(`/${result.movieCode}`);
        return;
      }

      handleReleaseCategoryChange(
        result.mode,
        getMovieReleaseCategory({ year: result.year }),
      );
      openCatalogMovie(result.mode, result.tmdbId);

      const targetPath = result.mode === "nowPlaying" ? "/movies" : "/soons";

      if (pathname !== targetPath) {
        navigate(targetPath);
      }
    },
    [handleReleaseCategoryChange, navigate, openCatalogMovie, pathname],
  );

  const handleMoviesNavClick = useCallback<
    MouseEventHandler<HTMLAnchorElement>
  >(
    (event) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0
      ) {
        return;
      }
      resetCatalogPage("nowPlaying");
    },
    [resetCatalogPage],
  );

  const handleSoonsNavClick = useCallback<MouseEventHandler<HTMLAnchorElement>>(
    (event) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0
      ) {
        return;
      }
      resetCatalogPage("comingSoon");
    },
    [resetCatalogPage],
  );

  const handleHomeClick = useCallback(() => {
    if (pathname !== "/") {
      navigate("/");
    }

    window.requestAnimationFrame(() => {
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)")
        .matches
        ? "auto"
        : "smooth";

      window.scrollTo({ top: 0, behavior });
    });
  }, [navigate, pathname]);

  const searchCollections = [
    {
      mode: "nowPlaying" as const,
      label: "Now Playing",
      movies: catalogReady ? nowPlayingMovies : [],
    },
    {
      mode: "comingSoon" as const,
      label: "Coming Soon",
      movies: catalogReady ? comingSoonMovies : [],
    },
    {
      mode: "cinematheque" as const,
      label: "Cinematheque",
      movies: cinemathequeSearchQuery.data?.movies ?? [],
    },
  ];

  return (
    <div className="app-shell">
      <Navbar
        catalogReady={catalogReady}
        searchLoading={
          cinemathequeSearchEnabled && cinemathequeSearchQuery.isFetching
        }
        cinemathequeUnavailable={
          cinemathequeSearchEnabled && cinemathequeSearchQuery.isError
        }
        searchCollections={searchCollections}
        onHomeClick={handleHomeClick}
        onMoviesNavClick={handleMoviesNavClick}
        onSearchOpen={handleSearchOpen}
        onSelectResult={handleMovieSearchSelect}
        onSoonsNavClick={handleSoonsNavClick}
      />

      <main
        className={["app-main", isShowtimesPage ? "app-main--showtimes" : null]
          .filter(Boolean)
          .join(" ")}
      >
        <Routes>
          <Route
            path="/"
            element={
              <HomeRoute
                catalogError={catalogError}
                cardHeight={scrollerCardHeight}
                cardWidth={scrollerCardWidth}
                comingSoonReady={comingSoonReady}
                comingSoonMovies={comingSoonNewReleaseMovies}
                gap={scrollerGap}
                nowPlayingReady={nowPlayingReady}
                nowPlayingMovies={nowPlayingNewReleaseMovies}
                nowPlayingReReleaseMovies={nowPlayingReReleaseMovies}
                hideReReleases={hideReReleases}
                scrollerSlotMinHeight={scrollerSlotMinHeight}
                isAdmin={isAdmin}
                userId={user?.id ?? null}
                homepageFeaturedConfig={homepageFeaturedResponse?.data}
                homepageHighlights={homepageHighlights}
                onAdminSaveHomepageHighlight={saveHomepageHighlightFromUi}
                onAdminRemoveHomepageHighlight={removeHomepageHighlightFromUi}
              />
            }
          />
          <Route
            path="/movies"
            element={
              <section className="page-panel">
                <CatalogErrorNote message={catalogError} />
                {nowPlayingReady &&
                nowPlayingQuery.data?.movieCodesStatus === "ready" ? (
                  <CatalogRoute
                    catalogMovieJumpRequest={catalogMovieJumpRequest}
                    cardHeight={scrollerCardHeight}
                    cardWidth={scrollerCardWidth}
                    gap={scrollerGap}
                    jumpMode="nowPlaying"
                    movies={moviesPageMovies}
                    onExitDetail={() => {
                      resetCatalogPage("nowPlaying");
                    }}
                    onPosterSelect={(tmdbId) => {
                      openCatalogMovie("nowPlaying", tmdbId);
                    }}
                    isAdmin={isAdmin}
                    view={moviesPageView}
                    onAdminSaveEdit={handleAdminSaveEdit}
                    onRefreshRequested={handleAdminRefreshRequested}
                    releaseCategory={moviesDisplayReleaseCategory}
                    onReleaseCategoryChange={(category) => {
                      handleReleaseCategoryChange("nowPlaying", category);
                    }}
                    showReleaseCategorySwitcher={!hideReReleases}
                    scrollerSlotMinHeight={scrollerSlotMinHeight}
                    homepageHighlights={homepageHighlights}
                    onAdminSaveHomepageHighlight={saveHomepageHighlightFromUi}
                    onAdminRemoveHomepageHighlight={
                      removeHomepageHighlightFromUi
                    }
                  />
                ) : nowPlayingReady ? (
                  <p className="app-inline-note" role="status">
                    Movie links are temporarily unavailable.
                  </p>
                ) : null}
              </section>
            }
          />
          <Route
            path="/showtimes"
            element={<ShowtimesRoute catalogError={catalogError} />}
          />
          <Route
            path="/showtimes/:citySlug"
            element={<ShowtimesRoute catalogError={catalogError} />}
          />
          <Route
            path="/cinematheques"
            element={
              <section className="page-panel">
                <CatalogErrorNote message={catalogError} />
                <Suspense fallback={null}>
                  <CinemathequesPage />
                </Suspense>
              </section>
            }
          />
          <Route
            path="/soons"
            element={
              <section className="page-panel">
                <CatalogErrorNote message={catalogError} />
                {comingSoonReady &&
                comingSoonQuery.data?.movieCodesStatus === "ready" ? (
                  <CatalogRoute
                    catalogMovieJumpRequest={catalogMovieJumpRequest}
                    cardHeight={scrollerCardHeight}
                    cardWidth={scrollerCardWidth}
                    gap={scrollerGap}
                    jumpMode="comingSoon"
                    movies={soonsPageMovies}
                    onExitDetail={() => {
                      resetCatalogPage("comingSoon");
                    }}
                    onPosterSelect={(tmdbId) => {
                      openCatalogMovie("comingSoon", tmdbId);
                    }}
                    isAdmin={isAdmin}
                    view={soonsPageView}
                    onAdminSaveEdit={handleAdminSaveEdit}
                    onRefreshRequested={handleAdminRefreshRequested}
                    releaseCategory={soonsDisplayReleaseCategory}
                    onReleaseCategoryChange={(category) => {
                      handleReleaseCategoryChange("comingSoon", category);
                    }}
                    showReleaseCategorySwitcher={!hideReReleases}
                    scrollerSlotMinHeight={scrollerSlotMinHeight}
                    homepageHighlights={homepageHighlights}
                    onAdminSaveHomepageHighlight={saveHomepageHighlightFromUi}
                    onAdminRemoveHomepageHighlight={
                      removeHomepageHighlightFromUi
                    }
                  />
                ) : comingSoonReady ? (
                  <p className="app-inline-note" role="status">
                    Movie links are temporarily unavailable.
                  </p>
                ) : null}
              </section>
            }
          />
          <Route
            path="/user"
            element={<UserRoute user={user} loading={loading} />}
          />
          <Route
            path={PASSWORD_RESET_PATH}
            element={
              <section className="page-panel">
                <PasswordResetPage />
              </section>
            }
          />
          <Route
            path="/confirm-account-deletion"
            element={
              <section className="page-panel">
                <DeleteAccountConfirmationPage />
              </section>
            }
          />
          {siteInformationPages.map((page) => (
            <Route
              key={page.path}
              path={page.path}
              element={
                <Suspense fallback={null}>
                  <SiteInformation page={page} />
                </Suspense>
              }
            />
          ))}
          <Route
            path="/c/:cinemaId"
            element={
              StaticCinemaPage ? (
                <StaticCinemaPage />
              ) : (
                <Suspense
                  fallback={<section className="page-panel" aria-busy="true" />}
                >
                  <CinemaPage />
                </Suspense>
              )
            }
          />
          <Route
            path="/:movieCode"
            element={
              <Suspense fallback={null}>
                <MoviePage
                  catalogError={catalogError}
                  catalogReady={directMovieReady || catalogReady}
                  movieCodesReady={directMovieReady || movieCodesReady}
                />
              </Suspense>
            }
          />
          <Route path="*" element={<NotFoundRoute />} />
        </Routes>
      </main>

      <BottomBar />
    </div>
  );
}
