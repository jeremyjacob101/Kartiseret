import { MAX_WALLET_TICKET_QR_CODES } from "@kartiseret/contracts/private-data";
import type { QRCode } from "jsqr";

const maxQrPayloadBytes = 2048;

function validatePayload(result: QRCode): string {
  if (!result.data)
    throw new Error(
      "An empty QR code cannot be used as a ticket. Retry with a clearer screenshot or use the original ticket.",
    );
  const rawPayload = new Uint8Array(result.binaryData);
  let utf8Payload: string;
  try {
    utf8Payload = new TextDecoder("utf-8", { fatal: true }).decode(rawPayload);
  } catch {
    throw new Error(
      "A QR code uses text encoding Kartiseret cannot preserve on a Wallet pass. Use the original ticket instead.",
    );
  }
  if (
    utf8Payload !== result.data ||
    new TextEncoder().encode(result.data).length !== rawPayload.length
  ) {
    throw new Error(
      "A QR code uses text encoding Kartiseret cannot preserve on a Wallet pass. Use the original ticket instead.",
    );
  }
  if (rawPayload.length > maxQrPayloadBytes) {
    throw new Error(
      "A QR code contains more data than Kartiseret can safely put on a Wallet pass. Use the original ticket instead.",
    );
  }
  return result.data;
}

function redactQr(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  result: QRCode,
): void {
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
      pixels[index] = 255;
      pixels[index + 1] = 255;
      pixels[index + 2] = 255;
      pixels[index + 3] = 255;
    }
  }
}

/**
 * Read every visible QR from one screenshot. The source pixels are copied and
 * each detected code is masked before the next scan; screenshots never leave
 * the browser. Repeated payloads are returned once.
 */
export function decodeQrCodes(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  decode: typeof import("jsqr").default,
): string[] {
  const remainingPixels = new Uint8ClampedArray(pixels);
  const messages: string[] = [];
  let foundAny = false;

  for (let attempt = 0; attempt <= MAX_WALLET_TICKET_QR_CODES; attempt += 1) {
    const result = decode(remainingPixels, width, height, {
      inversionAttempts: "attemptBoth",
    }) as QRCode | null;
    if (!result) break;
    foundAny = true;
    const message = validatePayload(result);
    if (!messages.includes(message)) messages.push(message);
    if (messages.length > MAX_WALLET_TICKET_QR_CODES) {
      throw new Error(
        `A booking can contain up to ${MAX_WALLET_TICKET_QR_CODES} ticket QR codes. Choose fewer screenshots or split this booking.`,
      );
    }
    redactQr(remainingPixels, width, height, result);
  }

  if (!foundAny)
    throw new Error(
      "No readable QR code was found. Retry with a clearer screenshot or use the original ticket.",
    );
  return messages;
}
