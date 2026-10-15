import type { CatalogRepository } from "./service.js";
import { CatalogDatabaseError } from "./errors.js";
import type { PrismaClient } from "../generated/prisma/client.js";

const MOVIE_CODE_QUERY_CHUNK_SIZE = 500;

export class PrismaCatalogRepository implements CatalogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findNowPlayingRows(): Promise<readonly unknown[]> {
    try {
      return await this.prisma.finalMovie.findMany({
        where: { soloUpdate: false },
        orderBy: [
          { popularity: { sort: "desc", nulls: "last" } },
          { tmdbId: "asc" },
        ],
        select: {
          tmdbId: true,
          englishTitle: true,
          releaseYear: true,
          genres: true,
          enPoster: true,
          backdrop: true,
          enTrailer: true,
          imdbId: true,
          rtId: true,
          imdbRating: true,
          imdbVotes: true,
          rtAudienceRating: true,
          rtAudienceVotes: true,
          rtCriticRating: true,
          rtCriticVotes: true,
          lbId: true,
          lbRating: true,
          lbVotes: true,
          tmdbRating: true,
          tmdbVotes: true,
          runtime: true,
          popularity: true,
          altOptions: true,
          soloUpdate: true,
        },
      });
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
        // is reported as a database failure, not disguised as a healthy empty list.
        await this.prisma.movieCode.findFirst({ select: { tmdbId: true } });
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
        const records = await this.prisma.movieCode.findMany({
          where: { tmdbId: { in: chunk.map((id) => BigInt(id)) } },
          select: { tmdbId: true, movieCode: true },
        });
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
