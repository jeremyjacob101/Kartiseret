import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  DEFAULT_LOCATION,
  DEFAULT_RATING_SOURCES,
  DEFAULT_SITE_COLOR,
  normalizeLocation,
  normalizeRatingSources,
  normalizeSiteColor,
} from "@kartiseret/contracts/preferences";
import type {
  Correction,
  PreferencePatch,
  Preferences,
  SubscriptionChange,
  TicketAlertCriteria,
  TicketAlertCriteriaOverride,
  ComingSoonDateWatch,
  ComingSoonDateWatchChange,
  LetterboxdSource,
} from "@kartiseret/contracts/private-data";
import {
  DEFAULT_TICKET_ALERT_CRITERIA,
  matchesTicketAlertCriteria,
} from "@kartiseret/contracts/private-data";
import { getJerusalemCinemaDate } from "@kartiseret/contracts/showtime-links";
import { shouldIncludeShowtime } from "@kartiseret/contracts/showtime-day";
import type {
  ApplicationDatabase,
  ApplicationTransaction,
} from "../db/client.js";
import {
  adminUsers,
  userPreferences,
  ticketAlertPreferences,
  ticketAlertSubscriptions,
  comingSoonDateWatches,
  letterboxdSources,
  finalMovies,
  finalSoons,
  finalShowtimes,
  tableFixes,
} from "../db/schema.js";
import type { PublicDataRepository } from "../public-data/repository.js";
import { getTicketAvailabilityShowtimes } from "../public-data/service.js";
import { HttpError } from "../http-errors.js";
import type { VerifiedIdentity } from "./identity.js";
import { parseLetterboxdSourceUrl } from "./letterboxd-source-url.js";

const subscriptionColumns = {
  tmdbId: ticketAlertSubscriptions.tmdbId,
  createdAt: ticketAlertSubscriptions.createdAt,
  notifiedAt: ticketAlertSubscriptions.notifiedAt,
  deliveryTitle: ticketAlertSubscriptions.deliveryTitle,
  deliveryDate: ticketAlertSubscriptions.deliveryDate,
  criteriaOverrides: ticketAlertSubscriptions.criteriaOverrides,
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
      },
) {
  return {
    tmdbId: String(row.tmdbId),
    createdAt: row.createdAt.toISOString(),
    notifiedAt: row.notifiedAt?.toISOString() ?? null,
    deliveryTitle: row.deliveryTitle,
    deliveryDate: row.deliveryDate,
    criteriaOverrides: row.criteriaOverrides ?? {},
  };
}

function mapTicketAlertPreferences(row?: {
  cities: string[] | null;
  filterExclusions: TicketAlertCriteria["filters"];
}): TicketAlertCriteria {
  return row
    ? {
        cities: row.cities as TicketAlertCriteria["cities"],
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
        signupInitialized: true,
      })
      .onConflictDoNothing({ target: userPreferences.userId });
    const [row] = await tx
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, user.id))
      .for("update");
    if (!row) throw new Error("Preference initialization returned no row.");
    const result = {
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
    };
    const repair =
      !row.signupInitialized || !row.location?.trim() || !row.siteColor?.trim();
    if (repair)
      await tx
        .update(userPreferences)
        .set({
          location: result.location,
          siteColor: result.siteColor,
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
  ticketAlertPreferences(user: VerifiedIdentity) {
    return this.asUser(user, async (tx) => {
      const [row] = await tx
        .select({
          cities: ticketAlertPreferences.cities,
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
          filterExclusions: criteria.filters,
          updatedAt: this.clock(),
        })
        .onConflictDoUpdate({
          target: ticketAlertPreferences.userId,
          set: {
            cities: criteria.cities,
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
    const defaults = await this.ticketAlertPreferences(user);
    const showtimes = await getTicketAvailabilityShowtimes(
      this.publicRepository,
      tmdbId,
      getJerusalemCinemaDate(instant),
    );
    if (
      showtimes.some(
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
      await tx.execute(sql`insert into ${ticketAlertSubscriptions} ("user_id", "tmdb_id")
        values (${user.id}, ${tmdbId}) on conflict ("user_id", "tmdb_id") do nothing`);
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
      const title = (command.selectedTitle?.trim() || targets[0]?.title || "")
        .replace(/\s+/g, " ")
        .replace(/^"+|"+$/g, "")
        .trim();
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
}
export type ProtectedWorkflowService = Pick<
  ProtectedWorkflows,
  | "account"
  | "preferences"
  | "patchPreferences"
  | "ticketAlertPreferences"
  | "patchTicketAlertPreferences"
  | "subscriptions"
  | "comingSoonDateWatches"
  | "watchComingSoonDate"
  | "unwatchComingSoonDate"
  | "listLetterboxdSources"
  | "addLetterboxdSource"
  | "removeLetterboxdSource"
  | "subscribe"
  | "cancel"
  | "updateTicketAlertCriteria"
  | "correct"
>;
