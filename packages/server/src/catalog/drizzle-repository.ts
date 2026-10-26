import { timeCatalogStage } from "../catalog-timing.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { HttpError } from "../http-errors.js";
import { and, asc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type {
  ApplicationDatabase,
  ApplicationTransaction,
} from "../db/client.js";
import {
  cities,
  finalMovies,
  finalThequeMovies,
  finalTheques,
  finalShowtimes,
  finalSoons,
  movieReleaseDates,
  movieCodes,
  theaters,
} from "../db/schema.js";
import { CatalogDatabaseError } from "./errors.js";
import type { CatalogRepository } from "./service.js";
import type {
  PublicDataRepository,
  PublicShowtimeRange,
} from "../public-data/repository.js";

const MOVIE_CODE_QUERY_CHUNK_SIZE = 500;

const nowPlayingProjection = {
  tmdbId: finalMovies.tmdbId,
  englishTitle: finalMovies.englishTitle,
  releaseYear: finalMovies.releaseYear,
  genres: finalMovies.genres,
  enPoster: finalMovies.enPoster,
  backdrop: finalMovies.backdrop,
  enTrailer: finalMovies.enTrailer,
  imdbId: finalMovies.imdbId,
  rtId: finalMovies.rtId,
  imdbRating: finalMovies.imdbRating,
  imdbVotes: finalMovies.imdbVotes,
  rtAudienceRating: finalMovies.rtAudienceRating,
  rtAudienceVotes: finalMovies.rtAudienceVotes,
  rtCriticRating: finalMovies.rtCriticRating,
  rtCriticVotes: finalMovies.rtCriticVotes,
  lbId: finalMovies.lbId,
  lbRating: finalMovies.lbRating,
  lbVotes: finalMovies.lbVotes,
  tmdbRating: finalMovies.tmdbRating,
  tmdbVotes: finalMovies.tmdbVotes,
  runtime: finalMovies.runtime,
  popularity: finalMovies.popularity,
  altOptions: finalMovies.altOptions,
  soloUpdate: finalMovies.soloUpdate,
};

const comingSoonProjection = {
  tmdbId: finalSoons.tmdbId,
  englishTitle: finalSoons.englishTitle,
  releaseYear: finalSoons.releaseYear,
  releaseDate: finalSoons.releaseDate,
  genres: finalSoons.genres,
  enPoster: finalSoons.enPoster,
  backdrop: finalSoons.backdrop,
  enTrailer: finalSoons.enTrailer,
  runtime: finalSoons.runtime,
  popularity: finalSoons.popularity,
  altOptions: finalSoons.altOptions,
  soloUpdate: finalSoons.soloUpdate,
};

const showtimeProjection = {
  tmdbId: finalShowtimes.tmdbId,
  screeningCity: finalShowtimes.screeningCity,
  dateOfShowing: finalShowtimes.dateOfShowing,
  cinema: finalShowtimes.cinema,
  showtime: finalShowtimes.showtime,
  englishHref: finalShowtimes.englishHref,
  hebrewHref: finalShowtimes.hebrewHref,
  screeningTech: finalShowtimes.screeningTech,
  screeningType: finalShowtimes.screeningType,
  dubLanguage: finalShowtimes.dubLanguage,
};

const cinemathequeMovieProjection = {
  tmdbId: finalThequeMovies.tmdbId,
  englishTitle: finalThequeMovies.englishTitle,
  releaseYear: finalThequeMovies.releaseYear,
  genres: finalThequeMovies.genres,
  enPoster: finalThequeMovies.enPoster,
  backdrop: finalThequeMovies.backdrop,
  enTrailer: finalThequeMovies.enTrailer,
  imdbId: finalThequeMovies.imdbId,
  rtId: finalThequeMovies.rtId,
  imdbRating: finalThequeMovies.imdbRating,
  imdbVotes: sql<string | null>`${finalThequeMovies.imdbVotes}::text`,
  rtAudienceRating: finalThequeMovies.rtAudienceRating,
  rtAudienceVotes: sql<
    string | null
  >`${finalThequeMovies.rtAudienceVotes}::text`,
  rtCriticRating: finalThequeMovies.rtCriticRating,
  rtCriticVotes: sql<string | null>`${finalThequeMovies.rtCriticVotes}::text`,
  lbId: finalThequeMovies.lbId,
  lbRating: finalThequeMovies.lbRating,
  lbVotes: sql<string | null>`${finalThequeMovies.lbVotes}::text`,
  tmdbRating: finalThequeMovies.tmdbRating,
  tmdbVotes: sql<string | null>`${finalThequeMovies.tmdbVotes}::text`,
  runtime: finalThequeMovies.runtime,
  popularity: finalThequeMovies.popularity,
  altOptions: finalThequeMovies.altOptions,
  soloUpdate: finalThequeMovies.soloUpdate,
};

const cinemathequeShowtimeProjection = {
  tmdbId: finalTheques.tmdbId,
  screeningCity: finalTheques.screeningCity,
  dateOfShowing: finalTheques.dateOfShowing,
  cinema: finalTheques.cinema,
  showtime: finalTheques.showtime,
  englishHref: finalTheques.englishHref,
  hebrewHref: finalTheques.hebrewHref,
  screeningTech: finalTheques.screeningTech,
  screeningType: finalTheques.screeningType,
  dubLanguage: finalTheques.dubLanguage,
};

export class DrizzleCatalogRepository
  implements CatalogRepository, PublicDataRepository
{
  private readonly snapshots = new AsyncLocalStorage<{
    db: ApplicationTransaction;
    revision: string;
  }>();

  constructor(private readonly rootDb: ApplicationDatabase) {}

  private get db() {
    return this.snapshots.getStore()?.db ?? this.rootDb;
  }

  async readSnapshot<T>(
    read: (revision: string) => Promise<T>,
    expected?: string,
  ): Promise<T> {
    const active = this.snapshots.getStore();
    if (active) {
      if (expected !== undefined && expected !== active.revision)
        throw new HttpError(
          409,
          "publication_changed",
          "Published data changed. Reload the catalog.",
        );
      return read(active.revision);
    }
    return timeCatalogStage("snapshot", () =>
      this.rootDb.transaction(
        async (tx) => {
          const result = await timeCatalogStage("revision_read", () =>
            tx.execute<{ revision: string }>(
              sql`select revision::text from public.pipeline_catalog_revision where singleton`,
            ),
          );
          const revision = result.rows[0]?.revision;
          if (revision === undefined)
            throw new Error("Publication revision is unavailable.");
          if (expected !== undefined && expected !== revision)
            throw new HttpError(
              409,
              "publication_changed",
              "Published data changed. Reload the catalog.",
            );
          return this.snapshots.run({ db: tx, revision }, () => read(revision));
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      ),
    );
  }

  async findNowPlayingRows(): Promise<readonly unknown[]> {
    try {
      const futureShowtimeCounts = this.db
        .select({
          tmdbId: finalShowtimes.tmdbId,
          showtimeCount: sql<number>`count(*)::int`.as("showtime_count"),
        })
        .from(finalShowtimes)
        .where(
          and(
            isNotNull(finalShowtimes.tmdbId),
            gte(
              finalShowtimes.dateOfShowing,
              sql`(now() AT TIME ZONE 'Asia/Jerusalem')::date`,
            ),
          ),
        )
        .groupBy(finalShowtimes.tmdbId)
        .as("future_showtime_counts");

      return await this.db
        .select({
          ...nowPlayingProjection,
          localReleaseDate: movieReleaseDates.localReleaseDate,
          showtimeCount: sql<number>`coalesce(${futureShowtimeCounts.showtimeCount}, 0)::int`,
        })
        .from(finalMovies)
        .leftJoin(
          movieReleaseDates,
          eq(finalMovies.tmdbId, movieReleaseDates.tmdbId),
        )
        .leftJoin(
          futureShowtimeCounts,
          eq(finalMovies.tmdbId, futureShowtimeCounts.tmdbId),
        )
        .where(eq(finalMovies.soloUpdate, false))
        .orderBy(asc(finalMovies.tmdbId));
    } catch (error) {
      throw new CatalogDatabaseError(error);
    }
  }

  async findComingSoonRows(): Promise<readonly unknown[]> {
    try {
      return await this.db
        .select(comingSoonProjection)
        .from(finalSoons)
        .where(eq(finalSoons.soloUpdate, false))
        .orderBy(
          asc(finalSoons.releaseDate),
          sql`${finalSoons.popularity} DESC NULLS LAST`,
          asc(finalSoons.englishTitle),
          asc(finalSoons.tmdbId),
          asc(finalSoons.id),
        );
    } catch (error) {
      throw new CatalogDatabaseError(error);
    }
  }

  async findMovieCodes(
    tmdbIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    try {
      const result = new Map<string, string>();
      if (tmdbIds.length === 0) {
        // Touch the relation even for an empty catalog so a missing codes table
        // remains detectable by the code-readiness result.
        await this.db
          .select({ tmdbId: movieCodes.tmdbId })
          .from(movieCodes)
          .limit(1);
        return result;
      }

      for (
        let offset = 0;
        offset < tmdbIds.length;
        offset += MOVIE_CODE_QUERY_CHUNK_SIZE
      ) {
        const chunk = tmdbIds.slice(
          offset,
          offset + MOVIE_CODE_QUERY_CHUNK_SIZE,
        );
        const records = await this.db
          .select({
            tmdbId: movieCodes.tmdbId,
            movieCode: movieCodes.movieCode,
          })
          .from(movieCodes)
          .where(
            inArray(
              movieCodes.tmdbId,
              chunk.map((id) => BigInt(id)),
            ),
          );
        for (const record of records) {
          result.set(record.tmdbId.toString(), record.movieCode);
        }
      }
      return result;
    } catch (error) {
      throw new CatalogDatabaseError(error);
    }
  }

  async findShowtimeRows(
    range: PublicShowtimeRange,
  ): Promise<readonly unknown[]> {
    try {
      const conditions = [
        eq(finalShowtimes.screeningCity, range.city),
        gte(finalShowtimes.dateOfShowing, range.startDate),
        lte(finalShowtimes.dateOfShowing, range.endDate),
      ];
      if (range.tmdbId) {
        conditions.push(eq(finalShowtimes.tmdbId, Number(range.tmdbId)));
      }

      return await this.db
        .select(showtimeProjection)
        .from(finalShowtimes)
        .where(and(...conditions))
        .orderBy(
          asc(finalShowtimes.tmdbId),
          asc(finalShowtimes.dateOfShowing),
          asc(finalShowtimes.cinema),
          asc(finalShowtimes.showtime),
          asc(finalShowtimes.screeningTech),
          asc(finalShowtimes.screeningType),
          asc(finalShowtimes.dubLanguage),
          asc(finalShowtimes.id),
        );
    } catch (error) {
      throw new CatalogDatabaseError(error);
    }
  }

  async findCinemathequeRows(
    range: PublicShowtimeRange,
  ): Promise<readonly unknown[]> {
    try {
      const conditions = [
        eq(finalTheques.screeningCity, range.city),
        gte(finalTheques.dateOfShowing, range.startDate),
        lte(finalTheques.dateOfShowing, range.endDate),
        eq(finalThequeMovies.soloUpdate, false),
      ];
      if (range.tmdbId) {
        conditions.push(eq(finalTheques.tmdbId, Number(range.tmdbId)));
      }

      return await this.db
        .select({
          movie: cinemathequeMovieProjection,
          showtime: cinemathequeShowtimeProjection,
        })
        .from(finalTheques)
        .innerJoin(
          finalThequeMovies,
          eq(finalTheques.tmdbId, finalThequeMovies.tmdbId),
        )
        .where(and(...conditions))
        .orderBy(
          asc(finalTheques.dateOfShowing),
          asc(finalTheques.tmdbId),
          asc(finalTheques.cinema),
          asc(finalTheques.showtime),
          asc(finalTheques.screeningTech),
          asc(finalTheques.screeningType),
          asc(finalTheques.dubLanguage),
          asc(finalTheques.id),
        );
    } catch (error) {
      throw new CatalogDatabaseError(error);
    }
  }

  async findTicketAvailabilityRows(
    tmdbId: string,
    fromDate: string,
  ): Promise<readonly unknown[]> {
    try {
      return await this.db
        .select(showtimeProjection)
        .from(finalShowtimes)
        .where(
          and(
            eq(finalShowtimes.tmdbId, Number(tmdbId)),
            gte(finalShowtimes.dateOfShowing, fromDate),
          ),
        )
        .orderBy(
          asc(finalShowtimes.dateOfShowing),
          asc(finalShowtimes.showtime),
          asc(finalShowtimes.screeningCity),
          asc(finalShowtimes.cinema),
          asc(finalShowtimes.id),
        );
    } catch (error) {
      throw new CatalogDatabaseError(error);
    }
  }

  async findTheaterCityRows(): Promise<readonly unknown[]> {
    try {
      return await this.db
        .select({
          chain: theaters.chain,
          address: theaters.address,
          location: theaters.location,
          theaterName: theaters.theaterName,
          theaterLatitude: theaters.latitude,
          theaterLongitude: theaters.longitude,
          cityName: cities.name,
          altSpellings: cities.altSpellings,
          cityLatitude: cities.latitude,
          cityLongitude: cities.longitude,
          zoomLayer: cities.zoomLayer,
          neighboringCities: cities.neighboringCities,
        })
        .from(theaters)
        .fullJoin(cities, eq(theaters.cityName, cities.name))
        .orderBy(
          asc(cities.name),
          asc(theaters.chain),
          asc(theaters.address),
          asc(theaters.location),
        );
    } catch (error) {
      throw new CatalogDatabaseError(error);
    }
  }

  async findMovieCodeByCode(movieCode: string): Promise<string | null> {
    try {
      const result = await this.db
        .select({ tmdbId: movieCodes.tmdbId })
        .from(movieCodes)
        .where(eq(movieCodes.movieCode, movieCode))
        .limit(1);
      return result[0]?.tmdbId.toString() ?? null;
    } catch (error) {
      throw new CatalogDatabaseError(error);
    }
  }

  async findNowPlayingMovieById(tmdbId: string): Promise<unknown | null> {
    try {
      const result = await this.db
        .select(nowPlayingProjection)
        .from(finalMovies)
        .where(
          and(
            eq(finalMovies.tmdbId, Number(tmdbId)),
            eq(finalMovies.soloUpdate, false),
          ),
        )
        .limit(1);
      return result[0] ?? null;
    } catch (error) {
      throw new CatalogDatabaseError(error);
    }
  }

  async findComingSoonMovieById(tmdbId: string): Promise<unknown | null> {
    try {
      const result = await this.db
        .select(comingSoonProjection)
        .from(finalSoons)
        .where(
          and(
            eq(finalSoons.tmdbId, Number(tmdbId)),
            eq(finalSoons.soloUpdate, false),
          ),
        )
        .orderBy(
          asc(finalSoons.releaseDate),
          sql`${finalSoons.popularity} DESC NULLS LAST`,
          asc(finalSoons.id),
        )
        .limit(1);
      return result[0] ?? null;
    } catch (error) {
      throw new CatalogDatabaseError(error);
    }
  }

  async findComingSoonMoviesByIds(
    tmdbIds: readonly string[],
  ): Promise<readonly unknown[]> {
    const ids = [...new Set(tmdbIds)]
      .map(Number)
      .filter(
        (id) => Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647,
      );
    if (ids.length === 0) return [];
    try {
      return await this.db
        .select(comingSoonProjection)
        .from(finalSoons)
        .where(
          and(
            inArray(finalSoons.tmdbId, ids),
            eq(finalSoons.soloUpdate, false),
          ),
        )
        .orderBy(
          asc(finalSoons.releaseDate),
          sql`${finalSoons.popularity} DESC NULLS LAST`,
          asc(finalSoons.id),
        );
    } catch (error) {
      throw new CatalogDatabaseError(error);
    }
  }
}
