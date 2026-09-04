import { describe, expect, it } from "vitest";
import { DEFAULT_LOCATION } from "./definitions/locations";
import { DEFAULT_RATING_SOURCES } from "./definitions/ratingSources";
import { buildInitialPreferencesRow } from "./initialPreferences";

describe("confirmed signup preference initialization", () => {
  it("uses signup metadata before guest storage, then falls back to the default", () => {
    expect(
      buildInitialPreferencesRow("user-a", " Haifa ", "Tel Aviv").location,
    ).toBe("Haifa");
    expect(
      buildInitialPreferencesRow("user-a", null, "Tel Aviv").location,
    ).toBe("Tel Aviv");
    expect(buildInitialPreferencesRow("user-a", "", null).location).toBe(
      DEFAULT_LOCATION,
    );
  });

  it("creates independent default arrays and preserves the user's identity", () => {
    const row = buildInitialPreferencesRow("user-a", null, null);
    expect(row.user_id).toBe("user-a");
    expect(row.rating_sources).toEqual(DEFAULT_RATING_SOURCES);
    expect(row.rating_sources).not.toBe(DEFAULT_RATING_SOURCES);
  });
});
