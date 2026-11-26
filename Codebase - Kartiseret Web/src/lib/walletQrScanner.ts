import type { QRCode } from "jsqr";

const maxQrPayloadBytes = 2048;

export function decodeSingleQrCode(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  decode: typeof import("jsqr").default,
): string {
  const result = decode(pixels, width, height, {
    inversionAttempts: "attemptBoth",
  });
  if (!result?.data)
    throw new Error(
      "No readable QR code was found. Retry with a clearer screenshot or use the original ticket.",
    );
  const rawPayload = new Uint8Array(result.binaryData);
  let utf8Payload: string;
  try {
    utf8Payload = new TextDecoder("utf-8", { fatal: true }).decode(rawPayload);
  } catch {
    throw new Error(
      "This QR code uses a text encoding Kartiseret cannot preserve on a Wallet pass. Use the original ticket instead.",
    );
  }
  if (
    utf8Payload !== result.data ||
    new TextEncoder().encode(result.data).length !== rawPayload.length
  ) {
    throw new Error(
      "This QR code uses a text encoding Kartiseret cannot preserve on a Wallet pass. Use the original ticket instead.",
    );
  }
  if (rawPayload.length > maxQrPayloadBytes) {
    throw new Error(
      "This QR code contains more data than Kartiseret can safely put on a Wallet pass. Use the original ticket instead.",
    );
  }

  const otherCodePixels = new Uint8ClampedArray(pixels);
  const corners = [
    result.location.topLeftCorner,
    result.location.topRightCorner,
    result.location.bottomLeftCorner,
    result.location.bottomRightCorner,
  ];
  const left = Math.max(
    0,
    Math.floor(Math.min(...corners.map((point) => point.x)) - 12),
  );
  const top = Math.max(
    0,
    Math.floor(Math.min(...corners.map((point) => point.y)) - 12),
  );
  const right = Math.min(
    width,
    Math.ceil(Math.max(...corners.map((point) => point.x)) + 12),
  );
  const bottom = Math.min(
    height,
    Math.ceil(Math.max(...corners.map((point) => point.y)) + 12),
  );
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const index = (y * width + x) * 4;
      otherCodePixels[index] = 255;
      otherCodePixels[index + 1] = 255;
      otherCodePixels[index + 2] = 255;
      otherCodePixels[index + 3] = 255;
    }
  }
  const additionalCode = decode(otherCodePixels, width, height, {
    inversionAttempts: "attemptBoth",
  }) as QRCode | null;
  if (additionalCode?.data) {
    throw new Error(
      "This screenshot contains more than one QR code. Crop it to one ticket QR code and retry, or use the original ticket.",
    );
  }
  return result.data;
}
