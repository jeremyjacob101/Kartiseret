import { CINEMA_IDENTITIES, cinemaIdForLocation, findCinemaIdentityForScreening, findTheaterByCinemaId } from "@kartiseret/contracts/cinema-identities";
import type { Theater } from "@kartiseret/contracts/movies";
import { describe, expect, it } from "vitest";

function theater(name: string, city: string, location: string): Theater {
  return {
    city: {
      name: city,
      altSpellings: [city],
      latitude: 31,
      longitude: 35,
      zoomLayer: 10,
      neighboringCities: [],
    },
    chain: "Cinema Chain",
    address: "1 Main Street",
    theaterName: name,
    location,
    lat: 31,
    lng: 35,
  };
}

describe("cinema URL identities", () => {
  it("keeps checked-in ids stable across display-name and address changes", () => {
    const identity = CINEMA_IDENTITIES.find(
      (entry) => entry.displayName === "Cinema City Jerusalem",
    )!;
    const location = identity.locationKeys[0]!;
    const id = identity.id;
    expect(id).toHaveLength(12);
    expect(cinemaIdForLocation(location)).toBe(id);
    const renamed = theater("Renamed Cinema", identity.city, location);
    expect(findTheaterByCinemaId([renamed], id)?.theaterName).toBe(
      "Renamed Cinema",
    );
  });

  it("matches same-chain venues by published city and excludes ambiguity", () => {
    const ashDod = CINEMA_IDENTITIES.find(
      (entry) => entry.displayName === "Cinema City Ashdod",
    )!;
    const beerSheva = CINEMA_IDENTITIES.find(
      (entry) => entry.displayName === "Cinema City Beer Sheva",
    )!;
    const firstId = ashDod.id;
    const secondId = beerSheva.id;
    expect(firstId).not.toBe(secondId);
    expect(findCinemaIdentityForScreening("Ashdod", "Cinema City")?.id).toBe(
      firstId,
    );
    expect(
      findCinemaIdentityForScreening("Beer Sheva", "Cinema City")?.id,
    ).toBe(secondId);
    expect(findCinemaIdentityForScreening("Jerusalem", "Cinematheque")).toBe(
      null,
    );
    expect(
      findCinemaIdentityForScreening("Jerusalem", "Jerusalem Cinematheque")?.id,
    ).toBe(
      CINEMA_IDENTITIES.find(
        (entry) => entry.displayName === "Jerusalem Cinematheque",
      )?.id,
    );
  });

  it("maps the Jaffa screening-city alias to its verified Tel Aviv theater", () => {
    const jaffa = CINEMA_IDENTITIES.find(
      (entry) => entry.displayName === "Jaffa Cinema",
    )!;
    expect(jaffa.city).toBe("Tel Aviv");
    expect(findCinemaIdentityForScreening("Jaffa", "Jaffa Cinema")?.id).toBe(
      jaffa.id,
    );
    expect(cinemaIdForLocation("unverified-location")).toBeNull();
  });
});
