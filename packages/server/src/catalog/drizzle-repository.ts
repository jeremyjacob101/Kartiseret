import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { ApplicationDatabase } from "../db/client.js";
import {
  cities,
  finalMovies,
  finalShowtimes,
  finalSoons,
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

export class DrizzleCatalogRepository
  implements CatalogRepository, PublicDataRepository
{
  constructor(private readonly db: ApplicationDatabase) {}

  async findNowPlayingRows(): Promise<readonly unknown[]> {
    try {
      return await this.db
        .select(nowPlayingProjection)
        .from(finalMovies)
        .where(eq(finalMovies.soloUpdate, false))
        .orderBy(
          sql`${finalMovies.popularity} DESC NULLS LAST`,
          asc(finalMovies.tmdbId),
        );
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
}
