import { homepageAdminQueryOptions, homepagePromotionMutationOptions, type HomepageMovieHighlight, type HomepagePromotion, type HomepagePromotionUpsert } from "../data/homepageFeatured";
import { homepageFeatureRating, MAX_HOMEPAGE_FEATURE_RATING } from "@kartiseret/contracts/homepage-featured";
import { buildHomepageFeaturedSlides, type HomepageFeaturedSlide } from "../data/homepageFeaturedSlides";
import type { HomepageFeaturedResponse } from "@kartiseret/contracts/homepage-featured";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { ArrowRight, Plus, X } from "lucide-react";
import type { Movie } from "../data/movieCatalog";
import "./HomepageFeaturedCarousel.css";

type FeaturedPayload = HomepageFeaturedResponse["data"];
const ROTATION_MS = 5_000;
const SLIDE_TRANSITION_MS = 350;

function slideId(slide: HomepageFeaturedSlide): string {
  return slide.type === "movie"
    ? `movie-${slide.movie.tmdbId}`
    : `promotion-${slide.promotion.id}`;
}

type Navigation = {
  activeId: string | null;
  outgoingId: string | null;
  direction: 1 | -1;
};

type SlideTarget = { step: 1 | -1 } | { index: number };

function israelToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(value: string, amount: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

type PromotionDraft = Omit<HomepagePromotionUpsert, "id"> & { id?: string };

function newPromotionDraft(): PromotionDraft {
  const startsOn = israelToday();
  return {
    title: "",
    body: "",
    startsOn,
    endsOn: addDays(startsOn, 14),
    priority: 0,
    ctaLabel: null,
    ctaHref: null,
    enabled: true,
  };
}

function PromotionManager({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const adminQuery = useQuery({ ...homepageAdminQueryOptions(userId) });
  const save = useMutation(
    homepagePromotionMutationOptions(userId, queryClient),
  );
  const [draft, setDraft] = useState<PromotionDraft>(newPromotionDraft);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const promotions = adminQuery.data?.data.promotions ?? [];

  const update = <Key extends keyof PromotionDraft>(
    key: Key,
    value: PromotionDraft[Key],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await save.mutateAsync({
        ...draft,
        ctaLabel: draft.ctaLabel?.trim() || null,
        ctaHref: draft.ctaHref?.trim() || null,
      });
      setDraft(newPromotionDraft());
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save promotion.",
      );
    } finally {
      setSaving(false);
    }
  };

  const edit = (promotion: HomepagePromotion) => {
    setDraft({ ...promotion });
    setError(null);
  };

  const toggle = async (promotion: HomepagePromotion) => {
    setError(null);
    try {
      await save.mutateAsync({ ...promotion, enabled: !promotion.enabled });
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not update promotion.",
      );
    }
  };

  return (
    <div
      className="homepage-admin-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        className="homepage-admin-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="homepage-promo-title"
      >
        <div className="homepage-admin-heading">
          <div>
            <p className="homepage-admin-overline">Homepage carousel</p>
            <h2 id="homepage-promo-title">Manage promotions</h2>
          </div>
          <button
            className="homepage-admin-icon-button"
            type="button"
            aria-label="Close promotion manager"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        {adminQuery.isPending ? <p>Loading promotions…</p> : null}
        {adminQuery.isError ? (
          <p role="alert">Could not load promotions.</p>
        ) : null}
        <div className="homepage-promo-list">
          {promotions.map((promotion) => (
            <article className="homepage-promo-row" key={promotion.id}>
              <div>
                <strong>{promotion.title}</strong>
                <span>
                  {promotion.startsOn} — {promotion.endsOn}
                </span>
              </div>
              <div className="homepage-promo-row-actions">
                <button type="button" onClick={() => edit(promotion)}>
                  Edit
                </button>
                <button type="button" onClick={() => void toggle(promotion)}>
                  {promotion.enabled ? "Disable" : "Enable"}
                </button>
              </div>
            </article>
          ))}
          {promotions.length === 0 && !adminQuery.isPending ? (
            <p>No promotions yet.</p>
          ) : null}
        </div>
        <form className="homepage-promo-form" onSubmit={submit}>
          <h3>{draft.id ? "Edit promotion" : "New promotion"}</h3>
          <label>
            Headline
            <input
              required
              maxLength={120}
              value={draft.title}
              onChange={(event) => update("title", event.target.value)}
            />
          </label>
          <label>
            Short copy
            <textarea
              required
              maxLength={280}
              rows={2}
              value={draft.body}
              onChange={(event) => update("body", event.target.value)}
            />
          </label>
          <div className="homepage-promo-date-row">
            <label>
              Starts
              <input
                required
                type="date"
                value={draft.startsOn}
                onChange={(event) => update("startsOn", event.target.value)}
              />
            </label>
            <label>
              Ends
              <input
                required
                type="date"
                value={draft.endsOn}
                onChange={(event) => update("endsOn", event.target.value)}
              />
            </label>
          </div>
          <div className="homepage-promo-date-row">
            <label>
              CTA label
              <input
                maxLength={60}
                value={draft.ctaLabel ?? ""}
                onChange={(event) =>
                  update("ctaLabel", event.target.value || null)
                }
                placeholder="Get tickets"
              />
            </label>
            <label>
              CTA destination
              <input
                maxLength={2048}
                value={draft.ctaHref ?? ""}
                onChange={(event) =>
                  update("ctaHref", event.target.value || null)
                }
                placeholder="/movies or https://…"
              />
            </label>
          </div>
          <label>
            Priority
            <input
              type="number"
              min={-100}
              max={100}
              value={draft.priority}
              onChange={(event) =>
                update("priority", Number(event.target.value))
              }
            />
          </label>
          {error ? (
            <p className="homepage-admin-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="homepage-admin-actions">
            <button
              className="homepage-admin-secondary"
              type="button"
              onClick={() => {
                setDraft(newPromotionDraft());
                setError(null);
              }}
            >
              New promotion
            </button>
            <button
              className="homepage-admin-primary"
              type="submit"
              disabled={saving}
            >
              {saving ? "Saving…" : "Save promotion"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function HomepageFeaturedCarousel({
  config,
  nowPlayingMovies,
  comingSoonMovies,
  isAdmin,
  userId,
  homepageHighlights,
  onAdminSaveHomepageHighlight,
  onAdminRemoveHomepageHighlight,
}: {
  config: FeaturedPayload | undefined;
  nowPlayingMovies: readonly Movie[];
  comingSoonMovies: readonly Movie[];
  isAdmin: boolean;
  userId: string | null;
  homepageHighlights: readonly HomepageMovieHighlight[];
  onAdminSaveHomepageHighlight: (
    highlight: HomepageMovieHighlight,
  ) => Promise<void>;
  onAdminRemoveHomepageHighlight: (tmdbId: string) => Promise<void>;
}) {
  const slides = useMemo(
    () =>
      buildHomepageFeaturedSlides(config, nowPlayingMovies, comingSoonMovies),
    [config, nowPlayingMovies, comingSoonMovies],
  );
  const [navigation, setNavigation] = useState<Navigation>({
    activeId: null,
    outgoingId: null,
    direction: 1,
  });
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [showPromotionManager, setShowPromotionManager] = useState(false);
  const [featureDialog, setFeatureDialog] = useState<Movie | null>(null);
  const [featureStartsOn, setFeatureStartsOn] = useState(israelToday);
  const [featureEndsOn, setFeatureEndsOn] = useState(() =>
    addDays(israelToday(), 30));
  const [featureLabel, setFeatureLabel] =
    useState<HomepageMovieHighlight["label"]>(null);
  const [featurePriority, setFeaturePriority] = useState(homepageFeatureRating);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [savingFeature, setSavingFeature] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const updateVisibility = () =>
      setTabHidden(document.visibilityState === "hidden");
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () =>
      document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  const currentIndex = Math.max(
    0,
    slides.findIndex((item) => slideId(item) === navigation.activeId),
  );
  const slide = slides[currentIndex];
  const outgoingIndex = slides.findIndex(
    (item) => slideId(item) === navigation.outgoingId,
  );
  const outgoingSlide =
    slide && slideId(slide) === navigation.activeId
      ? slides[outgoingIndex]
      : undefined;
  const navigate = useCallback(
    (target: SlideTarget) => {
      if (slides.length < 2) return;
      setNavigation((current) => {
        const from = Math.max(
          0,
          slides.findIndex((item) => slideId(item) === current.activeId),
        );
        const to =
          "step" in target
            ? (from + target.step + slides.length) % slides.length
            : target.index;
        const next = slides[to];
        const previous = slides[from];
        if (!next || !previous || from === to) return current;
        const direction = "step" in target ? target.step : to > from ? 1 : -1;
        return {
          activeId: slideId(next),
          outgoingId: prefersReducedMotion ? null : slideId(previous),
          direction,
        };
      });
    },
    [prefersReducedMotion, slides],
  );

  const paused =
    hovered ||
    focusWithin ||
    prefersReducedMotion ||
    tabHidden ||
    showPromotionManager ||
    featureDialog !== null;
  useEffect(() => {
    if (paused || slides.length < 2) return;
    const timer = window.setTimeout(() => navigate({ step: 1 }), ROTATION_MS);
    return () => window.clearTimeout(timer);
  }, [paused, slides.length, navigation.activeId, navigate]);

  useEffect(() => {
    if (!navigation.outgoingId) return;
    const timer = window.setTimeout(() => {
      setNavigation((current) =>
        current === navigation ? { ...current, outgoingId: null } : current);
    }, SLIDE_TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [navigation]);

  const selectedMovie = featureDialog
    ? homepageHighlights.find((item) => item.tmdbId === featureDialog.tmdbId)
    : undefined;
  const openFeatureEditor = (movie: Movie) => {
    const existing = homepageHighlights.find(
      (item) => item.tmdbId === movie.tmdbId,
    );
    setFeatureDialog(movie);
    setFeatureStartsOn(existing?.startsOn ?? israelToday());
    setFeatureEndsOn(existing?.endsOn ?? addDays(israelToday(), 30));
    setFeatureLabel(existing?.label ?? null);
    setFeaturePriority(homepageFeatureRating(existing?.priority));
    setAdminError(null);
  };

  const saveFeature = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!featureDialog) return;
    setSavingFeature(true);
    setAdminError(null);
    try {
      await onAdminSaveHomepageHighlight({
        tmdbId: featureDialog.tmdbId,
        startsOn: featureStartsOn,
        endsOn: featureEndsOn,
        priority: featurePriority,
        label: featureLabel,
        enabled: true,
      });
      setFeatureDialog(null);
    } catch (error) {
      setAdminError(
        error instanceof Error
          ? error.message
          : "Could not save homepage highlight.",
      );
    } finally {
      setSavingFeature(false);
    }
  };

  if (slides.length === 0) {
    return isAdmin && userId ? (
      <>
        <div className="homepage-featured-admin-empty">
          <span>Homepage carousel</span>
          <button type="button" onClick={() => setShowPromotionManager(true)}>
            <Plus size={14} /> Manage promotions
          </button>
        </div>
        {showPromotionManager ? (
          <PromotionManager
            userId={userId}
            onClose={() => setShowPromotionManager(false)}
          />
        ) : null}
      </>
    ) : null;
  }
  if (!slide) return null;
  const hasCatalogMovies =
    nowPlayingMovies.length > 0 || comingSoonMovies.length > 0;

  return (
    <>
      <section
        className="homepage-featured"
        aria-label="Featured movies and cinema offers"
        tabIndex={-1}
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch") setHovered(true);
        }}
        onPointerLeave={() => setHovered(false)}
        onFocusCapture={() => setFocusWithin(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setFocusWithin(false);
        }}
        onKeyDown={(event) => {
          if (
            slides.length < 2 ||
            (event.key !== "ArrowRight" && event.key !== "ArrowLeft")
          )
            return;
          event.preventDefault();
          if (
            event.target instanceof HTMLElement &&
            event.target.closest(".homepage-featured-slide")
          ) {
            event.currentTarget.focus();
          }
          navigate({ step: event.key === "ArrowRight" ? 1 : -1 });
        }}
      >
        {isAdmin ? (
          <div className="homepage-featured-admin-tools">
            <button type="button" onClick={() => setShowPromotionManager(true)}>
              <Plus size={14} /> Manage promotions
            </button>
            <span>Choose a movie from a poster grid to schedule it here</span>
          </div>
        ) : null}
        <div
          className="homepage-featured-frame"
          style={
            { "--slide-duration": `${SLIDE_TRANSITION_MS}ms` } as CSSProperties
          }
          data-direction={navigation.direction === 1 ? "forward" : "backward"}
          aria-live={paused ? "polite" : "off"}
        >
          {(outgoingSlide ? [outgoingSlide, slide] : [slide]).map((item) => {
            const outgoing = item === outgoingSlide;
            return (
              <div
                key={slideId(item)}
                className={`homepage-featured-slide${item.type === "promotion" ? " is-promotion" : ""}`}
                data-motion={
                  outgoing ? "outgoing" : outgoingSlide ? "incoming" : undefined
                }
                inert={outgoing}
                aria-hidden={outgoing || undefined}
              >
                {item.type === "movie" ? (
                  <>
                    <img
                      className="homepage-featured-art"
                      src={item.movie.backdropSrc || item.movie.imageSrc}
                      srcSet={
                        item.movie.backdropSrc
                          ? item.movie.backdropSrcSet
                          : item.movie.imageSrcSet
                      }
                      sizes="(max-width: 700px) 100vw, 1100px"
                      alt=""
                      loading="eager"
                      fetchPriority={
                        !outgoing && currentIndex === 0 ? "high" : undefined
                      }
                    />
                    <div className="homepage-featured-copy">
                      {item.label ? (
                        <p className="homepage-featured-label">{item.label}</p>
                      ) : null}
                      <p className="homepage-featured-status">
                        {item.mode === "nowPlaying"
                          ? "Now playing"
                          : "Coming soon"}
                      </p>
                      <h2>{item.movie.title}</h2>
                      {item.movie.publicRouteCode ? (
                        <a
                          className="homepage-featured-cta"
                          href={`/${item.movie.publicRouteCode}`}
                        >
                          {item.ticketsOnSale ? "Get tickets" : "View movie"}
                          <ArrowRight size={18} aria-hidden="true" />
                        </a>
                      ) : (
                        <span
                          className="homepage-featured-cta"
                          aria-disabled="true"
                          title="Movie link temporarily unavailable"
                        >
                          {item.ticketsOnSale ? "Get tickets" : "View movie"}
                          <ArrowRight size={18} aria-hidden="true" />
                        </span>
                      )}
                    </div>
                    {isAdmin ? (
                      <button
                        type="button"
                        className="homepage-featured-edit"
                        onClick={() => openFeatureEditor(item.movie)}
                      >
                        Edit highlight
                      </button>
                    ) : null}
                  </>
                ) : (
                  <div className="homepage-featured-promo-copy">
                    <p className="homepage-featured-status">Cinema offer</p>
                    <h2>{item.promotion.title}</h2>
                    <p className="homepage-featured-promo-body">
                      {item.promotion.body}
                    </p>
                    {item.promotion.ctaLabel && item.promotion.ctaHref ? (
                      <a
                        className="homepage-featured-cta"
                        href={item.promotion.ctaHref}
                        target={
                          item.promotion.ctaHref.startsWith("http")
                            ? "_blank"
                            : undefined
                        }
                        rel={
                          item.promotion.ctaHref.startsWith("http")
                            ? "noreferrer"
                            : undefined
                        }
                      >
                        {item.promotion.ctaLabel}
                        <ArrowRight size={18} aria-hidden="true" />
                      </a>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
          {slides.length > 1 ? (
            <div
              className="homepage-featured-controls"
              role="group"
              aria-label="Choose featured item"
            >
              {slides.map((item, index) => (
                <button
                  key={slideId(item)}
                  type="button"
                  aria-label={`Show featured item ${index + 1} of ${slides.length}`}
                  aria-current={index === currentIndex ? "true" : undefined}
                  onClick={() => navigate({ index })}
                />
              ))}
            </div>
          ) : null}
        </div>
      </section>
      {showPromotionManager && userId ? (
        <PromotionManager
          userId={userId}
          onClose={() => setShowPromotionManager(false)}
        />
      ) : null}
      {featureDialog ? (
        <div
          className="homepage-admin-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !savingFeature)
              setFeatureDialog(null);
          }}
        >
          <form
            className="homepage-admin-dialog homepage-feature-editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby="homepage-feature-title"
            onSubmit={saveFeature}
          >
            <div className="homepage-admin-heading">
              <div>
                <p className="homepage-admin-overline">Homepage carousel</p>
                <h2 id="homepage-feature-title">
                  {selectedMovie
                    ? "Edit movie highlight"
                    : "Feature this movie"}
                </h2>
              </div>
              <button
                className="homepage-admin-icon-button"
                type="button"
                aria-label="Close movie highlight editor"
                onClick={() => setFeatureDialog(null)}
              >
                <X size={18} />
              </button>
            </div>
            <p className="homepage-feature-editor-title">
              {featureDialog.title}
            </p>
            <div className="homepage-promo-date-row">
              <label>
                Starts
                <input
                  required
                  type="date"
                  value={featureStartsOn}
                  onChange={(event) => setFeatureStartsOn(event.target.value)}
                />
              </label>
              <label>
                Ends
                <input
                  required
                  type="date"
                  value={featureEndsOn}
                  onChange={(event) => setFeatureEndsOn(event.target.value)}
                />
              </label>
            </div>
            <div className="homepage-promo-date-row">
              <label>
                Label
                <select
                  value={featureLabel ?? ""}
                  onChange={(event) =>
                    setFeatureLabel(
                      (event.target.value ||
                        null) as HomepageMovieHighlight["label"],
                    )
                  }
                >
                  <option value="">No label</option>
                  <option value="kids">Kids</option>
                  <option value="sci-fi">Sci-Fi</option>
                  <option value="marvel">Marvel</option>
                </select>
              </label>
              <label>
                Feature rating
                <input
                  type="number"
                  min={0}
                  max={MAX_HOMEPAGE_FEATURE_RATING}
                  required
                  value={featurePriority}
                  onChange={(event) =>
                    setFeaturePriority(Number(event.target.value))
                  }
                />
              </label>
            </div>
            {adminError ? (
              <p className="homepage-admin-error" role="alert">
                {adminError}
              </p>
            ) : null}
            <div className="homepage-admin-actions">
              {selectedMovie ? (
                <button
                  className="homepage-admin-secondary"
                  type="button"
                  disabled={savingFeature}
                  onClick={async () => {
                    setSavingFeature(true);
                    try {
                      await onAdminRemoveHomepageHighlight(
                        selectedMovie.tmdbId,
                      );
                      setFeatureDialog(null);
                    } catch (error) {
                      setAdminError(
                        error instanceof Error
                          ? error.message
                          : "Could not remove highlight.",
                      );
                    } finally {
                      setSavingFeature(false);
                    }
                  }}
                >
                  Remove highlight
                </button>
              ) : (
                <span />
              )}
              <button
                className="homepage-admin-primary"
                type="submit"
                disabled={savingFeature}
              >
                {savingFeature ? "Saving…" : "Save highlight"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {isAdmin && !hasCatalogMovies ? (
        <span className="visually-hidden">
          No eligible movies to feature yet.
        </span>
      ) : null}
    </>
  );
}
