import { ComingSoonDateWatchlist } from "../src/components/ComingSoonDateWatchlist";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../src/lib/queryClient";
import userEvent from "@testing-library/user-event";

const userId = "00000000-0000-4000-8000-000000000001";
const watches: Array<Record<string, unknown>> = [];

vi.mock("../src/lib/authClient", () => ({
  getAuthClient: () => ({
    getSession: async () => ({ data: { user: { id: userId } }, error: null }),
  }),
}));

function mockFetch() {
  const fetchMock = vi.fn(async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/v1/tmdb/search") {
      const titles = url.searchParams.get("query")?.startsWith("Already")
        ? [
            {
              tmdbId: "9100101",
              title: "Already Announced Film",
              releaseYear: 2027,
              posterPath: null,
              comingSoonDate: "2027-04-12",
            },
          ]
        : [
            {
              tmdbId: "9100100",
              title: "Uncatalogued Future Film",
              releaseYear: 2028,
              posterPath: "/future.jpg",
              comingSoonDate: null,
            },
          ];
      return Response.json({
        data: {
          titles,
        },
        error: null,
      });
    }
    if (
      url.pathname === "/api/v1/coming-soon-watches" &&
      (!init?.method || init.method === "GET")
    ) {
      return Response.json({ data: { watches }, error: null });
    }
    if (
      url.pathname === "/api/v1/coming-soon-watches" &&
      init?.method === "POST"
    ) {
      const inputBody = JSON.parse(String(init.body)) as Record<
        string,
        unknown
      >;
      const watch = {
        ...inputBody,
        createdAt: "2026-10-21T10:00:00.000Z",
        notifiedAt: null,
        comingSoonDate: null,
      };
      watches.push(watch);
      return Response.json({ data: { kind: "watching", watch }, error: null });
    }
    if (
      url.pathname.startsWith("/api/v1/coming-soon-watches/") &&
      init?.method === "DELETE"
    ) {
      const tmdbId = url.pathname.split("/").at(-1);
      const index = watches.findIndex((watch) => watch.tmdbId === tmdbId);
      if (index >= 0) watches.splice(index, 1);
      return Response.json({ data: { removed: true }, error: null });
    }
    throw new Error(`Unexpected API request: ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderWatchlist() {
  return render(
    <QueryClientProvider client={queryClient}>
      <ComingSoonDateWatchlist userId={userId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  queryClient.clear();
  watches.splice(0, watches.length);
  mockFetch();
});

describe("ComingSoonDateWatchlist", () => {
  it("searches TMDb and lets the user watch a title before the local date exists", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch();
    renderWatchlist();

    await user.type(screen.getByLabelText("Search movie titles"), "Future");
    expect(
      await screen.findByText("Uncatalogued Future Film (2028)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No local Coming Soon date yet"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Watch date" }));
    expect(
      await screen.findByText("Waiting for a local Coming Soon date"),
    ).toBeInTheDocument();
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([, init]) => init?.method === "POST",
      );
      expect(post).toBeDefined();
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({
        tmdbId: "9100100",
        title: "Uncatalogued Future Film",
        releaseYear: 2028,
        posterPath: "/future.jpg",
      });
    });
  });

  it("shows an existing local Coming Soon date without offering a date alert", async () => {
    const user = userEvent.setup();
    renderWatchlist();
    await user.type(screen.getByLabelText("Search movie titles"), "Already");

    expect(
      await screen.findByText("Local Coming Soon date: Apr 12, 2027"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Watch date" }),
    ).not.toBeInTheDocument();
  });

  it("removes a watched title from the owner's list", async () => {
    watches.push({
      tmdbId: "9100100",
      title: "Uncatalogued Future Film",
      releaseYear: 2028,
      posterPath: null,
      createdAt: "2026-10-21T10:00:00.000Z",
      notifiedAt: null,
      comingSoonDate: null,
    });
    const user = userEvent.setup();
    renderWatchlist();

    await user.click(
      await screen.findByRole("button", {
        name: "Stop watching Uncatalogued Future Film",
      }),
    );
    expect(
      await screen.findByText("You are not watching any titles yet."),
    ).toBeInTheDocument();
  });
});
