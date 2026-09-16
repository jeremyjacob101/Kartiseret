import { afterEach, describe, expect, it, vi } from "vitest";
import { shareLink } from "../src/routing/shareLink";

const payload = {
  title: "Sample Movie",
  text: "Watch this movie",
  url: "https://seret.site/Ab1",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("share link fallbacks", () => {
  it("uses native sharing when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share });

    await expect(shareLink(payload)).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith(payload);
  });

  it("reports cancellation without falling through to clipboard", async () => {
    const share = vi
      .fn()
      .mockRejectedValue(new DOMException("cancelled", "AbortError"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share, clipboard: { writeText } });

    await expect(shareLink(payload)).resolves.toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies through the modern clipboard API and reports failures", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await shareLink(payload)).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(payload.url);

    writeText.mockRejectedValueOnce(new Error("clipboard unavailable"));
    expect(await shareLink(payload)).toBe("failed");
  });

  it("uses the hidden textarea fallback when clipboard is unavailable", async () => {
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    vi.stubGlobal("navigator", {});

    await expect(shareLink(payload)).resolves.toBe("copied");
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });
});
