import { describe, expect, it } from "vitest";
import { getNowPlayingMovies, type CatalogRepository } from "./service.js";

function row(tmdbId: number, popularity: number | null) {
  return {
    tmdbId,
    englishTitle: `Film ${tmdbId}`,
    releaseYear: 2024n,
    genres: null,
    enPoster: null,
    backdrop: null,
    enTrailer: null,
    imdbId: null,
    rtId: null,
    imdbRating: null,
    imdbVotes: null,
    rtAudienceRating: null,
    rtAudienceVotes: null,
    rtCriticRating: null,
    rtCriticVotes: null,
    lbId: null,
    lbRating: null,
    lbVotes: null,
    tmdbRating: null,
    tmdbVotes: null,
    runtime: null,
    popularity,
    altOptions: [],
    soloUpdate: false,
  };
}

describe("catalog service ordering", () => {
  it("keeps NULL popularity after numeric values and orders ties by numeric movie ID", async () => {
    const repository: CatalogRepository = {
      findNowPlayingRows: async () => [
        row(9_100_001, null),
        row(10, 0),
        row(2, 0),
        row(1, 4),
      ],
      findMovieCodes: async () => new Map(),
    };

    const movies = await getNowPlayingMovies(repository);

    expect(movies.map((movie) => movie.tmdbId)).toEqual([
      "1",
      "2",
      "10",
      "9100001",
    ]);
  });
});
