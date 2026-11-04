export {
  cinemaIdForLocation,
  findCinemaIdentityForScreening,
  findTheaterByCinemaId,
  getCinemaIdentityById,
  getCinemaIdentityByLocation,
  type CinemaIdentity,
} from "@kartiseret/contracts/cinema-identities";

export function normalizeCinemaName(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en");
}
