import { LetterboxdSourceWatchlist } from "../src/components/LetterboxdSourceWatchlist";
import type { LetterboxdSource } from "../src/data/letterboxdSources";
import { render, screen, waitFor } from "@testing-library/react";
import { privateIdentityChanged } from "../src/data/privateApi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../src/lib/queryClient";
import userEvent from "@testing-library/user-event";

const userId = "00000000-0000-4000-8000-000000000001";
const source: LetterboxdSource = {
  id: "00000000-0000-4000-8000-000000000101",
  sourceUrl: "https://letterboxd.com/fixture/watchlist/",
  sourceType: "watchlist" as const,
  createdAt: "2026-10-21T10:00:00.000Z",
  lastSyncAttemptAt: "2026-10-21T10:00:00.000Z",
  lastSuccessfulSyncAt: "2026-10-21T10:01:00.000Z",
  lastSyncError: null,
  filmCount: 124,
  matchedFilmCount: 87,
};

vi.mock("../src/lib/authClient", () => ({
  getAuthClient: () => ({
    getSession: async () => ({ data: { user: { id: userId } }, error: null }),
  }),
}));

function response(data: unknown) {
  return Response.json({ data, error: null });
}

function setup() {
  let sources: LetterboxdSource[] = [{ ...source }];
  const fetchMock = vi.fn(async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = new URL(String(input), "http://localhost");
    expect(new Headers(init?.headers).get("X-Kartiseret-Account-Id")).toBe(
      userId,
    );
    if (
      url.pathname === "/api/v1/letterboxd-sources" &&
      (!init?.method || init.method === "GET")
    )
      return response({ sources });
    if (
      url.pathname === "/api/v1/letterboxd-sources" &&
      init?.method === "POST"
    ) {
      const inputBody = JSON.parse(String(init.body)) as {
        sourceUrl: string;
      };
      const added = {
        ...source,
        id: "00000000-0000-4000-8000-000000000102",
        sourceUrl: inputBody.sourceUrl,
        sourceType: "list" as const,
        lastSyncAttemptAt: null,
        lastSuccessfulSyncAt: null,
        filmCount: 0,
        matchedFilmCount: 0,
      };
      sources = [...sources, added];
      return response({ source: added });
    }
    if (url.pathname.endsWith(`/${source.id}`) && init?.method === "DELETE") {
      sources = sources.filter((item) => item.id !== source.id);
      return response({ removed: true });
    }
    throw new Error(`Unexpected API request: ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const view = render(
    <QueryClientProvider client={queryClient}>
      <LetterboxdSourceWatchlist userId={userId} />
    </QueryClientProvider>,
  );
  return { ...view, fetchMock };
}

beforeEach(() => {
  queryClient.clear();
  privateIdentityChanged(userId);
  vi.restoreAllMocks();
});

describe("LetterboxdSourceWatchlist", () => {
  it("lists sync status and adds a public source through the protected API", async () => {
    const user = userEvent.setup();
    const { fetchMock } = setup();

    expect(
      await screen.findByText(
        "Synced Oct 21, 2026 · 87 films match cinema data",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("124 films in source")).toBeInTheDocument();

    await user.type(
      screen.getByLabelText("Public Letterboxd URL"),
      "https://letterboxd.com/fixture/list/favorites/",
    );
    await user.click(screen.getByRole("button", { name: "Track source" }));

    expect(
      await screen.findByRole("link", {
        name: /List.*fixture\/list\/favorites/,
      }),
    ).toBeInTheDocument();
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([, init]) => init?.method === "POST",
      );
      expect(post).toBeDefined();
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({
        sourceUrl: "https://letterboxd.com/fixture/list/favorites/",
      });
    });
    expect(
      screen.getByText(
        "First sync pending · current films will be added silently",
      ),
    ).toBeInTheDocument();
  });

  it("removes a source from the signed-in account", async () => {
    const user = userEvent.setup();
    const { fetchMock } = setup();

    await user.click(
      await screen.findByRole("button", {
        name: `Remove Letterboxd source ${source.sourceUrl}`,
      }),
    );

    expect(
      await screen.findByText("You are not tracking any sources yet."),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith(`/api/v1/letterboxd-sources/${source.id}`) &&
          init?.method === "DELETE",
      ),
    ).toBe(true);
  });
});
