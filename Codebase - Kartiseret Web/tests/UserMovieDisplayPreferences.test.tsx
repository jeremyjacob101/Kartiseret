import { UserMovieDisplayPreferences } from "../src/components/UserMovieDisplayPreferences";
import type { MovieDisplayPreference } from "../src/data/movieDisplayPreferences";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { privateIdentityChanged } from "../src/data/privateApi";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../src/lib/queryClient";
import userEvent from "@testing-library/user-event";

const userId = "00000000-0000-4000-8000-000000000001";
const tmdbId = "9100300";
const preferences: MovieDisplayPreference[] = [];
let failNextSave = false;

vi.mock("../src/lib/authClient", () => ({
  getAuthClient: () => ({
    getSession: async () => ({ data: { user: { id: userId } }, error: null }),
  }),
}));

function response(data: unknown, status = 200) {
  return Response.json({ data, error: null }, { status });
}

function mockFetch(
  pages: Record<
    string,
    { preferences: MovieDisplayPreference[]; nextCursor: string | null }
  > = {},
) {
  const fetchMock = vi.fn(async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/v1/tmdb/search") {
      return response({
        titles: [
          {
            tmdbId,
            title: "Sensitive Film",
            releaseYear: 2026,
            posterPath: "/source-art.jpg",
            comingSoonDate: null,
          },
        ],
      });
    }
    if (
      url.pathname === "/api/v1/preferences/movie-display" &&
      (!init?.method || init.method === "GET")
    ) {
      const cursor = url.searchParams.get("after") ?? "";
      return response(
        pages[cursor] ?? { preferences: [...preferences], nextCursor: null },
      );
    }
    if (
      url.pathname === "/api/v1/preferences/movie-display" &&
      init?.method === "POST"
    ) {
      if (failNextSave) {
        failNextSave = false;
        return Response.json(
          {
            data: null,
            error: {
              code: "save_failed",
              message: "Could not save this movie preference.",
            },
          },
          { status: 503 },
        );
      }
      const value = JSON.parse(String(init.body)) as MovieDisplayPreference;
      const existingIndex = preferences.findIndex(
        (preference) => preference.tmdbId === value.tmdbId,
      );
      if (existingIndex >= 0) preferences[existingIndex] = value;
      else preferences.push(value);
      return response({ preference: value });
    }
    if (
      url.pathname.startsWith("/api/v1/preferences/movie-display/") &&
      init?.method === "PATCH"
    ) {
      const id = url.pathname.split("/").at(-1);
      const index = preferences.findIndex(
        (preference) => preference.tmdbId === id,
      );
      if (index < 0) return response({ error: "not found" }, 404);
      const patch = JSON.parse(
        String(init.body),
      ) as Partial<MovieDisplayPreference>;
      preferences[index] = { ...preferences[index]!, ...patch };
      return response({ preference: preferences[index] });
    }
    if (
      url.pathname.startsWith("/api/v1/preferences/movie-display/") &&
      init?.method === "DELETE"
    ) {
      const id = url.pathname.split("/").at(-1);
      const index = preferences.findIndex(
        (preference) => preference.tmdbId === id,
      );
      if (index >= 0) preferences.splice(index, 1);
      return response({ removed: true });
    }
    throw new Error(`Unexpected API request: ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPreferences() {
  return render(
    <QueryClientProvider client={queryClient}>
      <UserMovieDisplayPreferences userId={userId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  queryClient.clear();
  privateIdentityChanged(userId);
  preferences.splice(0, preferences.length);
  failNextSave = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UserMovieDisplayPreferences", () => {
  it("loads later pages so preferences beyond the first batch still apply", async () => {
    const firstPagePreference: MovieDisplayPreference = {
      tmdbId: "9100200",
      title: "First Page Film",
      releaseYear: 2025,
      treatment: "remove",
      hideBackdrop: true,
    };
    const secondPagePreference: MovieDisplayPreference = {
      tmdbId: "9100201",
      title: "Second Page Film",
      releaseYear: 2026,
      treatment: "standard",
      hideBackdrop: true,
    };
    const fetchMock = mockFetch({
      "": {
        preferences: [firstPagePreference],
        nextCursor: firstPagePreference.tmdbId,
      },
      [firstPagePreference.tmdbId]: {
        preferences: [secondPagePreference],
        nextCursor: null,
      },
    });
    renderPreferences();

    expect(
      await screen.findByText("First Page Film (2025)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Second Page Film (2026)")).toBeInTheDocument();
    const preferenceReads = fetchMock.mock.calls.filter(
      ([url, init]) =>
        new URL(String(url), "http://localhost").pathname ===
          "/api/v1/preferences/movie-display" &&
        (!init?.method || init.method === "GET"),
    );
    expect(preferenceReads).toHaveLength(2);
    expect(String(preferenceReads[1]?.[0])).toContain(
      `after=${firstPagePreference.tmdbId}`,
    );
  });

  it("shows text-only search results, requires a treatment choice, and hides backdrops by default", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch();
    renderPreferences();

    await user.type(screen.getByLabelText("Search movie titles"), "Sensitive");
    const results = await screen.findByRole("list", {
      name: "TMDb search results",
    });
    expect(
      within(results).getByText("Sensitive Film (2026)"),
    ).toBeInTheDocument();
    expect(within(results).queryByRole("img")).not.toBeInTheDocument();
    expect(
      within(results).getByRole("button", { name: "Use Kartiseret poster" }),
    ).toBeInTheDocument();
    expect(
      within(results).getByRole("button", { name: "Hide movie" }),
    ).toBeInTheDocument();
    expect(within(results).queryByRole("radio")).not.toBeInTheDocument();

    await user.click(
      within(results).getByRole("button", { name: "Use Kartiseret poster" }),
    );
    const backdropToggle = await screen.findByLabelText(
      "Hide backdrop on movie details",
    );
    expect(backdropToggle).toBeChecked();
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith("/preferences/movie-display") &&
          init?.method === "POST",
      );
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({
        tmdbId,
        title: "Sensitive Film",
        releaseYear: 2026,
        treatment: "standard",
        hideBackdrop: true,
      });
    });

    await user.click(backdropToggle);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith(`/preferences/movie-display/${tmdbId}`) &&
          init?.method === "PATCH",
      );
      expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
        hideBackdrop: false,
      });
    });
  });

  it("changes treatment and removes a saved preference", async () => {
    const user = userEvent.setup();
    preferences.push({
      tmdbId,
      title: "Sensitive Film",
      releaseYear: 2026,
      treatment: "remove",
      hideBackdrop: true,
    });
    const fetchMock = mockFetch();
    renderPreferences();

    const standardButton = await screen.findByRole("button", {
      name: "Kartiseret poster",
    });
    await user.click(standardButton);
    await waitFor(() =>
      expect(standardButton).toHaveAttribute("aria-pressed", "true"));
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith(`/preferences/movie-display/${tmdbId}`) &&
          init?.method === "PATCH" &&
          JSON.parse(String(init.body)).treatment === "standard",
      ),
    ).toBe(true);

    await user.click(
      screen.getByRole("button", {
        name: "Remove display preference for Sensitive Film",
      }),
    );
    expect(
      await screen.findByText("You have not set any movie display choices."),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith(`/preferences/movie-display/${tmdbId}`) &&
          init?.method === "DELETE",
      ),
    ).toBe(true);
  });

  it("shows a clear error when saving fails", async () => {
    const user = userEvent.setup();
    failNextSave = true;
    mockFetch();
    renderPreferences();

    await user.type(screen.getByLabelText("Search movie titles"), "Sensitive");
    await user.click(await screen.findByRole("button", { name: "Hide movie" }));
    expect(
      await screen.findByText("Could not save this movie preference."),
    ).toHaveAttribute("role", "alert");
  });
});
