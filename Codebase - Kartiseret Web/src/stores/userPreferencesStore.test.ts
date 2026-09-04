import { createClient, type Session, type User } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseBrowserClient } from "../lib/supabase";

vi.mock("../lib/supabase", () => ({ getSupabaseBrowserClient: vi.fn() }));

const fixtureUser: User = {
  id: "user-a",
  aud: "authenticated",
  email: "qa@example.test",
  created_at: "2026-09-01T12:00:00Z",
  app_metadata: {},
  user_metadata: { signup_location: "Haifa" },
};

let row: Record<string, unknown> | null;
let pauseSaves: boolean;
let writes: Array<{
  body: Record<string, unknown>;
  prefer: string;
  finish: (fail?: boolean) => void;
}>;
let storeModule: typeof import("./userPreferencesStore");

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(async () => {
  vi.resetModules();
  writes = [];
  pauseSaves = false;
  row = {
    user_id: "user-a",
    rating_sources: ["imdbRating"],
    location: "Jerusalem",
    site_color: "#a66ae3",
  };
  const supabase = createClient("http://127.0.0.1:54321", "local-test-only", {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.method === "GET") {
          return reply(row ? [row] : []);
        }
        const body = (await request.json()) as Record<string, unknown>;
        const prefer = request.headers.get("prefer") ?? "";
        return new Promise<Response>((resolve) => {
          const finish = (fail = false) => {
            if (!fail && !(prefer.includes("ignore-duplicates") && row)) {
              row = { ...row, ...body };
            }
            resolve(
              fail
                ? reply({ message: "Fixture save failed" }, 403)
                : reply(null),
            );
          };
          writes.push({ body, prefer, finish });
          if (!pauseSaves) finish();
        });
      },
    },
  });
  vi.spyOn(supabase.auth, "getSession").mockResolvedValue({
    data: { session: { user: fixtureUser } as Session },
    error: null,
  });
  vi.spyOn(supabase.auth, "onAuthStateChange").mockImplementation(() => ({
    data: {
      subscription: { id: "local", callback: () => {}, unsubscribe: () => {} },
    },
  }));
  vi.mocked(getSupabaseBrowserClient).mockReturnValue(supabase);
  storeModule = await import("./userPreferencesStore");
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function initialize() {
  storeModule.initializeUserPreferencesStore();
  await vi.waitFor(() =>
    expect(storeModule.useUserPreferencesStore.getState().loading).toBe(false));
}

describe("preference synchronization protocol", () => {
  it("initializes confirmed-email signup using metadata without reviving the old Context owner", async () => {
    row = null;
    await initialize();
    expect(
      storeModule.useUserPreferencesStore.getState().preferences.location,
    ).toBe("Haifa");
    expect(writes).toHaveLength(1);
    expect(writes[0].prefer).toContain("resolution=ignore-duplicates");
  });

  it("does not overwrite an existing preference row from concurrent signup initialization", async () => {
    await initialize();
    await storeModule.persistSignupPreferenceDefaults("user-a", "Haifa", {
      onlyIfMissing: true,
    });
    expect(row?.location).toBe("Jerusalem");
  });

  it("preserves explicit instant-signup location initialization for trigger-created rows", async () => {
    await initialize();
    await storeModule.persistSignupPreferenceDefaults("user-a", "Haifa");
    expect(row?.location).toBe("Haifa");
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
    expect(writes[1].body.site_color).toBe("#333333");
    writes[1].finish();
    await vi.waitFor(() => expect(row?.site_color).toBe("#333333"));
    expect(writes).toHaveLength(2);
  });
});
