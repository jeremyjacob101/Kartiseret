import { LetterboxdUnsubscribePage } from "../../src/components/LetterboxdUnsubscribePage";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

const token = "A".repeat(43);
const firstSource = {
  id: "00000000-0000-4000-8000-000000000101",
  sourceUrl: "https://letterboxd.com/fixture/watchlist/",
  sourceType: "watchlist" as const,
};
const secondSource = {
  id: "00000000-0000-4000-8000-000000000102",
  sourceUrl: "https://letterboxd.com/fixture/list/favorites/",
  sourceType: "list" as const,
};

function response(data: unknown) {
  return Response.json({ data, error: null });
}

function openPage() {
  window.history.replaceState(
    null,
    "",
    `/unsubscribe/letterboxd#token=${token}`,
  );
  return render(<LetterboxdUnsubscribePage />);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("public Letterboxd unsubscribe page", () => {
  it("shows current lists and requires confirmation before removing selected lists", async () => {
    const user = userEvent.setup();
    let current = [firstSource, secondSource];
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        `Bearer ${token}`,
      );
      expect(init?.credentials).toBe("omit");
      expect(init?.referrerPolicy).toBe("no-referrer");
      if (!init?.method || init.method === "GET")
        return response({ sources: current });
      const body = JSON.parse(String(init.body)) as { sourceIds: string[] };
      const removed = current.filter((source) =>
        body.sourceIds.includes(source.id));
      current = current.filter((source) => !body.sourceIds.includes(source.id));
      return response({ removed });
    });
    vi.stubGlobal("fetch", fetchMock);
    openPage();

    expect(
      await screen.findByRole("checkbox", { name: /fixture\/watchlist/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /fixture\/list\/favorites/ }),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe("");
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow, noarchive",
    );

    await user.click(
      screen.getByRole("checkbox", { name: /fixture\/watchlist/ }),
    );
    await user.click(
      screen.getByRole("button", { name: "Remove selected lists" }),
    );
    expect(
      screen.getByRole("heading", { name: "Remove these lists?" }),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Confirm removal" }));
    expect(
      await screen.findByText(/Removed: fixture\/watchlist/),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("checkbox", { name: /fixture\/list\/favorites/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: /fixture\/watchlist/ }),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([, init]) => init?.method === "POST",
      );
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({
        sourceIds: [firstSource.id],
      });
    });
  });

  it("shows a generic invalid-link message without calling the API", () => {
    window.history.replaceState(null, "", "/unsubscribe/letterboxd#token=bad");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<LetterboxdUnsubscribePage />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This unsubscribe link is invalid or has expired.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
