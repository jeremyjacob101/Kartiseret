import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CinemaRouteLink } from "../../src/routing/CinemaRouteLink";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

afterEach(() => vi.unstubAllGlobals());

describe("CinemaRouteLink", () => {
  it("resolves an opaque cinema link without a preloaded route map", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ data: { path: "/wxyz9876" }, error: null }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CinemaRouteLink cinemaId="cinema-123456" className="cinema-link">
            Cinema showtimes
          </CinemaRouteLink>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "Cinema showtimes" }),
      ).toHaveAttribute("href", "/wxyz9876"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/public-routes/cinema/cinema-123456",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
