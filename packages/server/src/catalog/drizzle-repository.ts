import { asc, eq, inArray, sql } from "drizzle-orm";
import type { ApplicationDatabase } from "../db/client.js";
import { finalMovies, movieCodes } from "../db/schema.js";
import { CatalogDatabaseError } from "./errors.js";
import type { CatalogRepository } from "./service.js";

const MOVIE_CODE_QUERY_CHUNK_SIZE = 500;

export class DrizzleCatalogRepository implements CatalogRepository {
  constructor(private readonly db: ApplicationDatabase) {}

  async findNowPlayingRows(): Promise<readonly unknown[]> {
    try {
      return await this.db
        .select({
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
        })
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

  async findMovieCodes(
    tmdbIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    try {
      const result = new Map<string, string>();
      if (tmdbIds.length === 0) {
        // Touch the relation even for an empty catalog so a missing codes table
        // remains a database failure instead of looking like a healthy result.
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
}
