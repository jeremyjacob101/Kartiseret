import svg from "../../src/assets/showtime-ticket-mask.svg?raw";
import { describe, expect, it } from "vitest";
import sharp from "sharp";

describe("showtime ticket silhouette", () => {
  it("renders round side bites instead of pointed pinches, mirrored on both sides", async () => {
    const { data, info } = await sharp(Buffer.from(svg))
      .resize(1000, 500)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alpha = (x: number, y: number) =>
      data[(y * info.width + x) * info.channels + 3];
    for (const x of [40, 959]) {
      expect(alpha(x, 170)).toBe(255);
      expect(alpha(x, 200)).toBe(0);
      expect(alpha(x, 250)).toBe(0);
      expect(alpha(x, 300)).toBe(0);
      expect(alpha(x, 330)).toBe(255);
    }
    for (const x of [80, 919]) {
      expect(alpha(x, 200)).toBe(255);
      expect(alpha(x, 250)).toBe(255);
      expect(alpha(x, 300)).toBe(255);
    }
  });
});
