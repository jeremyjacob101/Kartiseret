import { getSupabaseBrowserClient } from "../lib/supabase";

type TheaterCoordinates = {
  lat: number;
  lng: number;
};

type TheaterRow = {
  city: string | null;
  chain: string | null;
  address: string | null;
  location: string;
};

export type Theater = {
  city: string;
  chain: string;
  address: string;
  location: string;
  lat: number | null;
  lng: number | null;
};

const THEATERS_TABLE_NAME = "theaters";
const THEATER_SELECT_COLUMNS = ["city", "chain", "address", "location"].join(
  ", ",
);
const THEATER_COORDINATES: Record<string, TheaterCoordinates> = {
  "https://maps.app.goo.gl/EbU3r1TiphycaoXv8": { lat: 32.1463519, lng: 34.8040703 },
  "https://maps.app.goo.gl/zMb4z32W2wUDRanm9": { lat: 31.983365, lng: 34.7711627 },
  "https://maps.app.goo.gl/7j59mis2efu4fjDm6": { lat: 32.1725768, lng: 34.9285753 },
  "https://maps.app.goo.gl/Cc1cc41U8DAzLZNF6": { lat: 32.2910915, lng: 34.8618352 },
  "https://maps.app.goo.gl/dkRw1FLzP4Gha3rM9": { lat: 32.4408863, lng: 34.9314663 },
  "https://maps.app.goo.gl/NtdqoKzfypRKiJTF7": { lat: 31.2341947, lng: 34.7988127 },
  "https://maps.app.goo.gl/Cr1pvKjWX86CokXU8": { lat: 31.7764198, lng: 34.6615785 },
  "https://maps.app.goo.gl/gidzqRCQgrMaDphF7": { lat: 31.7827738, lng: 35.2036842 },
  "https://maps.app.goo.gl/dtep3CNfMRUd4G2B7": { lat: 32.8425836, lng: 35.0892991 },
  "https://maps.app.goo.gl/4R9XqnPu9RR9TDNR7": { lat: 32.9902315, lng: 35.0953788 },
  "https://maps.app.goo.gl/heei7VCvK51CPS8D6": { lat: 32.1653, lng: 34.9251711 },
  "https://maps.app.goo.gl/mhPo8YA34TjUBSYH8": { lat: 31.894216, lng: 34.8054321 },
  "https://maps.app.goo.gl/XPuzeSRndr1En9Tr6": { lat: 32.928029, lng: 35.3245461 },
  "https://maps.app.goo.gl/kkAbrKbMN1yA7MRY9": { lat: 32.7897693, lng: 35.0054326 },
  "https://maps.app.goo.gl/6si1n2s92FpvRfEe7": { lat: 31.6812215, lng: 34.5541732 },
  "https://maps.app.goo.gl/7i1MiFURQnWrUky1A": { lat: 31.8890274, lng: 34.9608994 },
  "https://maps.app.goo.gl/9KhdhiDcfyqeuAPu7": { lat: 31.7925139, lng: 34.6385467 },
  "https://maps.app.goo.gl/cbywX322mn4xRDt68": { lat: 32.092624, lng: 34.8624362 },
  "https://maps.app.goo.gl/wmeRyqeVuXDffUvV8": { lat: 31.2632483, lng: 34.8450557 },
  "https://maps.app.goo.gl/CYkdccdmffPTHUPT6": { lat: 32.1714865, lng: 34.7980362 },
  "https://maps.app.goo.gl/G5LAbDHUdCYgXNms5": { lat: 32.2692212, lng: 34.8881042 },
  "https://maps.app.goo.gl/CYoVrBYbth9AWDAH6": { lat: 31.764885, lng: 35.2195951 },
  "https://maps.app.goo.gl/pkYGqMwRU5STEab99": { lat: 32.1840745, lng: 34.850619 },
  "https://maps.app.goo.gl/EhdaZU8hTAc1BwSk8": { lat: 32.0748279, lng: 34.7730087 },
  "https://maps.app.goo.gl/n1UJewZt4wCeYL8q6": { lat: 32.1492228, lng: 34.8371367 },
  "https://maps.app.goo.gl/1evQ9zgAqmdVc4NB7": { lat: 32.789399, lng: 34.9613717 },
  "https://maps.app.goo.gl/2h22ZSXs1mPkd7hy8": { lat: 32.9218842, lng: 35.3053689 },
  "https://maps.app.goo.gl/rg8BwksCH9cv5CrB6": { lat: 32.2812249, lng: 34.8594451 },
  "https://maps.app.goo.gl/ERzxDQbaawD96iWf6": { lat: 32.1434378, lng: 34.7907497 },
  "https://maps.app.goo.gl/MAuea1C9KZjXeWQx5": { lat: 32.0781952, lng: 34.7710339 },
  "https://maps.app.goo.gl/xoJQ9ckj9S7U3o256": { lat: 32.0555788, lng: 34.860797 },
  "https://maps.app.goo.gl/1hecodAVyjwtiwbw5": { lat: 32.0662451, lng: 34.8081969 },
  "https://maps.app.goo.gl/j5adcdmcn3r7TQL76": { lat: 32.5692875, lng: 34.9335079 },
  "https://maps.app.goo.gl/E2xot6XNKWXpR4kv6": { lat: 32.0994106, lng: 34.8246616 },
  "https://maps.app.goo.gl/uKL8zeEdRGocmNXHA": { lat: 31.2243853, lng: 34.8010901 },
  "https://maps.app.goo.gl/PEFKwqcpQA3ZwUUb9": { lat: 32.7936601, lng: 35.0382705 },
  "https://maps.app.goo.gl/E5MNtJ5xPEFyyDPk7": { lat: 31.7623049, lng: 35.2256754 },
  "https://maps.app.goo.gl/LCtTHFzkRyWAVTHx9": { lat: 31.9796641, lng: 34.7475896 },
};

let cachedTheaters: Theater[] | null = null;
let loadTheatersPromise: Promise<Theater[]> | null = null;

function normalizeText(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function compareTheaters(left: Theater, right: Theater): number {
  const cityComparison = left.city.localeCompare(right.city);

  if (cityComparison !== 0) {
    return cityComparison;
  }

  const chainComparison = left.chain.localeCompare(right.chain);

  if (chainComparison !== 0) {
    return chainComparison;
  }

  return left.address.localeCompare(right.address);
}

function mapRowToTheater(row: TheaterRow): Theater {
  const location = normalizeText(row.location);
  const coordinates = THEATER_COORDINATES[location];

  return {
    city: normalizeText(row.city),
    chain: normalizeText(row.chain),
    address: normalizeText(row.address),
    location,
    lat: coordinates?.lat ?? null,
    lng: coordinates?.lng ?? null,
  };
}

export async function loadTheaters(): Promise<Theater[]> {
  if (cachedTheaters) {
    return cachedTheaters;
  }

  if (loadTheatersPromise) {
    return loadTheatersPromise;
  }

  loadTheatersPromise = (async () => {
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase
        .from(THEATERS_TABLE_NAME)
        .select(THEATER_SELECT_COLUMNS);

      if (error) {
        throw error;
      }

      const nextTheaters = ((data ?? []) as unknown as TheaterRow[])
        .map(mapRowToTheater)
        .sort(compareTheaters);

      cachedTheaters = nextTheaters;

      return nextTheaters;
    } finally {
      loadTheatersPromise = null;
    }
  })();

  return loadTheatersPromise;
}
