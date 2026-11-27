import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  or,
  sql,
} from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_LOCATION,
  DEFAULT_HIDE_RE_RELEASES,
  DEFAULT_RATING_SOURCES,
  DEFAULT_SITE_COLOR,
  normalizeHideReReleases,
  normalizeLocation,
  normalizeRatingSources,
  normalizeSiteColor,
} from "@kartiseret/contracts/preferences";
import {
  DEFAULT_SHOWTIME_PREFERENCES,
  normalizeShowtimePreferences,
} from "@kartiseret/contracts/showtime-preferences";
import type {
  Correction,
  MovieDisplayPreference,
  MovieDisplayPreferencePage,
  PreferencePatch,
  Preferences,
  PushDeviceRegistration,
  SubscriptionChange,
  TicketAlertCriteria,
  TicketAlertCriteriaOverride,
  ComingSoonDateWatch,
  ComingSoonDateWatchChange,
  LetterboxdSource,
  WalletTicket,
  WalletTicketCreate,
  WalletTicketDetail,
  WalletTicketPatch,
  WalletTicketRecentClick,
} from "@kartiseret/contracts/private-data";
import {
  homepageAdminDataResponseSchema,
  homepageMovieHighlightResponseSchema,
  homepagePromotionResponseSchema,
  type HomepageMovieHighlight,
  type HomepagePromotionUpsert,
} from "@kartiseret/contracts/homepage-featured";
import {
  DEFAULT_TICKET_ALERT_CRITERIA,
  MOVIE_DISPLAY_PREFERENCE_PAGE_SIZE,
  matchesTicketAlertCriteria,
  resolveTicketAlertCriteria,
} from "@kartiseret/contracts/private-data";
import {
  addCalendarDays,
  getJerusalemCinemaDate,
} from "@kartiseret/contracts/showtime-links";
import { shouldIncludeShowtime } from "@kartiseret/contracts/showtime-day";
import type {
  ApplicationDatabase,
  ApplicationTransaction,
} from "../db/client.js";
import {
  adminUsers,
  userPreferences,
  apnsDevices,
  ticketAlertPreferences,
  ticketAlertSubscriptions,
  comingSoonDateWatches,
  userMovieDisplayPreferences,
  letterboxdSources,
  homepageMovieHighlights,
  homepagePromotions,
  finalMovies,
  finalSoons,
  finalShowtimes,
  userWalletTickets,
  userWalletRecentShowtimeClicks,
  tableFixes,
} from "../db/schema.js";
import type { PublicDataRepository } from "../public-data/repository.js";
import { getTicketAvailabilityShowtimes } from "../public-data/service.js";
import { HttpError } from "../http-errors.js";
import { stripEdgeDoubleQuotes } from "../text.js";
import type { VerifiedIdentity } from "./identity.js";
import { parseLetterboxdSourceUrl } from "./letterboxd-source-url.js";

const subscriptionColumns = {
  tmdbId: ticketAlertSubscriptions.tmdbId,
  createdAt: ticketAlertSubscriptions.createdAt,
  notifiedAt: ticketAlertSubscriptions.notifiedAt,
  deliveryTitle: ticketAlertSubscriptions.deliveryTitle,
  deliveryDate: ticketAlertSubscriptions.deliveryDate,
  criteriaOverrides: ticketAlertSubscriptions.criteriaOverrides,
  completedCities: sql<
    string[]
  >`array(select scope_city from public.movie_notification_events e
    where e.user_id = ${ticketAlertSubscriptions.userId} and e.tmdb_id = ${ticketAlertSubscriptions.tmdbId}
      and e.event_type = 'showtime' and e.status in ('sent','suppressed'))`,
};
const comingSoonDateWatchColumns = {
  tmdbId: comingSoonDateWatches.tmdbId,
  title: comingSoonDateWatches.title,
  releaseYear: comingSoonDateWatches.releaseYear,
  posterPath: comingSoonDateWatches.posterPath,
  createdAt: comingSoonDateWatches.createdAt,
  notifiedAt: comingSoonDateWatches.notifiedAt,
  deliveryTitle: comingSoonDateWatches.deliveryTitle,
  deliveryDate: comingSoonDateWatches.deliveryDate,
};
const letterboxdSourceColumns = {
  id: letterboxdSources.id,
  sourceUrl: letterboxdSources.sourceUrl,
  sourceType: letterboxdSources.sourceType,
  createdAt: letterboxdSources.createdAt,
  lastSyncAttemptAt: letterboxdSources.lastSyncAttemptAt,
  lastSuccessfulSyncAt: letterboxdSources.lastSuccessfulSyncAt,
  lastSyncError: letterboxdSources.lastSyncError,
  filmCount: letterboxdSources.filmCount,
  matchedFilmCount: letterboxdSources.matchedFilmCount,
};

function mapLetterboxdSource(row: {
  id: string;
  sourceUrl: string;
  sourceType: string;
  createdAt: Date;
  lastSyncAttemptAt: Date | null;
  lastSuccessfulSyncAt: Date | null;
  lastSyncError: string | null;
  filmCount: number;
  matchedFilmCount: number;
}): LetterboxdSource {
  return {
    id: row.id,
    sourceUrl: row.sourceUrl,
    sourceType: row.sourceType as LetterboxdSource["sourceType"],
    createdAt: row.createdAt.toISOString(),
    lastSyncAttemptAt: row.lastSyncAttemptAt?.toISOString() ?? null,
    lastSuccessfulSyncAt: row.lastSuccessfulSyncAt?.toISOString() ?? null,
    lastSyncError: row.lastSyncError,
    filmCount: row.filmCount,
    matchedFilmCount: row.matchedFilmCount,
  };
}

function mapWalletTicket(
  row: typeof userWalletTickets.$inferSelect,
): WalletTicket {
  return {
    id: row.id,
    tmdbId: row.tmdbId === null ? null : String(row.tmdbId),
    title: row.title,
    city: row.city,
    cinema: row.cinema,
    screeningDate: row.screeningDate,
    screeningTime: row.screeningTime.slice(0, 5),
    reminderEnabled: row.reminderEnabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapWalletTicketDetail(
  row: typeof userWalletTickets.$inferSelect,
): WalletTicketDetail {
  return { ...mapWalletTicket(row), qrMessage: row.qrMessage };
}

function jerusalemLocalMinute(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}
function mapSubscription(
  row:
    | typeof ticketAlertSubscriptions.$inferSelect
    | {
        tmdbId: bigint;
        createdAt: Date;
        notifiedAt: Date | null;
        deliveryTitle: string | null;
        deliveryDate: string | null;
        criteriaOverrides: TicketAlertCriteriaOverride;
        completedCities?: string[];
      },
) {
  return {
    tmdbId: String(row.tmdbId),
    createdAt: row.createdAt.toISOString(),
    notifiedAt: row.notifiedAt?.toISOString() ?? null,
    deliveryTitle: row.deliveryTitle,
    deliveryDate: row.deliveryDate,
    criteriaOverrides: row.criteriaOverrides ?? {},
    completedCities:
      "completedCities" in row ? (row.completedCities ?? []) : [],
  };
}

function mapTicketAlertPreferences(row?: {
  cities: string[] | null;
  filterExclusions: TicketAlertCriteria["filters"];
  notificationMode?: string;
}): TicketAlertCriteria {
  return row
    ? {
        cities: row.cities as TicketAlertCriteria["cities"],
        notificationMode: (row.notificationMode ??
          "first_any_city") as TicketAlertCriteria["notificationMode"],
        filters: row.filterExclusions,
      }
    : DEFAULT_TICKET_ALERT_CRITERIA;
}
export class ProtectedWorkflows {
  constructor(
    private readonly db: ApplicationDatabase,
    private readonly publicRepository: PublicDataRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** SET LOCAL is scoped to the same real transaction as all its queries. It
   * cannot leak identity into another request on the transaction pooler. */
  private asUser<T>(
    user: VerifiedIdentity,
    work: (tx: ApplicationTransaction) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', ${user.id}, true)`);
      return work(tx);
    });
  }
  private async isAdmin(
    tx: ApplicationTransaction,
    userId: string,
  ): Promise<boolean> {
    const rows = await tx
      .select({ id: adminUsers.userId })
      .from(adminUsers)
      .where(eq(adminUsers.userId, userId))
      .limit(1);
    return rows.length === 1;
  }
  homepageAdminData(user: VerifiedIdentity) {
    return this.asUser(user, async (tx) => {
      if (!(await this.isAdmin(tx, user.id)))
        throw new HttpError(
          403,
          "forbidden",
          "Administrator access is required.",
        );
      const [highlights, promotions] = await Promise.all([
        tx
          .select()
          .from(homepageMovieHighlights)
          .orderBy(
            desc(homepageMovieHighlights.priority),
            asc(homepageMovieHighlights.createdAt),
          ),
        tx
          .select()
          .from(homepagePromotions)
          .orderBy(
            desc(homepagePromotions.priority),
            asc(homepagePromotions.createdAt),
          ),
      ]);
      return homepageAdminDataResponseSchema.parse({
        data: {
          highlights: highlights.map((row) => ({
            tmdbId: String(row.tmdbId),
            startsOn: row.startsOn,
            endsOn: row.endsOn,
            priority: row.priority,
            label: row.label,
            enabled: row.enabled,
          })),
          promotions: promotions.map((row) => ({
            id: row.id,
            title: row.title,
            body: row.body,
            startsOn: row.startsOn,
            endsOn: row.endsOn,
            priority: row.priority,
            ctaLabel: row.ctaLabel,
            ctaHref: row.ctaHref,
            enabled: row.enabled,
          })),
        },
        error: null,
      });
    });
  }
  upsertHomepageHighlight(
    user: VerifiedIdentity,
    command: HomepageMovieHighlight,
  ) {
    return this.asUser(user, async (tx) => {
      if (!(await this.isAdmin(tx, user.id)))
        throw new HttpError(
          403,
          "forbidden",
          "Administrator access is required.",
        );
      const [row] = await tx
        .insert(homepageMovieHighlights)
        .values({
          tmdbId: Number(command.tmdbId),
          startsOn: command.startsOn,
          endsOn: command.endsOn,
          priority: command.priority,
          label: command.label,
          enabled: command.enabled,
        })
        .onConflictDoUpdate({
          target: homepageMovieHighlights.tmdbId,
          set: {
            startsOn: command.startsOn,
            endsOn: command.endsOn,
            priority: command.priority,
            label: command.label,
            enabled: command.enabled,
            updatedAt: new Date(),
          },
        })
        .returning();
      return homepageMovieHighlightResponseSchema.parse({
        data: {
          highlight: {
            tmdbId: String(row.tmdbId),
            startsOn: row.startsOn,
            endsOn: row.endsOn,
            priority: row.priority,
            label: row.label,
            enabled: row.enabled,
          },
        },
        error: null,
      });
    });
  }
  removeHomepageHighlight(user: VerifiedIdentity, tmdbId: string) {
    return this.asUser(user, async (tx) => {
      if (!(await this.isAdmin(tx, user.id)))
        throw new HttpError(
          403,
          "forbidden",
          "Administrator access is required.",
        );
      await tx
        .delete(homepageMovieHighlights)
        .where(eq(homepageMovieHighlights.tmdbId, Number(tmdbId)));
      return { data: { removed: true as const }, error: null };
    });
  }
  upsertHomepagePromotion(
    user: VerifiedIdentity,
    command: HomepagePromotionUpsert,
  ) {
    return this.asUser(user, async (tx) => {
      if (!(await this.isAdmin(tx, user.id)))
        throw new HttpError(
          403,
          "forbidden",
          "Administrator access is required.",
        );
      const id = command.id ?? randomUUID();
      const values = {
        id,
        title: command.title,
        body: command.body,
        startsOn: command.startsOn,
        endsOn: command.endsOn,
        priority: command.priority,
        ctaLabel: command.ctaLabel,
        ctaHref: command.ctaHref,
        enabled: command.enabled,
      };
      const [promotion] = await tx
        .insert(homepagePromotions)
        .values(values)
        .onConflictDoUpdate({
          target: homepagePromotions.id,
          set: { ...values, updatedAt: new Date() },
        })
        .returning();
      return homepagePromotionResponseSchema.parse({
        data: {
          promotion: {
            id: promotion.id,
            title: promotion.title,
            body: promotion.body,
            startsOn: promotion.startsOn,
            endsOn: promotion.endsOn,
            priority: promotion.priority,
            ctaLabel: promotion.ctaLabel,
            ctaHref: promotion.ctaHref,
            enabled: promotion.enabled,
          },
        },
        error: null,
      });
    });
  }
  account(user: VerifiedIdentity) {
    return this.asUser(user, async (tx) => ({
      user: { id: user.id, email: user.email },
      isAdmin: await this.isAdmin(tx, user.id),
    }));
  }
  private async initialize(
    tx: ApplicationTransaction,
    user: VerifiedIdentity,
    fallbackLocation?: string,
  ): Promise<Preferences> {
    // Serialize first login, signup initialization and partial saves for one user.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${user.id}, 0))`,
    );
    const initialLocation = normalizeLocation(
      user.signupLocation ?? fallbackLocation ?? DEFAULT_LOCATION,
    );
    await tx
      .insert(userPreferences)
      .values({
        userId: user.id,
        ratingSources: [...DEFAULT_RATING_SOURCES],
        location: initialLocation,
        siteColor: DEFAULT_SITE_COLOR,
        hideReReleases: DEFAULT_HIDE_RE_RELEASES,
        notificationDelivery: "email",
        showtimePreferences: DEFAULT_SHOWTIME_PREFERENCES,
        signupInitialized: true,
      })
      .onConflictDoNothing({ target: userPreferences.userId });
    const [row] = await tx
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, user.id))
      .for("update");
    if (!row) throw new Error("Preference initialization returned no row.");
    const result: Preferences = {
      ratingSources: normalizeRatingSources(row.ratingSources, {
        allowEmpty: true,
      }),
      location: normalizeLocation(
        !row.signupInitialized &&
          (!row.location?.trim() || row.location === DEFAULT_LOCATION)
          ? initialLocation
          : row.location,
      ),
      siteColor: normalizeSiteColor(row.siteColor),
      hideReReleases: normalizeHideReReleases(row.hideReReleases),
      notificationDelivery:
        row.notificationDelivery === "iphone" ||
        row.notificationDelivery === "both" ||
        row.notificationDelivery === "neither"
          ? row.notificationDelivery
          : "email",
      showtimePreferences: normalizeShowtimePreferences(
        row.showtimePreferences,
      ),
    };
    const repair =
      !row.signupInitialized || !row.location?.trim() || !row.siteColor?.trim();
    if (repair)
      await tx
        .update(userPreferences)
        .set({
          location: result.location,
          siteColor: result.siteColor,
          notificationDelivery: result.notificationDelivery,
          signupInitialized: true,
        })
        .where(eq(userPreferences.userId, user.id));
    return result;
  }
  preferences(user: VerifiedIdentity, fallbackLocation?: string) {
    return this.asUser(user, (tx) =>
      this.initialize(tx, user, fallbackLocation),
    );
  }
  readPagePreferences(user: VerifiedIdentity): Promise<Preferences> {
    return this.asUser(user, async (tx) => {
      const [row] = await tx
        .select()
        .from(userPreferences)
        .where(eq(userPreferences.userId, user.id))
        .limit(1);
      const initialLocation = normalizeLocation(
        user.signupLocation ?? DEFAULT_LOCATION,
      );
      return {
        location: normalizeLocation(
          !row?.signupInitialized &&
            (!row?.location?.trim() || row.location === DEFAULT_LOCATION)
            ? initialLocation
            : row.location,
        ),
        ratingSources: row
          ? normalizeRatingSources(row.ratingSources, { allowEmpty: true })
          : [...DEFAULT_RATING_SOURCES],
        siteColor: normalizeSiteColor(row?.siteColor),
        hideReReleases: normalizeHideReReleases(row?.hideReReleases),
        notificationDelivery:
          row?.notificationDelivery === "iphone" ||
          row?.notificationDelivery === "both" ||
          row?.notificationDelivery === "neither"
            ? row.notificationDelivery
            : "email",
        showtimePreferences: normalizeShowtimePreferences(
          row?.showtimePreferences,
        ),
      };
    });
  }

  readPageMovieTreatments(
    user: VerifiedIdentity,
    movieIds: readonly string[],
  ): Promise<MovieDisplayPreference[]> {
    if (!movieIds.length) return Promise.resolve([]);
    return this.asUser(user, async (tx) => {
      const rows = await tx
        .select({
          tmdbId: userMovieDisplayPreferences.tmdbId,
          title: userMovieDisplayPreferences.title,
          releaseYear: userMovieDisplayPreferences.releaseYear,
          treatment: userMovieDisplayPreferences.treatment,
          hideBackdrop: userMovieDisplayPreferences.hideBackdrop,
        })
        .from(userMovieDisplayPreferences)
        .where(
          and(
            eq(userMovieDisplayPreferences.userId, user.id),
            inArray(
              userMovieDisplayPreferences.tmdbId,
              movieIds.map((id) => BigInt(id)),
            ),
          ),
        );
      return rows.map((row) => ({
        ...row,
        tmdbId: String(row.tmdbId),
        treatment: row.treatment as MovieDisplayPreference["treatment"],
      }));
    });
  }
  patchPreferences(user: VerifiedIdentity, patch: PreferencePatch) {
    return this.asUser(user, async (tx) => {
      const current = await this.initialize(tx, user);
      await tx
        .update(userPreferences)
        .set(patch)
        .where(eq(userPreferences.userId, user.id));
      return { ...current, ...patch };
    });
  }
  pushDeviceStatus(user: VerifiedIdentity, deviceToken?: string) {
    return this.asUser(user, async (tx) => {
      const [device] = await tx
        .select({ id: apnsDevices.id })
        .from(apnsDevices)
        .where(
          and(
            eq(apnsDevices.userId, user.id),
            eq(apnsDevices.active, true),
            isNotNull(apnsDevices.deviceToken),
            ...(deviceToken ? [eq(apnsDevices.deviceToken, deviceToken)] : []),
          ),
        )
        .limit(1);
      return { registered: Boolean(device) };
    });
  }
  registerPushDevice(
    user: VerifiedIdentity,
    registration: PushDeviceRegistration,
  ) {
    return this.asUser(user, async (tx) => {
      await tx.execute(sql`
        select app_auth.register_apns_device(
          ${registration.token}, ${registration.environment}
        )
      `);
      return { registered: true };
    });
  }
  unregisterPushDevice(user: VerifiedIdentity, token: string) {
    return this.asUser(user, async (tx) => {
      await tx.execute(sql`
        select app_auth.unregister_apns_device(${token})
      `);
      return { registered: false };
    });
  }
  ticketAlertPreferences(user: VerifiedIdentity) {
    return this.asUser(user, async (tx) => {
      const [row] = await tx
        .select({
          cities: ticketAlertPreferences.cities,
          notificationMode: ticketAlertPreferences.notificationMode,
          filterExclusions: ticketAlertPreferences.filterExclusions,
        })
        .from(ticketAlertPreferences)
        .where(eq(ticketAlertPreferences.userId, user.id))
        .limit(1);
      return mapTicketAlertPreferences(row);
    });
  }
  patchTicketAlertPreferences(
    user: VerifiedIdentity,
    criteria: TicketAlertCriteria,
  ) {
    return this.asUser(user, async (tx) => {
      await tx
        .insert(ticketAlertPreferences)
        .values({
          userId: user.id,
          cities: criteria.cities,
          notificationMode: criteria.notificationMode,
          filterExclusions: criteria.filters,
          updatedAt: this.clock(),
        })
        .onConflictDoUpdate({
          target: ticketAlertPreferences.userId,
          set: {
            cities: criteria.cities,
            notificationMode: criteria.notificationMode,
            filterExclusions: criteria.filters,
            updatedAt: this.clock(),
          },
        });
      return criteria;
    });
  }
  subscriptions(user: VerifiedIdentity, offset: number) {
    return this.asUser(user, async (tx) => {
      const rows = await tx
        .select(subscriptionColumns)
        .from(ticketAlertSubscriptions)
        .where(eq(ticketAlertSubscriptions.userId, user.id))
        .orderBy(
          desc(ticketAlertSubscriptions.createdAt),
          asc(ticketAlertSubscriptions.tmdbId),
        )
        .limit(1000)
        .offset(offset);
      return {
        subscriptions: rows.map(mapSubscription),
        nextOffset: rows.length === 1000 ? offset + 1000 : null,
      };
    });
  }

  comingSoonDateWatches(
    user: VerifiedIdentity,
  ): Promise<ComingSoonDateWatch[]> {
    return this.asUser(user, async (tx) => {
      const rows = await tx
        .select(comingSoonDateWatchColumns)
        .from(comingSoonDateWatches)
        .where(eq(comingSoonDateWatches.userId, user.id))
        .orderBy(
          desc(comingSoonDateWatches.createdAt),
          asc(comingSoonDateWatches.tmdbId),
        )
        .limit(1000);
      const catalogIds = rows
        .map((row) => Number(row.tmdbId))
        .filter(
          (id) => Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647,
        );
      const localRows =
        catalogIds.length > 0
          ? await tx
              .select({
                tmdbId: finalSoons.tmdbId,
                title: finalSoons.englishTitle,
                releaseDate: finalSoons.releaseDate,
              })
              .from(finalSoons)
              .where(
                and(
                  inArray(finalSoons.tmdbId, [...new Set(catalogIds)]),
                  eq(finalSoons.soloUpdate, false),
                ),
              )
              .orderBy(
                asc(finalSoons.releaseDate),
                sql`${finalSoons.popularity} DESC NULLS LAST`,
                asc(finalSoons.id),
              )
          : [];
      const localById = new Map<number, (typeof localRows)[number]>();
      for (const row of localRows)
        if (!localById.has(row.tmdbId)) localById.set(row.tmdbId, row);

      return rows.map((row) => {
        const local = localById.get(Number(row.tmdbId));
        return {
          tmdbId: String(row.tmdbId),
          title: local?.title ?? row.deliveryTitle ?? row.title,
          releaseYear: row.releaseYear,
          posterPath: row.posterPath,
          createdAt: row.createdAt.toISOString(),
          notifiedAt: row.notifiedAt?.toISOString() ?? null,
          comingSoonDate: local?.releaseDate ?? row.deliveryDate,
        };
      });
    });
  }

  watchComingSoonDate(
    user: VerifiedIdentity,
    input: {
      tmdbId: string;
      title: string;
      releaseYear: number | null;
      posterPath: string | null;
    },
  ): Promise<ComingSoonDateWatchChange> {
    return this.asUser(user, async (tx) => {
      const tmdbId = BigInt(input.tmdbId);
      const predicate = and(
        eq(comingSoonDateWatches.userId, user.id),
        eq(comingSoonDateWatches.tmdbId, tmdbId),
      );
      const [existing] = await tx
        .select(comingSoonDateWatchColumns)
        .from(comingSoonDateWatches)
        .where(predicate)
        .limit(1);
      const numericId = Number(tmdbId);
      const localRows =
        Number.isSafeInteger(numericId) && numericId <= 2_147_483_647
          ? await tx
              .select({
                title: finalSoons.englishTitle,
                releaseDate: finalSoons.releaseDate,
              })
              .from(finalSoons)
              .where(
                and(
                  eq(finalSoons.tmdbId, numericId),
                  eq(finalSoons.soloUpdate, false),
                ),
              )
              .orderBy(
                asc(finalSoons.releaseDate),
                sql`${finalSoons.popularity} DESC NULLS LAST`,
                asc(finalSoons.id),
              )
              .limit(1)
          : [];
      const local = localRows[0];
      if (existing) {
        return {
          kind: "watching",
          watch: {
            tmdbId: String(existing.tmdbId),
            title: local?.title ?? existing.deliveryTitle ?? existing.title,
            releaseYear: existing.releaseYear,
            posterPath: existing.posterPath,
            createdAt: existing.createdAt.toISOString(),
            notifiedAt: existing.notifiedAt?.toISOString() ?? null,
            comingSoonDate: local?.releaseDate ?? existing.deliveryDate,
          },
        };
      }
      if (local) {
        return {
          kind: "known",
          tmdbId: input.tmdbId,
          title: local.title,
          comingSoonDate: local.releaseDate,
        };
      }

      // INSERT names only user-controlled watch metadata. Delivery fields stay
      // server-owned, and a concurrent watch request resolves through the row
      // read below instead of overwriting its delivery state.
      await tx.execute(sql`insert into ${comingSoonDateWatches}
        ("user_id", "tmdb_id", "title", "release_year", "poster_path")
        values (${user.id}, ${input.tmdbId}, ${input.title}, ${input.releaseYear}, ${input.posterPath})
        on conflict ("user_id", "tmdb_id") do nothing`);
      const [watch] = await tx
        .select(comingSoonDateWatchColumns)
        .from(comingSoonDateWatches)
        .where(predicate)
        .limit(1);
      if (!watch)
        throw new HttpError(
          409,
          "watch_changed",
          "This title watch changed concurrently. Please try again.",
        );
      return {
        kind: "watching",
        watch: {
          tmdbId: String(watch.tmdbId),
          title: watch.title,
          releaseYear: watch.releaseYear,
          posterPath: watch.posterPath,
          createdAt: watch.createdAt.toISOString(),
          notifiedAt: watch.notifiedAt?.toISOString() ?? null,
          comingSoonDate: watch.deliveryDate,
        },
      };
    });
  }

  unwatchComingSoonDate(user: VerifiedIdentity, tmdbId: string) {
    return this.asUser(user, async (tx) => {
      await tx
        .delete(comingSoonDateWatches)
        .where(
          and(
            eq(comingSoonDateWatches.userId, user.id),
            eq(comingSoonDateWatches.tmdbId, BigInt(tmdbId)),
          ),
        );
      return { removed: true as const };
    });
  }

  movieDisplayPreferences(
    user: VerifiedIdentity,
    after?: string,
  ): Promise<MovieDisplayPreferencePage> {
    return this.asUser(user, async (tx) => {
      const rows = await tx
        .select({
          tmdbId: userMovieDisplayPreferences.tmdbId,
          title: userMovieDisplayPreferences.title,
          releaseYear: userMovieDisplayPreferences.releaseYear,
          treatment: userMovieDisplayPreferences.treatment,
          hideBackdrop: userMovieDisplayPreferences.hideBackdrop,
        })
        .from(userMovieDisplayPreferences)
        .where(
          after
            ? and(
                eq(userMovieDisplayPreferences.userId, user.id),
                gt(userMovieDisplayPreferences.tmdbId, BigInt(after)),
              )
            : eq(userMovieDisplayPreferences.userId, user.id),
        )
        .orderBy(asc(userMovieDisplayPreferences.tmdbId))
        .limit(MOVIE_DISPLAY_PREFERENCE_PAGE_SIZE + 1);

      const hasMore = rows.length > MOVIE_DISPLAY_PREFERENCE_PAGE_SIZE;
      const pageRows = rows.slice(0, MOVIE_DISPLAY_PREFERENCE_PAGE_SIZE);
      return {
        preferences: pageRows.map((row) => ({
          tmdbId: String(row.tmdbId),
          title: row.title,
          releaseYear: row.releaseYear,
          treatment: row.treatment as MovieDisplayPreference["treatment"],
          hideBackdrop: row.hideBackdrop,
        })),
        nextCursor: hasMore ? String(pageRows.at(-1)!.tmdbId) : null,
      };
    });
  }

  upsertMovieDisplayPreference(
    user: VerifiedIdentity,
    preference: MovieDisplayPreference,
  ): Promise<MovieDisplayPreference> {
    return this.asUser(user, async (tx) => {
      const tmdbId = BigInt(preference.tmdbId);
      await tx
        .insert(userMovieDisplayPreferences)
        .values({
          userId: user.id,
          tmdbId,
          title: preference.title,
          releaseYear: preference.releaseYear,
          treatment: preference.treatment,
          hideBackdrop: preference.hideBackdrop,
        })
        .onConflictDoUpdate({
          target: [
            userMovieDisplayPreferences.userId,
            userMovieDisplayPreferences.tmdbId,
          ],
          set: {
            title: preference.title,
            releaseYear: preference.releaseYear,
            treatment: preference.treatment,
            hideBackdrop: preference.hideBackdrop,
          },
        });
      return preference;
    });
  }

  patchMovieDisplayPreference(
    user: VerifiedIdentity,
    tmdbId: string,
    patch: Partial<Pick<MovieDisplayPreference, "treatment" | "hideBackdrop">>,
  ): Promise<MovieDisplayPreference> {
    return this.asUser(user, async (tx) => {
      const [row] = await tx
        .update(userMovieDisplayPreferences)
        .set(patch)
        .where(
          and(
            eq(userMovieDisplayPreferences.userId, user.id),
            eq(userMovieDisplayPreferences.tmdbId, BigInt(tmdbId)),
          ),
        )
        .returning({
          tmdbId: userMovieDisplayPreferences.tmdbId,
          title: userMovieDisplayPreferences.title,
          releaseYear: userMovieDisplayPreferences.releaseYear,
          treatment: userMovieDisplayPreferences.treatment,
          hideBackdrop: userMovieDisplayPreferences.hideBackdrop,
        });
      if (!row)
        throw new HttpError(
          404,
          "movie_display_preference_not_found",
          "This movie display preference no longer exists.",
        );
      return {
        tmdbId: String(row.tmdbId),
        title: row.title,
        releaseYear: row.releaseYear,
        treatment: row.treatment as MovieDisplayPreference["treatment"],
        hideBackdrop: row.hideBackdrop,
      };
    });
  }

  removeMovieDisplayPreference(user: VerifiedIdentity, tmdbId: string) {
    return this.asUser(user, async (tx) => {
      await tx
        .delete(userMovieDisplayPreferences)
        .where(
          and(
            eq(userMovieDisplayPreferences.userId, user.id),
            eq(userMovieDisplayPreferences.tmdbId, BigInt(tmdbId)),
          ),
        );
      return { removed: true as const };
    });
  }

  listLetterboxdSources(user: VerifiedIdentity): Promise<LetterboxdSource[]> {
    return this.asUser(user, async (tx) => {
      const rows = await tx
        .select(letterboxdSourceColumns)
        .from(letterboxdSources)
        .where(eq(letterboxdSources.userId, user.id))
        .orderBy(desc(letterboxdSources.createdAt), asc(letterboxdSources.id))
        .limit(50);
      return rows.map(mapLetterboxdSource);
    });
  }

  addLetterboxdSource(
    user: VerifiedIdentity,
    input: { sourceUrl: string },
  ): Promise<LetterboxdSource> {
    const parsed = parseLetterboxdSourceUrl(input.sourceUrl);
    return this.asUser(user, async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${user.id}, 0))`,
      );
      const existing = await tx
        .select({ id: letterboxdSources.id })
        .from(letterboxdSources)
        .where(eq(letterboxdSources.userId, user.id))
        .limit(50);
      const found = await tx
        .select(letterboxdSourceColumns)
        .from(letterboxdSources)
        .where(
          and(
            eq(letterboxdSources.userId, user.id),
            eq(letterboxdSources.sourceUrl, parsed.sourceUrl),
          ),
        )
        .limit(1);
      if (found[0]) return mapLetterboxdSource(found[0]);
      if (existing.length >= 50)
        throw new HttpError(
          409,
          "letterboxd_source_limit",
          "You can track up to 50 Letterboxd sources.",
        );

      // Keep this INSERT narrow: Drizzle includes omitted default columns in
      // generated INSERT statements, but the runtime role is intentionally
      // granted INSERT only on these three user-controlled columns.
      await tx.execute(sql`
        insert into public.letterboxd_sources (user_id, source_url, source_type)
        values (${user.id}, ${parsed.sourceUrl}, ${parsed.sourceType})
        on conflict (user_id, source_url) do nothing
      `);
      const [row] = await tx
        .select(letterboxdSourceColumns)
        .from(letterboxdSources)
        .where(
          and(
            eq(letterboxdSources.userId, user.id),
            eq(letterboxdSources.sourceUrl, parsed.sourceUrl),
          ),
        )
        .limit(1);
      if (!row)
        throw new HttpError(
          409,
          "letterboxd_source_changed",
          "This Letterboxd source changed concurrently. Please try again.",
        );
      return mapLetterboxdSource(row);
    });
  }

  removeLetterboxdSource(
    user: VerifiedIdentity,
    sourceId: string,
  ): Promise<{ removed: true }> {
    return this.asUser(user, async (tx) => {
      await tx
        .delete(letterboxdSources)
        .where(
          and(
            eq(letterboxdSources.userId, user.id),
            eq(letterboxdSources.id, sourceId),
          ),
        );
      return { removed: true as const };
    });
  }

  async subscribe(
    user: VerifiedIdentity,
    tmdbId: string,
  ): Promise<SubscriptionChange> {
    const instant = this.clock();
    const defaults = resolveTicketAlertCriteria(
      await this.ticketAlertPreferences(user),
      {},
      (await this.preferences(user)).location,
    );
    const showtimes = await getTicketAvailabilityShowtimes(
      this.publicRepository,
      tmdbId,
      getJerusalemCinemaDate(instant),
    );
    const availableCities = [
      ...new Set(
        showtimes
          .filter(
            (row) =>
              shouldIncludeShowtime(row.dateOfShowing, row.showtime, instant) &&
              matchesTicketAlertCriteria(
                {
                  city: row.screeningCity,
                  time: row.showtime,
                  screeningType: row.screeningType,
                  screeningTech: row.screeningTech,
                  dubLanguage: row.dubLanguage,
                },
                defaults,
              ),
          )
          .map((row) => row.screeningCity),
      ),
    ];
    if (
      defaults.notificationMode === "first_per_city"
        ? (defaults.cities ?? []).every((city) =>
            availableCities.includes(city),
          )
        : availableCities.length > 0
    )
      return { kind: "available" };
    return this.asUser(user, async (tx) => {
      const predicate = and(
        eq(ticketAlertSubscriptions.userId, user.id),
        eq(ticketAlertSubscriptions.tmdbId, BigInt(tmdbId)),
      );
      // DO NOTHING preserves delivery IDs, snapshots, retries and sent records;
      // it also avoids a failed transaction when concurrent inserts race.
      // Drizzle's table INSERT includes DEFAULT for every mapped column. Name
      // only the permitted columns here so runtime cannot write delivery state.
      await tx.execute(sql`insert into ${ticketAlertSubscriptions} ("user_id", "tmdb_id", "baseline_cities")
        values (${user.id}, ${tmdbId}, ${sql`ARRAY[${sql.join(
          availableCities.map((city) => sql`${city}`),
          sql`, `,
        )}]::text[]`}) on conflict ("user_id", "tmdb_id") do nothing`);
      // Read back through Drizzle's column decoders (raw pg timestamp values
      // differ from the mapped Date representation used by this service).
      const [row] = await tx
        .select(subscriptionColumns)
        .from(ticketAlertSubscriptions)
        .where(predicate);
      if (!row)
        throw new HttpError(
          409,
          "subscription_changed",
          "This alert changed concurrently. Please try again.",
        );
      return { kind: "account", subscription: mapSubscription(row) };
    });
  }
  updateTicketAlertCriteria(
    user: VerifiedIdentity,
    tmdbId: string,
    criteriaOverrides: TicketAlertCriteriaOverride,
  ): Promise<SubscriptionChange> {
    return this.asUser(user, async (tx) => {
      const rows = await tx
        .update(ticketAlertSubscriptions)
        .set({ criteriaOverrides })
        .where(
          and(
            eq(ticketAlertSubscriptions.userId, user.id),
            eq(ticketAlertSubscriptions.tmdbId, BigInt(tmdbId)),
          ),
        )
        .returning(subscriptionColumns);
      if (!rows[0])
        throw new HttpError(
          404,
          "subscription_not_found",
          "This ticket alert no longer exists.",
        );
      return { kind: "account", subscription: mapSubscription(rows[0]) };
    });
  }
  cancel(user: VerifiedIdentity, tmdbId: string): Promise<SubscriptionChange> {
    return this.asUser(user, async (tx) => {
      await tx
        .delete(ticketAlertSubscriptions)
        .where(
          and(
            eq(ticketAlertSubscriptions.userId, user.id),
            eq(ticketAlertSubscriptions.tmdbId, BigInt(tmdbId)),
          ),
        );
      return { kind: "account", subscription: null };
    });
  }
  correct(user: VerifiedIdentity, command: Correction) {
    return this.asUser(user, async (tx) => {
      if (!(await this.isAdmin(tx, user.id)))
        throw new HttpError(
          403,
          "forbidden",
          "Administrator access is required.",
        );
      const sourceId = Number(command.currentTmdbId),
        targetId = Number(command.selectedTmdbId);
      if (sourceId === targetId) return { changed: false };
      for (const id of [sourceId, targetId].sort((a, b) => a - b))
        await tx.execute(sql`select pg_advisory_xact_lock(${id})`);
      const nowPlaying = command.mode === "nowPlaying";
      const table = nowPlaying ? finalMovies : finalSoons;
      const sources = await tx
        .select()
        .from(table)
        .where(eq(table.tmdbId, sourceId))
        .limit(2)
        .for("update");
      const targets = await tx
        .select({ title: table.englishTitle })
        .from(table)
        .where(eq(table.tmdbId, targetId))
        .limit(2)
        .for("update");
      if (sources.length === 0)
        throw new HttpError(
          404,
          "movie_not_found",
          "The source movie no longer exists.",
        );
      if (sources.length > 1 || targets.length > 1)
        throw new HttpError(
          409,
          "ambiguous_movie",
          "Multiple coming-soon rows match this movie. Resolve the duplicate before correcting it.",
        );
      const title = stripEdgeDoubleQuotes(
        (command.selectedTitle?.trim() || targets[0]?.title || "").replace(
          /\s+/g,
          " ",
        ),
      ).trim();
      await tx.execute(
        sql`insert into ${tableFixes} ("tmdb_id", "title_fix") values (${String(targetId)}, ${String(sourceId)})`,
      );
      if (targets.length) {
        if (nowPlaying)
          await tx.delete(finalMovies).where(eq(finalMovies.tmdbId, sourceId));
        else
          await tx
            .delete(finalSoons)
            .where(
              eq(
                finalSoons.id,
                (sources[0] as typeof finalSoons.$inferSelect).id,
              ),
            );
      } else {
        const common = {
          tmdbId: targetId,
          soloUpdate: true,
          englishTitle: "",
          releaseYear: null,
          enPoster: "",
          backdrop: "",
          enTrailer: "",
          genres: [],
          runtime: null,
        };
        if (nowPlaying)
          await tx
            .update(finalMovies)
            .set({
              ...common,
              imdbId: null,
              imdbRating: null,
              imdbVotes: null,
              rtId: null,
              rtCriticRating: null,
              rtCriticVotes: null,
              rtAudienceRating: null,
              rtAudienceVotes: null,
              lbId: null,
              lbRating: null,
              lbVotes: null,
              tmdbRating: null,
              tmdbVotes: null,
              popularity: null,
            })
            .where(eq(finalMovies.tmdbId, sourceId));
        // release_date is NOT NULL: retain it while solo_update hides the row.
        else
          await tx
            .update(finalSoons)
            .set(common)
            .where(
              eq(
                finalSoons.id,
                (sources[0] as typeof finalSoons.$inferSelect).id,
              ),
            );
      }
      if (nowPlaying)
        await tx
          .update(finalShowtimes)
          .set({ tmdbId: targetId, englishTitle: title })
          .where(eq(finalShowtimes.tmdbId, sourceId));
      return { changed: true };
    });
  }

  walletTickets(user: VerifiedIdentity): Promise<WalletTicket[]> {
    return this.asUser(user, async (tx) => {
      const rows = await tx
        .select()
        .from(userWalletTickets)
        .where(eq(userWalletTickets.userId, user.id))
        .orderBy(
          asc(userWalletTickets.screeningDate),
          asc(userWalletTickets.screeningTime),
          asc(userWalletTickets.createdAt),
        )
        .limit(100);
      return rows.map(mapWalletTicket);
    });
  }

  walletTicketDetails(user: VerifiedIdentity): Promise<WalletTicketDetail[]> {
    return this.asUser(user, async (tx) => {
      const rows = await tx
        .select()
        .from(userWalletTickets)
        .where(eq(userWalletTickets.userId, user.id))
        .orderBy(
          asc(userWalletTickets.screeningDate),
          asc(userWalletTickets.screeningTime),
          asc(userWalletTickets.createdAt),
        )
        .limit(100);
      return rows.map(mapWalletTicketDetail);
    });
  }

  walletTicket(
    user: VerifiedIdentity,
    ticketId: string,
  ): Promise<WalletTicketDetail> {
    return this.asUser(user, async (tx) => {
      const [row] = await tx
        .select()
        .from(userWalletTickets)
        .where(
          and(
            eq(userWalletTickets.userId, user.id),
            eq(userWalletTickets.id, ticketId),
          ),
        )
        .limit(1);
      if (!row)
        throw new HttpError(404, "ticket_not_found", "Ticket not found.");
      return mapWalletTicketDetail(row);
    });
  }

  createWalletTicket(
    user: VerifiedIdentity,
    input: WalletTicketCreate,
  ): Promise<WalletTicket> {
    return this.asUser(user, async (tx) => {
      const existing = await tx
        .select({ id: userWalletTickets.id })
        .from(userWalletTickets)
        .where(eq(userWalletTickets.userId, user.id))
        .limit(100);
      if (existing.length >= 100)
        throw new HttpError(
          409,
          "ticket_limit",
          "You can save up to 100 tickets.",
        );
      const [row] = await tx
        .insert(userWalletTickets)
        .values({
          userId: user.id,
          tmdbId: input.tmdbId === null ? null : BigInt(input.tmdbId),
          title: input.title,
          city: input.city,
          cinema: input.cinema,
          screeningDate: input.screeningDate,
          screeningTime: input.screeningTime,
          qrMessage: input.qrMessage,
          reminderEnabled: input.reminderEnabled,
        })
        .returning();
      if (!row)
        throw new HttpError(
          503,
          "ticket_unavailable",
          "Ticket could not be saved. Please try again.",
        );
      await tx
        .delete(userWalletRecentShowtimeClicks)
        .where(eq(userWalletRecentShowtimeClicks.userId, user.id));
      return mapWalletTicket(row);
    });
  }

  updateWalletTicket(
    user: VerifiedIdentity,
    ticketId: string,
    input: WalletTicketPatch,
  ): Promise<WalletTicket> {
    return this.asUser(user, async (tx) => {
      const values = {
        ...(input.tmdbId === undefined
          ? {}
          : { tmdbId: input.tmdbId === null ? null : BigInt(input.tmdbId) }),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.city === undefined ? {} : { city: input.city }),
        ...(input.cinema === undefined ? {} : { cinema: input.cinema }),
        ...(input.screeningDate === undefined
          ? {}
          : { screeningDate: input.screeningDate }),
        ...(input.screeningTime === undefined
          ? {}
          : { screeningTime: input.screeningTime }),
        ...(input.qrMessage === undefined
          ? {}
          : { qrMessage: input.qrMessage }),
        ...(input.reminderEnabled === undefined
          ? {}
          : { reminderEnabled: input.reminderEnabled }),
        updatedAt: this.clock(),
      };
      const [row] = await tx
        .update(userWalletTickets)
        .set(values)
        .where(
          and(
            eq(userWalletTickets.userId, user.id),
            eq(userWalletTickets.id, ticketId),
          ),
        )
        .returning();
      if (!row)
        throw new HttpError(404, "ticket_not_found", "Ticket not found.");
      return mapWalletTicket(row);
    });
  }

  deleteWalletTicket(user: VerifiedIdentity, ticketId: string) {
    return this.asUser(user, async (tx) => {
      const removed = await tx
        .delete(userWalletTickets)
        .where(
          and(
            eq(userWalletTickets.userId, user.id),
            eq(userWalletTickets.id, ticketId),
          ),
        )
        .returning({ id: userWalletTickets.id });
      if (!removed.length)
        throw new HttpError(404, "ticket_not_found", "Ticket not found.");
      return { removed: true as const };
    });
  }

  walletListedScreenings(user: VerifiedIdentity, city: string, date: string) {
    const previousDate = addCalendarDays(date, -1) ?? date;
    return this.asUser(user, async (tx) => {
      const minute = sql`left(${finalShowtimes.showtime}::text, 5)`;
      const rows = await tx
        .selectDistinct({
          tmdbId: finalShowtimes.tmdbId,
          title: finalShowtimes.englishTitle,
          cinema: finalShowtimes.cinema,
          screeningCity: finalShowtimes.screeningCity,
          time: sql<string>`${minute}`.as("screening_minute"),
        })
        .from(finalShowtimes)
        .where(
          and(
            eq(finalShowtimes.screeningCity, city),
            or(
              and(
                eq(finalShowtimes.dateOfShowing, date),
                sql`${minute} >= '01:05'`,
              ),
              and(
                eq(finalShowtimes.dateOfShowing, previousDate),
                sql`${minute} < '01:05'`,
              ),
            ),
          ),
        )
        .orderBy(
          sql`screening_minute`,
          finalShowtimes.cinema,
          finalShowtimes.englishTitle,
        )
        .limit(250);
      return rows.flatMap((row) => {
        const title = row.title?.trim();
        if (
          !row.tmdbId ||
          !title ||
          title.length > 200 ||
          !row.cinema ||
          row.cinema.length > 200
        )
          return [];
        return [
          {
            tmdbId: String(row.tmdbId),
            title,
            cinema: row.cinema,
            city: row.screeningCity ?? city,
            screeningDate: date,
            screeningTime: row.time,
          },
        ];
      });
    });
  }

  recordWalletShowtimeClick(
    user: VerifiedIdentity,
    input: WalletTicketRecentClick,
    clientClickedAt?: string,
  ) {
    const receivedAt = this.clock();
    const submittedAt = clientClickedAt ? Date.parse(clientClickedAt) : NaN;
    const age = receivedAt.getTime() - submittedAt;
    const clickedAt =
      age >= -60_000 && age <= 24 * 60 * 60 * 1000
        ? new Date(Math.min(submittedAt, receivedAt.getTime()))
        : receivedAt;
    return this.asUser(user, async (tx) => {
      const candidates = await tx
        .select()
        .from(finalShowtimes)
        .where(
          and(
            eq(finalShowtimes.tmdbId, Number(input.tmdbId)),
            eq(finalShowtimes.dateOfShowing, input.screeningDate),
            sql`left(${finalShowtimes.showtime}::text, 5) = ${input.screeningTime}`,
            eq(finalShowtimes.screeningCity, input.city),
            eq(finalShowtimes.cinema, input.cinema),
          ),
        )
        .orderBy(desc(finalShowtimes.createdAt))
        .limit(1);
      const showtime = candidates[0];
      if (
        !showtime ||
        showtime.tmdbId === null ||
        !showtime.dateOfShowing ||
        !showtime.showtime ||
        !showtime.screeningCity ||
        !showtime.cinema
      )
        return null;
      const screeningTime = showtime.showtime.slice(0, 5);
      const screeningDate =
        screeningTime < "01:05"
          ? addCalendarDays(showtime.dateOfShowing, 1)
          : showtime.dateOfShowing;
      if (
        !screeningDate ||
        `${screeningDate}T${screeningTime}` < jerusalemLocalMinute(this.clock())
      )
        return null;
      const [row] = await tx
        .insert(userWalletRecentShowtimeClicks)
        .values({
          userId: user.id,
          tmdbId: BigInt(showtime.tmdbId),
          title: showtime.englishTitle?.trim() || input.title,
          city: showtime.screeningCity,
          cinema: showtime.cinema,
          screeningDate,
          screeningTime,
          clickedAt,
        })
        .onConflictDoUpdate({
          target: userWalletRecentShowtimeClicks.userId,
          setWhere: sql`${userWalletRecentShowtimeClicks.clickedAt} <= excluded.clicked_at`,
          set: {
            tmdbId: BigInt(showtime.tmdbId),
            title: showtime.englishTitle?.trim() || input.title,
            city: showtime.screeningCity,
            cinema: showtime.cinema,
            screeningDate,
            screeningTime,
            clickedAt,
          },
        })
        .returning();
      if (!row) return null;
      return {
        tmdbId: String(row.tmdbId),
        title: row.title,
        city: row.city,
        cinema: row.cinema,
        screeningDate: row.screeningDate,
        screeningTime: row.screeningTime.slice(0, 5),
      };
    });
  }

  recentWalletShowtimeClick(user: VerifiedIdentity) {
    return this.asUser(user, async (tx) => {
      const [row] = await tx
        .select()
        .from(userWalletRecentShowtimeClicks)
        .where(eq(userWalletRecentShowtimeClicks.userId, user.id))
        .limit(1);
      if (!row) return null;
      const now = this.clock();
      const clickExpired =
        now.getTime() - row.clickedAt.getTime() > 24 * 60 * 60 * 1000 ||
        row.clickedAt.getTime() > now.getTime() + 5 * 60 * 1000;
      if (clickExpired) {
        await tx
          .delete(userWalletRecentShowtimeClicks)
          .where(
            and(
              eq(userWalletRecentShowtimeClicks.userId, user.id),
              eq(userWalletRecentShowtimeClicks.clickedAt, row.clickedAt),
            ),
          );
        return null;
      }
      const screening = `${row.screeningDate}T${row.screeningTime.slice(0, 5)}`;
      if (screening < jerusalemLocalMinute(now)) {
        await tx
          .delete(userWalletRecentShowtimeClicks)
          .where(
            and(
              eq(userWalletRecentShowtimeClicks.userId, user.id),
              eq(userWalletRecentShowtimeClicks.clickedAt, row.clickedAt),
            ),
          );
        return null;
      }
      return {
        tmdbId: String(row.tmdbId),
        title: row.title,
        city: row.city,
        cinema: row.cinema,
        screeningDate: row.screeningDate,
        screeningTime: row.screeningTime.slice(0, 5),
      };
    });
  }
}
export type ProtectedWorkflowService = Pick<
  ProtectedWorkflows,
  | "account"
  | "preferences"
  | "patchPreferences"
  | "pushDeviceStatus"
  | "registerPushDevice"
  | "unregisterPushDevice"
  | "ticketAlertPreferences"
  | "patchTicketAlertPreferences"
  | "subscriptions"
  | "comingSoonDateWatches"
  | "watchComingSoonDate"
  | "unwatchComingSoonDate"
  | "movieDisplayPreferences"
  | "upsertMovieDisplayPreference"
  | "patchMovieDisplayPreference"
  | "removeMovieDisplayPreference"
  | "listLetterboxdSources"
  | "addLetterboxdSource"
  | "removeLetterboxdSource"
  | "walletTickets"
  | "walletTicketDetails"
  | "walletListedScreenings"
  | "walletTicket"
  | "createWalletTicket"
  | "updateWalletTicket"
  | "deleteWalletTicket"
  | "recordWalletShowtimeClick"
  | "recentWalletShowtimeClick"
  | "subscribe"
  | "cancel"
  | "updateTicketAlertCriteria"
  | "correct"
  | "homepageAdminData"
  | "upsertHomepageHighlight"
  | "removeHomepageHighlight"
  | "upsertHomepagePromotion"
>;
