import { type Theater } from "./movies.js";

export type CinemaIdentity = {
  id: string;
  displayName: string;
  city: string;
  /** Current and legacy theater location keys; append keys without changing id. */
  locationKeys: readonly string[];
  /** Published showtime labels that unambiguously identify this venue. */
  cinemaNameKeys: readonly string[];
  /** Published screening-city labels; can differ from the canonical city. */
  screeningCityKeys: readonly string[];
};

/**
 * Verified against the public theater catalog and published screening labels.
 * IDs are permanent. When a provider location key changes, append its new key
 * to the existing record; never mint a replacement ID for the same venue.
 */
export const CINEMA_IDENTITIES: readonly CinemaIdentity[] = [
  {
    id: "fBSh_YN0e5Iz",
    displayName: "MovieLand Afula",
    city: "Afula",
    locationKeys: ["https://maps.app.goo.gl/Tv9VyFJtZra8iEri6"],
    cinemaNameKeys: ["MovieLand", "MovieLand Afula"],
    screeningCityKeys: ["Afula"],
  },
  {
    id: "-oRDvbhs4P9m",
    displayName: "Cinema City Ashdod",
    city: "Ashdod",
    locationKeys: ["https://maps.app.goo.gl/Cr1pvKjWX86CokXU8"],
    cinemaNameKeys: ["Cinema City", "Cinema City Ashdod"],
    screeningCityKeys: ["Ashdod"],
  },
  {
    id: "jNfU2c0SQZSQ",
    displayName: "Hot Cinema Ashdod",
    city: "Ashdod",
    locationKeys: ["https://maps.app.goo.gl/9KhdhiDcfyqeuAPu7"],
    cinemaNameKeys: ["Hot Cinema", "Hot Cinema Ashdod"],
    screeningCityKeys: ["Ashdod"],
  },
  {
    id: "UphVORpsdEI5",
    displayName: "Hot Cinema Ashkelon",
    city: "Ashkelon",
    locationKeys: ["https://maps.app.goo.gl/6si1n2s92FpvRfEe7"],
    cinemaNameKeys: ["Hot Cinema", "Hot Cinema Ashkelon"],
    screeningCityKeys: ["Ashkelon"],
  },
  {
    id: "zj5prOYm_yxg",
    displayName: "Yes Planet Ayalon",
    city: "Ayalon",
    locationKeys: ["https://maps.app.goo.gl/E2xot6XNKWXpR4kv6"],
    cinemaNameKeys: ["Yes Planet", "Yes Planet Ayalon"],
    screeningCityKeys: ["Ayalon"],
  },
  {
    id: "cvx_eANXN-lb",
    displayName: "MovieLand Bat Yam",
    city: "Bat Yam",
    locationKeys: [
      "https://www.google.com/maps/search/?api=1&query=MovieLand+Yoseftal+92+Bat+Yam+Israel",
    ],
    cinemaNameKeys: ["MovieLand", "MovieLand Bat Yam"],
    screeningCityKeys: ["Bat Yam"],
  },
  {
    id: "2_ZcNuqNdX-f",
    displayName: "Cinema City Beer Sheva",
    city: "Beer Sheva",
    locationKeys: ["https://maps.app.goo.gl/NtdqoKzfypRKiJTF7"],
    cinemaNameKeys: ["Cinema City", "Cinema City Beer Sheva"],
    screeningCityKeys: ["Beer Sheva"],
  },
  {
    id: "uzUWx8uJ1tCP",
    displayName: "Yes Planet Beer Sheva",
    city: "Beer Sheva",
    locationKeys: ["https://maps.app.goo.gl/uKL8zeEdRGocmNXHA"],
    cinemaNameKeys: ["Yes Planet", "Yes Planet Beer Sheva"],
    screeningCityKeys: ["Beer Sheva"],
  },
  {
    id: "hmt-BfTNfu1O",
    displayName: "Hot Cinema Carmiel",
    city: "Carmiel",
    locationKeys: ["https://maps.app.goo.gl/XPuzeSRndr1En9Tr6"],
    cinemaNameKeys: ["Hot Cinema", "Hot Cinema Carmiel"],
    screeningCityKeys: ["Carmiel"],
  },
  {
    id: "YT8ytn6TZV1K",
    displayName: "MovieLand Carmiel",
    city: "Carmiel",
    locationKeys: ["https://maps.app.goo.gl/2h22ZSXs1mPkd7hy8"],
    cinemaNameKeys: ["MovieLand", "MovieLand Carmiel"],
    screeningCityKeys: ["Carmiel"],
  },
  {
    id: "6uBaX_MrVCvT",
    displayName: "Cinema City Chadera",
    city: "Chadera",
    locationKeys: ["https://maps.app.goo.gl/dkRw1FLzP4Gha3rM9"],
    cinemaNameKeys: ["Cinema City", "Cinema City Chadera"],
    screeningCityKeys: ["Chadera"],
  },
  {
    id: "Obq7mmfK-3Xa",
    displayName: "Lev Cinema Even Yehuda",
    city: "Even Yehuda",
    locationKeys: ["https://maps.app.goo.gl/G5LAbDHUdCYgXNms5"],
    cinemaNameKeys: ["Lev Cinema", "Lev Cinema Even Yehuda"],
    screeningCityKeys: ["Even Yehuda"],
  },
  {
    id: "V2_hFHCDiE_i",
    displayName: "Rav Hen Givataim",
    city: "Givatayim",
    locationKeys: ["https://maps.app.goo.gl/1hecodAVyjwtiwbw5"],
    cinemaNameKeys: ["RavHen", "Rav Hen Givataim"],
    screeningCityKeys: ["Givatayim"],
  },
  {
    id: "ZEp31fLFHjho",
    displayName: "Cinema City Glilot",
    city: "Glilot",
    locationKeys: ["https://maps.app.goo.gl/EbU3r1TiphycaoXv8"],
    cinemaNameKeys: ["Cinema City", "Cinema City  Glilot"],
    screeningCityKeys: ["Glilot"],
  },
  {
    id: "0po4OAWhv7s2",
    displayName: "MovieLand Glilot",
    city: "Glilot",
    locationKeys: ["https://maps.app.goo.gl/ERzxDQbaawD96iWf6"],
    cinemaNameKeys: ["MovieLand", "MovieLand Glilot"],
    screeningCityKeys: ["Glilot"],
  },
  {
    id: "q3Vj5AtOuOLU",
    displayName: "Haifa Cinematheque",
    city: "Haifa",
    locationKeys: ["https://maps.app.goo.gl/DuDmLMQmXHUiEp7e9"],
    cinemaNameKeys: ["Cinematheque", "Haifa Cinematheque"],
    screeningCityKeys: ["Haifa"],
  },
  {
    id: "clpg_T_gxIOF",
    displayName: "Hot Cinema Haifa",
    city: "Haifa",
    locationKeys: ["https://maps.app.goo.gl/kkAbrKbMN1yA7MRY9"],
    cinemaNameKeys: ["Hot Cinema", "Hot Cinema Haifa"],
    screeningCityKeys: ["Haifa"],
  },
  {
    id: "WMKzo7Mqq7ZF",
    displayName: "MovieLand Haifa",
    city: "Haifa",
    locationKeys: ["https://maps.app.goo.gl/1evQ9zgAqmdVc4NB7"],
    cinemaNameKeys: ["MovieLand", "MovieLand Haifa"],
    screeningCityKeys: ["Haifa"],
  },
  {
    id: "_dmXnVsxLDU3",
    displayName: "Yes Planet Haifa",
    city: "Haifa",
    locationKeys: ["https://maps.app.goo.gl/PEFKwqcpQA3ZwUUb9"],
    cinemaNameKeys: ["Yes Planet", "Yes Planet Haifa"],
    screeningCityKeys: ["Haifa"],
  },
  {
    id: "IBhyipCv9ScW",
    displayName: "Herziliya Cinematheque",
    city: "Herziliya",
    locationKeys: ["https://maps.app.goo.gl/q2TRk1vL7PJX6P7Z8"],
    cinemaNameKeys: ["Cinematheque", "Herziliya Cinematheque"],
    screeningCityKeys: ["Herziliya"],
  },
  {
    id: "L0JKiAPfk7s5",
    displayName: "Lev Cinema Herziliya",
    city: "Herziliya",
    locationKeys: ["https://maps.app.goo.gl/CYkdccdmffPTHUPT6"],
    cinemaNameKeys: ["Lev Cinema", "Lev Cinema Herziliya"],
    screeningCityKeys: ["Herziliya"],
  },
  {
    id: "x-L3HMxyf2r2",
    displayName: "Holon Cinematheque",
    city: "Holon",
    locationKeys: ["https://maps.app.goo.gl/z7hrmMKRqGYzZadq5"],
    cinemaNameKeys: ["Cinematheque", "Holon Cinematheque"],
    screeningCityKeys: ["Holon"],
  },
  {
    id: "d_jSzOK7tFJ1",
    displayName: "Hot Cinema Holon",
    city: "Holon",
    locationKeys: ["https://maps.app.goo.gl/RGnLZ5oudKKbXt5x9"],
    cinemaNameKeys: ["Hot Cinema", "Hot Cinema Holon"],
    screeningCityKeys: ["Holon"],
  },
  {
    id: "aK90TvH244M7",
    displayName: "Cinema City Jerusalem",
    city: "Jerusalem",
    locationKeys: ["https://maps.app.goo.gl/gidzqRCQgrMaDphF7"],
    cinemaNameKeys: ["Cinema City", "Cinema City Jerusalem"],
    screeningCityKeys: ["Jerusalem"],
  },
  {
    id: "smBcm2HtRvQA",
    displayName: "Jerusalem Cinematheque",
    city: "Jerusalem",
    locationKeys: ["https://maps.app.goo.gl/jDuGeP2hZhQiWYbG7"],
    cinemaNameKeys: ["Cinematheque", "Jerusalem Cinematheque"],
    screeningCityKeys: ["Jerusalem"],
  },
  {
    id: "dhaXlZaYiePE",
    displayName: "Sam Spiegel Cinema",
    city: "Jerusalem",
    locationKeys: ["https://maps.app.goo.gl/PvZx7wUHSatubTMC9"],
    cinemaNameKeys: ["Cinematheque", "Sam Spiegel Cinema"],
    screeningCityKeys: ["Jerusalem"],
  },
  {
    id: "JtkKielHHLJ5",
    displayName: "Lev Cinema Jerusalem",
    city: "Jerusalem",
    locationKeys: ["https://maps.app.goo.gl/CYoVrBYbth9AWDAH6"],
    cinemaNameKeys: ["Lev Cinema", "Lev Cinema Jerusalem"],
    screeningCityKeys: ["Jerusalem"],
  },
  {
    id: "GlBNYtNRhpA6",
    displayName: "Yes Planet Jerusalem",
    city: "Jerusalem",
    locationKeys: ["https://maps.app.goo.gl/E5MNtJ5xPEFyyDPk7"],
    cinemaNameKeys: ["Yes Planet", "Yes Planet Jerusalem"],
    screeningCityKeys: ["Jerusalem"],
  },
  {
    id: "i2KtLj4lB8s9",
    displayName: "Cinema City Kfar Saba",
    city: "Kfar Saba",
    locationKeys: ["https://maps.app.goo.gl/7j59mis2efu4fjDm6"],
    cinemaNameKeys: ["Cinema City", "Cinema City Kfar Saba"],
    screeningCityKeys: ["Kfar Saba"],
  },
  {
    id: "lc625ND_8tDo",
    displayName: "Hot Cinema Kfar Saba",
    city: "Kfar Saba",
    locationKeys: ["https://maps.app.goo.gl/heei7VCvK51CPS8D6"],
    cinemaNameKeys: ["Hot Cinema", "Hot Cinema Kfar Saba"],
    screeningCityKeys: ["Kfar Saba"],
  },
  {
    id: "KpkFS_eZKZTz",
    displayName: "Hot Cinema Kiryat Bialik",
    city: "Kiryat Bialik",
    locationKeys: ["https://maps.app.goo.gl/dtep3CNfMRUd4G2B7"],
    cinemaNameKeys: ["Hot Cinema", "Hot Cinema Kiryat Bialik"],
    screeningCityKeys: ["Kiryat Bialik"],
  },
  {
    id: "CAxRnPHHZj-l",
    displayName: "Rav Hen Kiryat Ono",
    city: "Kiryat Ono",
    locationKeys: ["https://maps.app.goo.gl/xoJQ9ckj9S7U3o256"],
    cinemaNameKeys: ["RavHen", "Rav Hen Kiryat Ono"],
    screeningCityKeys: ["Kiryat Ono"],
  },
  {
    id: "jdNS6CrmxUUw",
    displayName: "Hot Cinema Modiin",
    city: "Modiin",
    locationKeys: ["https://maps.app.goo.gl/7i1MiFURQnWrUky1A"],
    cinemaNameKeys: ["Hot Cinema", "Hot Cinema Modiin"],
    screeningCityKeys: ["Modiin"],
  },
  {
    id: "pvNMEc4RdeCz",
    displayName: "Hot Cinema Nahariya",
    city: "Nahariya",
    locationKeys: ["https://maps.app.goo.gl/4R9XqnPu9RR9TDNR7"],
    cinemaNameKeys: ["Hot Cinema", "Hot Cinema Nahariya"],
    screeningCityKeys: ["Nahariya"],
  },
  {
    id: "3UsxFst2wQIs",
    displayName: "Cinema City Netanya",
    city: "Netanya",
    locationKeys: ["https://maps.app.goo.gl/Cc1cc41U8DAzLZNF6"],
    cinemaNameKeys: ["Cinema City", "Cinema City Netanya"],
    screeningCityKeys: ["Netanya"],
  },
  {
    id: "Q5Q2GZbsk2Zh",
    displayName: "MovieLand Netanya",
    city: "Netanya",
    locationKeys: ["https://maps.app.goo.gl/rg8BwksCH9cv5CrB6"],
    cinemaNameKeys: ["MovieLand", "MovieLand Netanya"],
    screeningCityKeys: ["Netanya"],
  },
  {
    id: "hYg3839rL7nl",
    displayName: "Lev Cinema Omer",
    city: "Omer",
    locationKeys: ["https://maps.app.goo.gl/wmeRyqeVuXDffUvV8"],
    cinemaNameKeys: ["Lev Cinema", "Lev Cinema Omer"],
    screeningCityKeys: ["Omer"],
  },
  {
    id: "W5GlbQyWvHH8",
    displayName: "Hot Cinema Petach Tikvah",
    city: "Petach Tikvah",
    locationKeys: ["https://maps.app.goo.gl/cbywX322mn4xRDt68"],
    cinemaNameKeys: ["Hot Cinema", "Hot Cinema Petach Tikvah"],
    screeningCityKeys: ["Petach Tikvah"],
  },
  {
    id: "RnXR1CzNZSKL",
    displayName: "Lev Cinema Raanana",
    city: "Raanana",
    locationKeys: ["https://maps.app.goo.gl/pkYGqMwRU5STEab99"],
    cinemaNameKeys: ["Lev Cinema", "Lev Cinema Raanana"],
    screeningCityKeys: ["Raanana"],
  },
  {
    id: "mo20eHzr8uQo",
    displayName: "Lev Cinema Ramat HaSharon",
    city: "Ramat Hasharon",
    locationKeys: ["https://maps.app.goo.gl/n1UJewZt4wCeYL8q6"],
    cinemaNameKeys: ["Lev Cinema", "Lev Cinema Ramat HaSharon"],
    screeningCityKeys: ["Ramat Hasharon"],
  },
  {
    id: "JuZMeFcpXX1W",
    displayName: "Hot Cinema Rehovot",
    city: "Rehovot",
    locationKeys: ["https://maps.app.goo.gl/mhPo8YA34TjUBSYH8"],
    cinemaNameKeys: ["Hot Cinema", "Hot Cinema Rehovot"],
    screeningCityKeys: ["Rehovot"],
  },
  {
    id: "yQCXIS0-fFHF",
    displayName: "Cinema City Rishon Letzion",
    city: "Rishon Letzion",
    locationKeys: ["https://maps.app.goo.gl/zMb4z32W2wUDRanm9"],
    cinemaNameKeys: ["Cinema City", "Cinema City Rishon Letzion"],
    screeningCityKeys: ["Rishon Letzion"],
  },
  {
    id: "8bV46WOz9LrX",
    displayName: "Yes Planet Rishon Letzion",
    city: "Rishon Letzion",
    locationKeys: ["https://maps.app.goo.gl/LCtTHFzkRyWAVTHx9"],
    cinemaNameKeys: ["Yes Planet", "Yes Planet Rishon Letzion"],
    screeningCityKeys: ["Rishon Letzion"],
  },
  {
    id: "Lv7nojZOm284",
    displayName: "Jaffa Cinema",
    city: "Tel Aviv",
    locationKeys: ["https://maps.app.goo.gl/NC7zB4GQzEP9dcG88"],
    cinemaNameKeys: ["Cinematheque", "Jaffa Cinema"],
    screeningCityKeys: ["Tel Aviv", "Jaffa"],
  },
  {
    id: "8CddAGtBwU-0",
    displayName: "Tel Aviv Cinematheque",
    city: "Tel Aviv",
    locationKeys: ["https://maps.app.goo.gl/CMjXe22MvFscPUtn9"],
    cinemaNameKeys: ["Cinematheque", "Tel Aviv Cinematheque"],
    screeningCityKeys: ["Tel Aviv"],
  },
  {
    id: "-C4tCRUL3CRU",
    displayName: "Lev Cinema Tel Aviv",
    city: "Tel Aviv",
    locationKeys: ["https://maps.app.goo.gl/EhdaZU8hTAc1BwSk8"],
    cinemaNameKeys: ["Lev Cinema", "Lev Cinema Tel Aviv"],
    screeningCityKeys: ["Tel Aviv"],
  },
  {
    id: "UpGBEyVZD81h",
    displayName: "Rav Hen Tel Aviv",
    city: "Tel Aviv",
    locationKeys: ["https://maps.app.goo.gl/MAuea1C9KZjXeWQx5"],
    cinemaNameKeys: ["RavHen", "Rav Hen Tel Aviv"],
    screeningCityKeys: ["Tel Aviv"],
  },
  {
    id: "vDDsjAP8cIuf",
    displayName: "Yes Planet Zichron Yaakov",
    city: "Zichron Yaakov",
    locationKeys: ["https://maps.app.goo.gl/j5adcdmcn3r7TQL76"],
    cinemaNameKeys: ["Yes Planet", "Yes Planet Zichron Yaakov"],
    screeningCityKeys: ["Zichron Yaakov"],
  },
];

function normalizeCinemaKey(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en");
}

export function getCinemaIdentityById(id: string): CinemaIdentity | null {
  return CINEMA_IDENTITIES.find((identity) => identity.id === id) ?? null;
}

export function getCinemaIdentityByLocation(
  location: string,
): CinemaIdentity | null {
  return (
    CINEMA_IDENTITIES.find((identity) =>
      identity.locationKeys.includes(location.trim()),
    ) ?? null
  );
}

export function cinemaIdForLocation(location: string): string | null {
  return getCinemaIdentityByLocation(location)?.id ?? null;
}

export function findTheaterByCinemaId(
  theaters: readonly Theater[],
  id: string,
): Theater | null {
  const identity = getCinemaIdentityById(id);
  if (!identity) return null;
  const matches = theaters.filter((theater) =>
    identity.locationKeys.includes(theater.location.trim()),
  );
  if (matches.length > 1)
    throw new Error("Cinema URL identity maps to multiple public theaters.");
  return matches[0] ?? null;
}

export function findCinemaIdentityForScreening(
  screeningCity: string,
  cinemaName: string,
): CinemaIdentity | null {
  const normalizedCity = normalizeCinemaKey(screeningCity);
  const normalizedName = normalizeCinemaKey(cinemaName);
  const matches = CINEMA_IDENTITIES.filter(
    (identity) =>
      identity.screeningCityKeys.some(
        (city) => normalizeCinemaKey(city) === normalizedCity,
      ) &&
      identity.cinemaNameKeys.some(
        (name) => normalizeCinemaKey(name) === normalizedName,
      ),
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}
