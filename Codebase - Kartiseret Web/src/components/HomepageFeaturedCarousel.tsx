import { homepageAdminQueryOptions, homepagePromotionMutationOptions, type HomepageMovieHighlight, type HomepagePromotion, type HomepagePromotionUpsert } from "../data/homepageFeatured";
import { buildHomepageFeaturedSlides, type HomepageFeaturedSlide } from "../data/homepageFeaturedSlides";
import type { HomepageFeaturedResponse } from "@kartiseret/contracts/homepage-featured";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Pause, Play, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Movie } from "../data/movieCatalog";
import type { FormEvent } from "react";
import "./HomepageFeaturedCarousel.css";

type FeaturedPayload = HomepageFeaturedResponse["data"];
const ROTATION_MS = 7_000;

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
  const [activeIndex, setActiveIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
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
  const [featurePriority, setFeaturePriority] = useState(0);
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

  const paused =
    userPaused || hovered || focusWithin || prefersReducedMotion || tabHidden;
  useEffect(() => {
    if (paused || slides.length < 2) return undefined;
    const timer = window.setInterval(() => {
      setActiveIndex((index) => (index + 1) % slides.length);
    }, ROTATION_MS);
    return () => window.clearInterval(timer);
  }, [paused, slides.length]);

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
    setFeaturePriority(existing?.priority ?? 0);
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
  const currentIndex = slides.length ? activeIndex % slides.length : 0;
  const slide: HomepageFeaturedSlide | undefined = slides[currentIndex];
  if (!slide) return null;
  const highlightedMovies = [...nowPlayingMovies, ...comingSoonMovies];

  return (
    <>
      <section
        className="homepage-featured"
        aria-label="Featured movies and cinema offers"
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocusCapture={() => setFocusWithin(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setFocusWithin(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            setActiveIndex((index) => (index + 1) % slides.length);
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            setActiveIndex(
              (index) => (index - 1 + slides.length) % slides.length,
            );
          }
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
          className={`homepage-featured-frame${slide.type === "promotion" ? " is-promotion" : ""}`}
          aria-live={paused ? "polite" : "off"}
        >
          {slide.type === "movie" ? (
            <>
              <img
                className="homepage-featured-art"
                src={slide.movie.backdropSrc || slide.movie.imageSrc}
                srcSet={
                  slide.movie.backdropSrc
                    ? slide.movie.backdropSrcSet
                    : slide.movie.imageSrcSet
                }
                sizes="(max-width: 700px) 100vw, 1100px"
                alt=""
                loading={currentIndex === 0 ? "eager" : "lazy"}
                fetchPriority={currentIndex === 0 ? "high" : undefined}
              />
              <div className="homepage-featured-copy">
                {slide.label ? (
                  <p className="homepage-featured-label">{slide.label}</p>
                ) : null}
                <p className="homepage-featured-status">
                  {slide.mode === "nowPlaying" ? "Now playing" : "Coming soon"}
                </p>
                <h2>{slide.movie.title}</h2>
                <a
                  className="homepage-featured-cta"
                  href={`/${slide.movie.movieCode}`}
                >
                  {slide.mode === "nowPlaying" ? "Get tickets" : "View movie"}
                  <ArrowRight size={18} aria-hidden="true" />
                </a>
              </div>
              {isAdmin ? (
                <button
                  type="button"
                  className="homepage-featured-edit"
                  onClick={() => openFeatureEditor(slide.movie)}
                >
                  Edit highlight
                </button>
              ) : null}
            </>
          ) : (
            <div className="homepage-featured-promo-copy">
              <p className="homepage-featured-status">Cinema offer</p>
              <h2>{slide.promotion.title}</h2>
              <p className="homepage-featured-promo-body">
                {slide.promotion.body}
              </p>
              {slide.promotion.ctaLabel && slide.promotion.ctaHref ? (
                <a
                  className="homepage-featured-cta"
                  href={slide.promotion.ctaHref}
                  target={
                    slide.promotion.ctaHref.startsWith("http")
                      ? "_blank"
                      : undefined
                  }
                  rel={
                    slide.promotion.ctaHref.startsWith("http")
                      ? "noreferrer"
                      : undefined
                  }
                >
                  {slide.promotion.ctaLabel}
                  <ArrowRight size={18} aria-hidden="true" />
                </a>
              ) : null}
            </div>
          )}
          {slides.length > 1 ? (
            <>
              <button
                className="homepage-featured-arrow is-previous"
                type="button"
                aria-label="Previous featured item"
                onClick={() =>
                  setActiveIndex(
                    (index) => (index - 1 + slides.length) % slides.length,
                  )
                }
              >
                <ArrowLeft size={19} />
              </button>
              <button
                className="homepage-featured-arrow is-next"
                type="button"
                aria-label="Next featured item"
                onClick={() =>
                  setActiveIndex((index) => (index + 1) % slides.length)
                }
              >
                <ArrowRight size={19} />
              </button>
            </>
          ) : null}
        </div>
        {slides.length > 1 ? (
          <div className="homepage-featured-controls">
            <div
              className="homepage-featured-dots"
              role="group"
              aria-label="Choose featured item"
            >
              {slides.map((item, index) => (
                <button
                  key={`${item.type}-${index}`}
                  type="button"
                  className={index === currentIndex ? "is-active" : ""}
                  aria-label={`Show featured item ${index + 1} of ${slides.length}`}
                  aria-current={index === currentIndex ? "true" : undefined}
                  onClick={() => setActiveIndex(index)}
                />
              ))}
            </div>
            <button
              className="homepage-featured-pause"
              type="button"
              aria-label={userPaused ? "Play carousel" : "Pause carousel"}
              onClick={() => setUserPaused((pausedByUser) => !pausedByUser)}
            >
              {userPaused ? <Play size={14} /> : <Pause size={14} />}
            </button>
            {prefersReducedMotion ? (
              <span className="visually-hidden">
                Automatic rotation is paused because reduced motion is enabled.
              </span>
            ) : null}
          </div>
        ) : null}
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
                Priority
                <input
                  type="number"
                  min={-100}
                  max={100}
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
      {isAdmin && highlightedMovies.length === 0 ? (
        <span className="visually-hidden">
          No eligible movies to feature yet.
        </span>
      ) : null}
    </>
  );
}
