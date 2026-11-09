import { CINEMA_IDENTITIES, findCinemaIdentityForScreening } from "@kartiseret/contracts/cinema-identities";
import { isCinemathequeTheaterName } from "../../data/cinematheques";

export type TheaterTheme = {
  accent: string;
  surface: string;
  glow: string;
  pillBackground?: string;
  pillClassName?: string;
};

const theaterThemes: Record<string, TheaterTheme> = {
  "Yes Planet": {
    accent: "#d9710f",
    surface: "rgba(255, 154, 61, 0.12)",
    glow: "rgba(217, 113, 15, 0.28)",
    pillClassName: "details-time-pill--yes-planet",
  },
  "Cinema City": {
    accent: "#186bdf",
    surface: "rgba(94, 168, 255, 0.12)",
    glow: "rgba(24, 107, 223, 0.3)",
    pillClassName: "details-time-pill--cinema-city",
  },
  "Lev Cinema": {
    accent: "#b50519",
    surface: "rgba(255, 107, 107, 0.12)",
    glow: "rgba(181, 5, 25, 0.28)",
    pillClassName: "details-time-pill--lev-cinema",
  },
  "Rav Hen": {
    accent: "#ab5306",
    surface: "rgba(255, 177, 74, 0.14)",
    glow: "rgba(13, 6, 218, 0.32)",
    pillBackground:
      "linear-gradient(135deg, rgba(79, 146, 255, 0.22), rgba(255, 177, 74, 0.18))",
    pillClassName: "details-time-pill--rav-hen",
  },
  "Hot Cinema": {
    accent: "#f06a87",
    surface: "rgba(255, 79, 160, 0.14)",
    glow: "rgba(240, 106, 135, 0.32)",
    pillClassName: "details-time-pill--hot-cinema",
  },
  MovieLand: {
    accent: "#a80371",
    surface: "rgba(88, 0, 58, 0.12)",
    glow: "rgba(168, 3, 113, 0.3)",
    pillClassName: "details-time-pill--movieland",
  },
};

const fallbackTheaterThemes: TheaterTheme[] = [
  {
    accent: "#d29bff",
    surface: "rgba(210, 155, 255, 0.12)",
    glow: "rgba(210, 155, 255, 0.28)",
  },
  {
    accent: "#ffd166",
    surface: "rgba(255, 209, 102, 0.12)",
    glow: "rgba(255, 209, 102, 0.28)",
  },
  {
    accent: "#7bdff2",
    surface: "rgba(123, 223, 242, 0.12)",
    glow: "rgba(123, 223, 242, 0.28)",
  },
];

const cinemathequeAccents = ["#31a26d", "#76c99f", "#207047"] as const;

export function getTheaterTheme(
  theater: string,
  index: number,
  screeningCity?: string,
): TheaterTheme {
  if (isCinemathequeTheaterName(theater)) {
    const identity = screeningCity
      ? findCinemaIdentityForScreening(screeningCity, theater)
      : null;
    if (identity) {
      const venues = CINEMA_IDENTITIES.filter(
        (candidate) =>
          candidate.city === identity.city &&
          candidate.cinemaNameKeys.some(isCinemathequeTheaterName),
      ).sort((left, right) =>
        left.displayName.localeCompare(right.displayName));
      const venueIndex = Math.max(
        0,
        venues.findIndex((candidate) => candidate.id === identity.id),
      );
      const accent =
        cinemathequeAccents[
          Math.min(venueIndex, cinemathequeAccents.length - 1)
        ];
      return {
        accent,
        surface: `color-mix(in srgb, ${accent} 14%, transparent)`,
        glow: `color-mix(in srgb, ${accent} 28%, transparent)`,
        pillBackground: `linear-gradient(180deg, color-mix(in srgb, ${accent} 88%, white 12%), color-mix(in srgb, ${accent} 72%, black 28%))`,
      };
    }
    return {
      accent: cinemathequeAccents[0],
      surface: "rgba(49, 162, 109, 0.14)",
      glow: "rgba(49, 162, 109, 0.28)",
      pillBackground:
        "linear-gradient(180deg, color-mix(in srgb, #31a26d 88%, white 12%), color-mix(in srgb, #31a26d 72%, black 28%))",
    };
  }

  return (
    theaterThemes[theater] ??
    fallbackTheaterThemes[index % fallbackTheaterThemes.length]!
  );
}
