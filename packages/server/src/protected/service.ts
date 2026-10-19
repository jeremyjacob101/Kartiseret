import { and, asc, desc, eq, sql } from "drizzle-orm";
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
  ticketAlertSubscriptions,
  finalMovies,
  finalSoons,
  finalShowtimes,
  tableFixes,
} from "../db/schema.js";
import type { PublicDataRepository } from "../public-data/repository.js";
import { getTicketAvailabilityShowtimes } from "../public-data/service.js";
import { HttpError } from "../http-errors.js";
import type { VerifiedIdentity } from "./identity.js";

const subscriptionColumns = {
  tmdbId: ticketAlertSubscriptions.tmdbId,
  createdAt: ticketAlertSubscriptions.createdAt,
  notifiedAt: ticketAlertSubscriptions.notifiedAt,
  deliveryTitle: ticketAlertSubscriptions.deliveryTitle,
  deliveryDate: ticketAlertSubscriptions.deliveryDate,
};
function mapSubscription(
  row:
    | typeof ticketAlertSubscriptions.$inferSelect
    | {
        tmdbId: bigint | string;
        createdAt: Date;
        notifiedAt: Date | null;
        deliveryTitle: string | null;
        deliveryDate: string | null;
      },
) {
  return {
    tmdbId: String(row.tmdbId),
    createdAt: row.createdAt.toISOString(),
    notifiedAt: row.notifiedAt?.toISOString() ?? null,
    deliveryTitle: row.deliveryTitle,
    deliveryDate: row.deliveryDate,
  };
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
      await tx.execute(
        sql`select set_config('request.jwt.claim.sub', ${user.id}, true)`,
      );
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
  async subscribe(
    user: VerifiedIdentity,
    tmdbId: string,
  ): Promise<SubscriptionChange> {
    const instant = this.clock();
    const showtimes = await getTicketAvailabilityShowtimes(
      this.publicRepository,
      tmdbId,
      getJerusalemCinemaDate(instant),
    );
    if (
      showtimes.some((row) =>
        shouldIncludeShowtime(row.dateOfShowing, row.showtime, instant),
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
      const insertedRows = await tx.execute<{
        tmdbId: string;
        createdAt: Date;
        notifiedAt: Date | null;
        deliveryTitle: string | null;
        deliveryDate: string | null;
      }>(sql`insert into ${ticketAlertSubscriptions} ("user_id", "tmdb_id")
        values (${user.id}, ${tmdbId}) on conflict ("user_id", "tmdb_id") do nothing
        returning tmdb_id::text as "tmdbId", created_at as "createdAt", notified_at as "notifiedAt", delivery_title as "deliveryTitle", delivery_date::text as "deliveryDate"`);
      const inserted = insertedRows.rows[0];
      const row =
        inserted ??
        (
          await tx
            .select(subscriptionColumns)
            .from(ticketAlertSubscriptions)
            .where(predicate)
        )[0];
      if (!row)
        throw new HttpError(
          409,
          "subscription_changed",
          "This alert changed concurrently. Please try again.",
        );
      return { kind: "account", subscription: mapSubscription(row) };
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
  | "subscriptions"
  | "subscribe"
  | "cancel"
  | "correct"
>;
