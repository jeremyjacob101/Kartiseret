import { MovieMetricsRow, MovieTrailerModal, ShowtimeTheaters } from "../src/components/showtimes/ShowtimeShared";
import { getMetricDisplays, getTrailerEmbedUrl } from "../src/components/showtimes/showtimeUtils";
import { fireEvent, render, screen } from "@testing-library/react";
import { sampleMovie, sampleShowtimes } from "./fixtures";
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
    expect(screen.getByText("IMAX")).toBeInTheDocument();
    expect(screen.getAllByAltText("")[0]).toHaveAttribute(
      "src",
      "/flags/israel.svg",
    );
    expect(screen.getByText("Premium")).toBeInTheDocument();
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

    fireEvent.click(
      screen.getByRole("button", { name: "Watch Sample Movie trailer" }),
    );
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
