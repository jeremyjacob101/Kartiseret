import { ShowtimeDayPicker } from "../../src/components/showtimes/ShowtimeDayPicker";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

  it("keeps adjacent date clicks responsive after selecting a far-ahead day", () => {
    const onSelect = vi.fn();
    const today = "2026-11-03";
    const dates = Array.from({ length: 180 }, (_, index) => {
      const date = new Date(`${today}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + index);
      return date.toISOString().slice(0, 10);
    });
    const linkedDate = dates[75]!;
    const previousDate = dates[74]!;
    const nextDate = dates[76]!;
    const dateLabel = (date: string) =>
      new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(new Date(`${date}T12:00:00`));

    render(
      <ShowtimeDayPicker
        dates={dates}
        selectedDate={linkedDate}
        disabledBeforeDate={today}
        onSelect={onSelect}
        ariaLabel="Choose date"
      />,
    );

    fireEvent.click(
      screen.getByRole("radio", {
        name: dateLabel(previousDate),
      }),
    );
    fireEvent.click(
      screen.getByRole("radio", {
        name: dateLabel(nextDate),
      }),
    );
    fireEvent.click(
      screen.getByRole("radio", {
        name: dateLabel(previousDate),
      }),
    );

    expect(onSelect.mock.calls).toEqual([
      [previousDate],
      [nextDate],
      [previousDate],
    ]);
  });
});
