import { MovieMetricsRow, MovieTrailerModal, ShowtimeTheaters } from "../../src/components/showtimes/ShowtimeShared";
import { getMetricDisplays, getTrailerEmbedUrl } from "../../src/components/showtimes/showtimeUtils";
import { fireEvent, render, screen } from "@testing-library/react";
import { sampleMovie, sampleShowtimes } from "../fixtures";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

describe("showtime shared rendered surfaces", () => {
  it("renders theater links, technology badges, dub flags, and safe fallback colors", () => {
    render(<ShowtimeTheaters movie={sampleMovie} theaters={sampleShowtimes} />);

    expect(screen.getByText("Cinema City")).toBeInTheDocument();
    expect(screen.getByText("Unknown Cinema")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /19:30 showtime/ }),
    ).toHaveAttribute("target", "_blank");
    expect(
      screen
        .getByText("19:30")
        .closest<HTMLElement>(".details-time-pill")
        ?.querySelector(".details-time-pill-label"),
    ).toHaveTextContent("19:30");
    expect(screen.getByText("IMAX")).toBeInTheDocument();
    expect(screen.getAllByAltText("")[0]).toHaveAttribute(
      "src",
      "/flags/israel.svg",
    );
    expect(screen.getByText("Premium")).toBeInTheDocument();
    expect(
      screen
        .getByText("22:15")
        .closest<HTMLElement>(".details-time-pill")
        ?.style.getPropertyValue("--details-showtime-pill-background"),
    ).toContain("linear-gradient");
  });

  it.each([
    ["Infinity Vision", "InfVis"],
    ["2D 4DX Infinity Vision", "4DX InfVis"],
    ["3D Infinity Vision", "3D InfVis"],
    ["2D ScreenX Infinity vision", "ScreenX InfVis"],
  ])("abbreviates %s on the showtime badge", (screeningTech, label) => {
    const theater = sampleShowtimes[0];
    const showtime = { ...theater.showtimes[0], screeningTech };
    render(
      <ShowtimeTheaters
        movie={sampleMovie}
        theaters={[{ ...theater, showtimes: [showtime] }]}
      />,
    );

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("renders metrics only when there is useful content", () => {
    const metrics = getMetricDisplays(sampleMovie, ["imdbRating"]);
    const onTrailerClick = vi.fn();
    const { rerender } = render(
      <MovieMetricsRow
        movie={sampleMovie}
        metrics={metrics}
        trailerEmbedUrl={getTrailerEmbedUrl(sampleMovie.trailerKey)}
        onTrailerClick={onTrailerClick}
      />,
    );

    const play = screen.getByRole("button", {
      name: "Play Sample Movie trailer on YouTube",
    });
    expect(play).toHaveAccessibleDescription("Connects to YouTube");
    expect(document.querySelector("iframe")).toBeNull();
    fireEvent.click(play);
    expect(onTrailerClick).toHaveBeenCalledOnce();
    expect(screen.getByLabelText(/IMDb rating/)).toBeInTheDocument();

    rerender(
      <MovieMetricsRow
        movie={sampleMovie}
        metrics={[]}
        trailerEmbedUrl={null}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("locks body scroll, closes by escape, and restores the page for trailer modal", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <MovieTrailerModal
        movieTitle={sampleMovie.title}
        embedUrl={getTrailerEmbedUrl(sampleMovie.trailerKey)}
        isOpen
        onClose={onClose}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "Sample Movie trailer" }),
    ).toBeInTheDocument();
    expect(screen.getByTitle("Sample Movie trailer")).toHaveAttribute(
      "src",
      `${getTrailerEmbedUrl(sampleMovie.trailerKey)}&autoplay=1`,
    );
    expect(document.body.style.overflow).toBe("hidden");
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.mouseDown(screen.getByRole("button", { name: "Close trailer" }));

    rerender(
      <MovieTrailerModal
        movieTitle={sampleMovie.title}
        embedUrl={getTrailerEmbedUrl(sampleMovie.trailerKey)}
        isOpen={false}
        onClose={onClose}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
  });
});
