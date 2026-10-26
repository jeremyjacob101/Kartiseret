import type { ShowtimeFilterOptions, ShowtimeFilterSelections } from "../src/components/showtimes/showtimeFilters";
import { ShowtimeFilterMenu } from "../src/components/showtimes/ShowtimeFilterMenu";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const options: ShowtimeFilterOptions = {
  showType: ["Regular", "VIP"],
  screenFormat: ["2D"],
  screeningTech: ["Standard", "IMAX"],
  dubLanguage: ["Original"],
};

const selections: ShowtimeFilterSelections = {
  showType: new Set(["Regular", "VIP"]),
  screenFormat: new Set(["2D"]),
  screeningTech: new Set(["Standard"]),
  dubLanguage: new Set(["Original"]),
};

describe("ShowtimeFilterMenu", () => {
  it("opens a portal panel, toggles options and groups, and reports dismissal", async () => {
    const user = userEvent.setup();
    const onToggleOption = vi.fn();
    const onToggleGroup = vi.fn();
    render(
      <ShowtimeFilterMenu
        options={options}
        selections={selections}
        onToggleOption={onToggleOption}
        onToggleGroup={onToggleGroup}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Filter showtimes" });
    await user.click(trigger);
    const panel = await screen.findByRole("dialog", {
      name: "Showtime filters",
    });
    expect(panel).toHaveStyle({ width: "320px" });

    await user.click(screen.getByRole("button", { name: "VIP" }));
    expect(onToggleOption).toHaveBeenCalledWith("showType", "VIP");
    await user.click(
      screen.getByRole("button", { name: "Select all screeningTech filters" }),
    );
    expect(onToggleGroup).toHaveBeenCalledWith("screeningTech");

    fireEvent.pointerDown(document.body);
    expect(
      screen.queryByRole("dialog", { name: "Showtime filters" }),
    ).not.toBeInTheDocument();
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "Showtime filters" }),
    ).not.toBeInTheDocument();
  });
});
