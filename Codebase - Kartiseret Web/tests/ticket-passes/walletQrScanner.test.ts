import { decodeQrCodes } from "../../src/lib/walletQrScanner";
import { describe, expect, it } from "vitest";
import type { QRCode } from "jsqr";

function qrCode(
  value: string,
  bytes = new TextEncoder().encode(value),
): QRCode {
  const point = (x: number, y: number) => ({ x, y });
  return {
    data: value,
    binaryData: [...bytes],
    chunks: [],
    version: 1,
    location: {
      topLeftCorner: point(10, 10),
      topRightCorner: point(20, 10),
      bottomLeftCorner: point(10, 20),
      bottomRightCorner: point(20, 20),
      topLeftFinderPattern: point(10, 10),
      topRightFinderPattern: point(20, 10),
      bottomLeftFinderPattern: point(10, 20),
    },
  };
}

function decoderFor(
  results: Array<QRCode | null>,
  onSecondScan?: (pixels: Uint8ClampedArray) => void,
): typeof import("jsqr").default {
  let index = 0;
  return ((pixels: Uint8ClampedArray) => {
    const resultIndex = index++;
    if (resultIndex === 1) onSecondScan?.(pixels);
    return results[resultIndex] ?? null;
  }) as typeof import("jsqr").default;
}

describe("ticket screenshot QR decoding", () => {
  it("preserves all UTF-8 QR payloads and leaves the source pixels untouched", () => {
    const pixels = new Uint8ClampedArray(40 * 40 * 4).fill(7);
    let redactedPixels: Uint8ClampedArray | undefined;
    const decode = decoderFor(
      [qrCode("ticket-🎟️"), qrCode("family-seat-2"), null],
      (secondScan) => {
        redactedPixels = secondScan;
      },
    );

    expect(decodeQrCodes(pixels, 40, 40, decode)).toEqual([
      "ticket-🎟️",
      "family-seat-2",
    ]);
    expect(pixels[0]).toBe(7);
    expect(redactedPixels?.[10 * 40 * 4 + 10 * 4]).toBe(255);
  });

  it("exactly deduplicates repeated payloads in a screenshot", () => {
    const first = qrCode("first-ticket");
    const duplicate = qrCode("first-ticket");

    expect(
      decodeQrCodes(
        new Uint8ClampedArray(40 * 40 * 4),
        40,
        40,
        decoderFor([first, duplicate, null]),
      ),
    ).toEqual(["first-ticket"]);
  });

  it("rejects binary or oversized payloads instead of changing the ticket code", () => {
    expect(() =>
      decodeQrCodes(
        new Uint8ClampedArray(40 * 40 * 4),
        40,
        40,
        decoderFor([qrCode("�", new Uint8Array([0xff]))]),
      )).toThrow(/text encoding Kartiseret cannot preserve/i);

    expect(() =>
      decodeQrCodes(
        new Uint8ClampedArray(40 * 40 * 4),
        40,
        40,
        decoderFor([qrCode("x".repeat(2049))]),
      )).toThrow(/more data than Kartiseret can safely put/i);
  });
});
