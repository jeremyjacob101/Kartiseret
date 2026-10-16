import type { CatalogRepository } from "../catalog/service.js";

export type PublicShowtimeRange = {
  city: string;
  startDate: string;
  endDate: string;
  tmdbId?: string;
};

export interface PublicDataRepository extends CatalogRepository {
  findComingSoonRows(): Promise<readonly unknown[]>;
  findShowtimeRows(range: PublicShowtimeRange): Promise<readonly unknown[]>;
  findTicketAvailabilityRows(
    tmdbId: string,
    fromDate: string,
  ): Promise<readonly unknown[]>;
  findTheaterCityRows(): Promise<readonly unknown[]>;
  findMovieCodeByCode(movieCode: string): Promise<string | null>;
  findNowPlayingMovieById(tmdbId: string): Promise<unknown | null>;
  findComingSoonMovieById(tmdbId: string): Promise<unknown | null>;
}
