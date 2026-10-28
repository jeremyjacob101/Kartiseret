import { ReleaseCategorySwitcher } from "../src/components/ReleaseCategorySwitcher";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

describe("ReleaseCategorySwitcher", () => {
  it("exposes the selected category and reports changes accessibly", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ReleaseCategorySwitcher
        category="newReleases"
        onChange={onChange}
        routeLabel="Now Playing"
      />,
    );

    expect(
      screen.getByRole("group", { name: "Now Playing release category" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New Releases" }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Re-Releases" }));
    expect(onChange).toHaveBeenCalledWith("reReleases");
  });
});
