import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthClient } from "../src/lib/authClient";

vi.mock("../src/lib/authClient", () => ({ getAuthClient: vi.fn() }));

const fixtureUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "qa@example.test",
};

let notifySession: () => void;
let failSession: () => void;
let initializationRequests: number;
let row: Record<string, unknown> | null;
let pauseSaves: boolean;
let writes: Array<{
  body: Record<string, unknown>;
  prefer: string;
  finish: (fail?: boolean) => void;
}>;
let storeModule: typeof import("../src/stores/userPreferencesStore");

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(async () => {
  vi.resetModules();
  writes = [];
  initializationRequests = 0;
  pauseSaves = false;
  row = {
    user_id: "00000000-0000-4000-8000-000000000001",
    rating_sources: ["imdbRating"],
    location: "Jerusalem",
    site_color: "#a66ae3",
  };
  vi.stubGlobal("fetch", async (
    _input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const path = String(_input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    const output = () =>
      reply({
        data: {
          ratingSources: row?.rating_sources ?? [
            "imdbRating",
            "rtAudienceRating",
            "rtCriticRating",
          ],
          location: row?.location ?? "Haifa",
          siteColor: row?.site_color ?? "#a66ae3",
        },
        error: null,
      });
    if (path.endsWith("/initialize")) {
      initializationRequests += 1;
      if (!row)
        row = {
          user_id: fixtureUser.id,
          location: "Haifa",
          rating_sources: ["imdbRating", "rtAudienceRating", "rtCriticRating"],
          site_color: "#a66ae3",
        };
      return output();
    }
    return new Promise<Response>((resolve) => {
      const finish = (fail = false) => {
        if (!fail)
          for (const [key, value] of Object.entries(body))
            row = {
              ...row,
              [{
                ratingSources: "rating_sources",
                siteColor: "site_color",
                location: "location",
              }[key] ?? key]: value,
            };
        resolve(
          fail
            ? reply(
                {
                  data: null,
                  error: {
                    code: "save_failed",
                    message: "Fixture save failed",
                  },
                },
                403,
              )
            : output(),
        );
      };
      writes.push({ body, prefer: "", finish });
      if (!pauseSaves) finish();
    });
  });
  vi.mocked(getAuthClient).mockReturnValue({
    getSession: vi.fn(async () => ({
      data: { user: fixtureUser },
      error: null,
    })),
    useSession: {
      subscribe: (listener: (value: unknown) => void) => {
        notifySession = () =>
          listener({
            data: { user: fixtureUser },
            error: null,
            isPending: false,
          });
        failSession = () =>
          listener({
            data: null,
            error: { status: 503, message: "Auth temporarily unavailable" },
            isPending: false,
          });
        notifySession();
        return () => {};
      },
    },
  } as unknown as ReturnType<typeof getAuthClient>);
  storeModule = await import("../src/stores/userPreferencesStore");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function initialize() {
  storeModule.initializeUserPreferencesStore();
  await vi.waitFor(() =>
    expect(storeModule.useUserPreferencesStore.getState().loading).toBe(false));
}

describe("preference synchronization protocol", () => {
  it("initializes a verified account from server defaults without reviving the old Context owner", async () => {
    row = null;
    await initialize();
    expect(
      storeModule.useUserPreferencesStore.getState().preferences.location,
    ).toBe("Haifa");
    expect(writes).toHaveLength(0);
  });

  it("does not repeat initialization for same-account session refreshes", async () => {
    await initialize();
    notifySession();
    notifySession();
    await Promise.resolve();
    expect(initializationRequests).toBe(1);
    expect(row?.location).toBe("Jerusalem");
  });

  it("keeps a pending preference save alive across session refresh", async () => {
    await initialize();
    pauseSaves = true;
    await storeModule.useUserPreferencesStore
      .getState()
      .saveSiteColor("#123456");
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    notifySession();
    writes[0].finish();
    await vi.waitFor(() => expect(row?.site_color).toBe("#123456"));
    expect(initializationRequests).toBe(1);
    expect(
      storeModule.useUserPreferencesStore.getState().preferences.siteColor,
    ).toBe("#123456");
  });

  it("preserves identity and a pending save during a transient session outage", async () => {
    await initialize();
    pauseSaves = true;
    await storeModule.useUserPreferencesStore
      .getState()
      .saveSiteColor("#123456");
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    failSession();
    expect(storeModule.useUserPreferencesStore.getState().user).toEqual(
      fixtureUser,
    );
    expect(storeModule.useUserPreferencesStore.getState().error).toBe(
      "Auth temporarily unavailable",
    );
    writes[0].finish();
    await vi.waitFor(() => expect(row?.site_color).toBe("#123456"));
    notifySession();
    expect(initializationRequests).toBe(1);
    expect(
      storeModule.useUserPreferencesStore.getState().preferences.siteColor,
    ).toBe("#123456");
  });

  it("rolls back a failed optimistic save to the confirmed value", async () => {
    await initialize();
    pauseSaves = true;
    await storeModule.useUserPreferencesStore
      .getState()
      .saveSiteColor("#123456");
    expect(
      storeModule.useUserPreferencesStore.getState().preferences.siteColor,
    ).toBe("#123456");
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    writes[0].finish(true);
    await vi.waitFor(() =>
      expect(
        storeModule.useUserPreferencesStore.getState().preferences.siteColor,
      ).toBe("#a66ae3"));
    expect(storeModule.useUserPreferencesStore.getState().error).toBe(
      "Fixture save failed",
    );
  });

  it("coalesces rapid changes and does not roll back a newer queued value", async () => {
    await initialize();
    pauseSaves = true;
    const { saveSiteColor } = storeModule.useUserPreferencesStore.getState();
    await saveSiteColor("#111111");
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    await saveSiteColor("#222222");
    await saveSiteColor("#333333");
    writes[0].finish(true);
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    expect(
      storeModule.useUserPreferencesStore.getState().preferences.siteColor,
    ).toBe("#333333");
    expect(writes[1].body.siteColor).toBe("#333333");
    writes[1].finish();
    await vi.waitFor(() => expect(row?.site_color).toBe("#333333"));
    expect(writes).toHaveLength(2);
  });
});
