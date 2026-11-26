import { PublicRoutePathsProvider } from "../../src/routing/PublicRoutePathsProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PublicRouteLink } from "../../src/routing/PublicRouteLink";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

function renderPublicRouteLink(path: string, to: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PublicRoutePathsProvider paths={{ [path]: "/abcd1234" }}>
          <PublicRouteLink to={to}>Open page</PublicRouteLink>
        </PublicRoutePathsProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PublicRouteLink", () => {
  it("renders the opaque code during server hydration and keeps the anchor", () => {
    renderPublicRouteLink("/support", "/support#showtime-corrections");

    expect(screen.getByRole("link", { name: "Open page" })).toHaveAttribute(
      "href",
      "/abcd1234#showtime-corrections",
    );
  });

  it("resolves uncommon callback paths before making them clickable", async () => {
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
          <PublicRoutePathsProvider paths={{}}>
            <PublicRouteLink to="/?verified=1#finished">
              Open page
            </PublicRouteLink>
          </PublicRoutePathsProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Open page" })).toHaveAttribute(
        "href",
        "/wxyz9876#finished",
      ));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/public-routes/legacy?path=%2F%3Fverified%3D1",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("resolves an opaque link when the page has no preloaded route map", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({ data: { path: "/wxyz9876" }, error: null }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PublicRouteLink to="/privacy">Open page</PublicRouteLink>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Open page" })).toHaveAttribute(
        "href",
        "/wxyz9876",
      ));
  });

  it("never exposes a readable destination when opaque route resolution fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () => new Response("unavailable", { status: 503 }),
      ),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PublicRoutePathsProvider paths={{}}>
            <PublicRouteLink to="/privacy">Open page</PublicRouteLink>
          </PublicRoutePathsProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText("Open page")).toHaveAttribute(
        "data-public-route-unavailable",
        "true",
      ));
    expect(screen.queryByRole("link", { name: "Open page" })).toBeNull();
  });
});
