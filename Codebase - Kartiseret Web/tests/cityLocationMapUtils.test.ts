import { describe, expect, it } from "vitest";
import { CITY_OPACITY_BASE, CITY_OPACITY_STEP, buildBounds, buildCityEntries, buildCityRevealConfig, chooseTheaterPopupAnchor, cityMatchesSearchQuery, estimateCityBubbleSize, getAutoTheaterPopupAnchor, getCityLabelOpacity, getDistanceMeters, getNearestCityLocation, getSecondaryCityCollisionPadding, normalizeCitySearchQuery, normalizeTheaterChain, parsePixelValue, rectanglesOverlap, styleCityLabel, styleSecondaryCityLabel, styleTheaterDot } from "../src/components/maps/cityLocationMapUtils";
import type { Theater } from "../src/data/theaters";

function theater(
  city: string,
  chain: string,
  latitude: number,
  longitude: number,
  altSpellings = [city],
): Theater {
  return {
    city: {
      name: city,
      altSpellings,
      latitude,
      longitude,
      zoomLayer: 9.5,
      neighboringCities: [],
    },
    chain,
    address: `${city} address`,
    theaterName: `${chain} ${city}`,
    location: `https://${city.toLowerCase()}.example.test`,
    lat: latitude,
    lng: longitude,
  };
}

describe("city map geometry and accessibility helpers", () => {
  it("normalizes search and chain labels and builds stable city entries", () => {
    const entries = buildCityEntries([
      theater("Tel Aviv", "RavHen", 32.08, 34.78, ["Tel Aviv", "  Tel-Aviv "]),
      theater("Jerusalem", "Cinematheque", 31.77, 35.21),
      theater("Tel Aviv", "Movie Land", 32.08, 34.78),
    ]);

    expect(entries.map((entry) => entry.location)).toEqual([
      "Jerusalem",
      "Tel Aviv",
    ]);
    expect(entries[1]).toMatchObject({
      theaterCount: 2,
      chains: ["Movie Land", "RavHen"],
    });
    expect(normalizeCitySearchQuery("  Tel   Aviv ")).toBe("tel aviv");
    expect(cityMatchesSearchQuery("telav", ["tel aviv"])).toBe(true);
    expect(cityMatchesSearchQuery("haifa", ["tel aviv"])).toBe(false);
    expect(normalizeTheaterChain("movie land")).toBe("MovieLand");
    expect(normalizeTheaterChain("Cinematheque Tel Aviv")).toBe("Cinematheque");
    expect(normalizeTheaterChain("Independent")).toBe("Independent");
  });

  it("keeps geographic math and bounds predictable", () => {
    const bounds = buildBounds([
      [34.7, 31.7],
      [35.2, 32.1],
    ]);
    expect(bounds?.getWest()).toBe(34.7);
    expect(bounds?.getEast()).toBe(35.2);
    expect(buildBounds([])).toBeNull();
    expect(getDistanceMeters([34.78, 32.08], [34.78, 32.08])).toBe(0);
    expect(
      getNearestCityLocation(
        [34.79, 32.08],
        [
          {
            location: "Tel Aviv",
            center: [34.78, 32.08],
            labelCenter: [34.78, 32.08],
            searchTerms: [],
            theaterCount: 1,
            chains: [],
            zoomLayer: 9,
          },
          {
            location: "Jerusalem",
            center: [35.21, 31.77],
            labelCenter: [35.21, 31.77],
            searchTerms: [],
            theaterCount: 1,
            chains: [],
            zoomLayer: 9,
          },
        ],
      ),
    ).toBe("Tel Aviv");
  });

  it("calculates reveal opacity and responsive collision padding", () => {
    const entries = [
      {
        location: "A",
        center: [0, 0] as [number, number],
        labelCenter: [0, 0] as [number, number],
        searchTerms: [],
        theaterCount: 1,
        chains: [],
        zoomLayer: 9,
      },
      {
        location: "B",
        center: [0, 0] as [number, number],
        labelCenter: [0, 0] as [number, number],
        searchTerms: [],
        theaterCount: 2,
        chains: [],
        zoomLayer: 10,
      },
    ];
    const config = buildCityRevealConfig(entries);

    expect(config.fallbackRevealZoom).toBe(10);
    expect(getCityLabelOpacity(8, 9, false, config)).toBe(CITY_OPACITY_BASE);
    expect(getCityLabelOpacity(9.5, 10, false, config)).toBe(
      CITY_OPACITY_BASE + CITY_OPACITY_STEP,
    );
    expect(getCityLabelOpacity(1, 10, true, config)).toBe(1);
    expect(getSecondaryCityCollisionPadding(9)).toEqual({ x: 20, y: 12 });
    expect(getSecondaryCityCollisionPadding(10)).toEqual({ x: 16, y: 10 });
    expect(getSecondaryCityCollisionPadding(11)).toEqual({ x: 12, y: 8 });
    expect(
      getAutoTheaterPopupAnchor(
        { x: 10, y: 10 },
        { width: 100, height: 80 },
        500,
        500,
      ),
    ).toBe("top-left");
    expect(estimateCityBubbleSize("Jerusalem", false).height).toBe(42);
  });

  it("applies marker state without leaving stale accessibility or pointer state", () => {
    const city = document.createElement("button");
    const surface = document.createElement("span");
    styleCityLabel(city, surface, {
      active: true,
      syncing: false,
      opacity: 0.5,
      interactive: true,
      zIndex: "100",
    });
    expect(city).toHaveClass("is-active");
    expect(city).toHaveAttribute("aria-pressed", "true");
    expect(city.tabIndex).toBe(0);
    expect(surface.style.opacity).toBe("0.5");

    styleSecondaryCityLabel(surface, false);
    expect(surface).toHaveAttribute("aria-hidden", "true");
    expect(surface.style.visibility).toBe("hidden");
    styleTheaterDot(city, true, true);
    expect(city).toHaveClass("is-visible", "is-hovered");
    expect(city.style.zIndex).toBe("1400");
    expect(parsePixelValue("320px")).toBe(320);
  });

  it("scores non-overlap and selects an alternate popup anchor around obstacles", () => {
    expect(
      rectanglesOverlap(
        { left: 0, right: 10, top: 0, bottom: 10 },
        { left: 11, right: 20, top: 0, bottom: 10 },
      ),
    ).toBe(false);
    expect(
      rectanglesOverlap(
        { left: 0, right: 10, top: 0, bottom: 10 },
        { left: 5, right: 20, top: 5, bottom: 20 },
      ),
    ).toBe(true);

    const container = document.createElement("div");
    const current = document.createElement("button");
    current.dataset.lng = "34.78";
    current.dataset.lat = "32.08";
    const map = {
      getContainer: () => container,
      project: () => ({ x: 10, y: 100 }),
    } as never;
    Object.defineProperty(container, "clientWidth", { value: 400 });
    Object.defineProperty(container, "clientHeight", { value: 300 });
    Object.defineProperty(container, "getBoundingClientRect", {
      value: () => new DOMRect(0, 0, 400, 300),
    });

    expect(
      chooseTheaterPopupAnchor({
        address: "A long address",
        currentElement: current,
        labelElements: new Map(),
        map,
        secondaryLabelElements: [],
        theaterMarkers: [],
        title: "Cinema",
      }),
    ).toBeUndefined();
  });
});
