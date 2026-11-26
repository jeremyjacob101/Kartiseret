import { PublicRouteLocationProvider } from "../../src/routing/PublicRouteLocationProvider";
import { PublicRoutePathsProvider } from "../../src/routing/PublicRoutePathsProvider";
import { BottomBar } from "../../src/components/bars/BottomBar";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";

describe("BottomBar", () => {
  it("marks the active information page while the browser uses its opaque route", () => {
    render(
      <MemoryRouter initialEntries={["/suport01"]}>
        <PublicRoutePathsProvider paths={{ "/support": "/suport01" }}>
          <PublicRouteLocationProvider renderPath="/support">
            <BottomBar />
          </PublicRouteLocationProvider>
        </PublicRoutePathsProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Support" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
