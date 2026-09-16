import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShowtimeDayPicker } from "../src/components/showtimes/ShowtimeDayPicker";

describe("ShowtimeDayPicker", () => {
  it("renders a radiogroup with selected, edge, and trailing states", () => {
    render(
      <ShowtimeDayPicker
        dates={["2026-09-16", "2026-09-17", "2026-09-18"]}
        selectedDate="2026-09-17"
        onSelect={vi.fn()}
        ariaLabel="Choose showtime date"
        trailingPlaceholderCount={2}
      />,
    );

    expect(
      screen.getByRole("radiogroup", { name: "Choose showtime date" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /September 17, 2026/ }),
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByText("Sep").length).toBeGreaterThan(0);
    expect(
      document.querySelectorAll(".showtime-day-button--placeholder"),
    ).toHaveLength(2);
  });

  it("filters dates before the disabled boundary and selects via pointer or keyboard", () => {
    const onSelect = vi.fn();
    const onPreviewDateChange = vi.fn();
    render(
      <ShowtimeDayPicker
        dates={["2026-09-15", "2026-09-16", "2026-09-17"]}
        selectedDate="2026-09-16"
        disabledBeforeDate="2026-09-16"
        onSelect={onSelect}
        onPreviewDateChange={onPreviewDateChange}
        ariaLabel="Choose date"
      />,
    );

    expect(
      screen.queryByRole("radio", { name: /September 15, 2026/ }),
    ).not.toBeInTheDocument();
    const next = screen.getByRole("radio", { name: /September 17, 2026/ });
    fireEvent.click(next);
    expect(onSelect).toHaveBeenCalledWith("2026-09-17");
    expect(onPreviewDateChange).toHaveBeenCalledWith("2026-09-17");

    const selected = screen.getByRole("radio", { name: /September 16, 2026/ });
    fireEvent.keyDown(selected, { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith("2026-09-17");
    expect(document.activeElement).toBe(next);
  });
});
