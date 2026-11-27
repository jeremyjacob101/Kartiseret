import { usePublicRouteLocation, usePublicRouteSearchParams } from "../../src/routing/PublicRouteLocation";
import { PublicRouteLocationProvider } from "../../src/routing/PublicRouteLocationProvider";
import { PublicRoutePathsProvider } from "../../src/routing/PublicRoutePathsProvider";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";

function LocationProbe() {
  const logicalLocation = usePublicRouteLocation();
  const actualLocation = useLocation();
  const [searchParams, setSearchParams] = usePublicRouteSearchParams();

  return (
    <>
      <output data-testid="logical-location">
        {logicalLocation.pathname}
        {logicalLocation.search}
      </output>
      <output data-testid="actual-location">
        {actualLocation.pathname}
        {actualLocation.search}
      </output>
      <output data-testid="selected-tab">{searchParams.get("tab")}</output>
      <button
        type="button"
        onClick={() =>
          setSearchParams((current) => {
            current.set("tab", "discovery");
            return current;
          })
        }
      >
        Open discovery
      </button>
    </>
  );
}

describe("PublicRouteLocationProvider", () => {
  it("exposes the internal page state while keeping browser navigation opaque", () => {
    render(
      <MemoryRouter initialEntries={["/abcd1234"]}>
        <PublicRoutePathsProvider paths={{}}>
          <PublicRouteLocationProvider renderPath="/user?linked=1">
            <LocationProbe />
          </PublicRouteLocationProvider>
        </PublicRoutePathsProvider>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("logical-location")).toHaveTextContent(
      "/user?linked=1",
    );
    expect(screen.getByTestId("actual-location")).toHaveTextContent(
      "/abcd1234",
    );
  });

  it("changes account tabs by navigating to another opaque route code", () => {
    render(
      <MemoryRouter initialEntries={["/abcd1234"]}>
        <PublicRoutePathsProvider
          paths={{ "/user?tab=discovery": "/wxyz9876" }}
        >
          <PublicRouteLocationProvider renderPath="/user?tab=account">
            <LocationProbe />
          </PublicRouteLocationProvider>
        </PublicRoutePathsProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open discovery" }));

    expect(screen.getByTestId("actual-location")).toHaveTextContent(
      "/wxyz9876",
    );
    expect(screen.getByTestId("actual-location")).not.toHaveTextContent("?");
  });

  it("does not navigate to an invalid preloaded destination", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ data: { path: "/wxyz9876" }, error: null }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MemoryRouter initialEntries={["/abcd1234"]}>
        <PublicRoutePathsProvider
          paths={{ "/user?tab=discovery": "/showtimes" }}
        >
          <PublicRouteLocationProvider renderPath="/user?tab=account">
            <LocationProbe />
          </PublicRouteLocationProvider>
        </PublicRoutePathsProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open discovery" }));

    await waitFor(() =>
      expect(screen.getByTestId("actual-location")).toHaveTextContent(
        "/wxyz9876",
      ));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/public-routes/legacy?path=%2Fuser%3Ftab%3Ddiscovery",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
