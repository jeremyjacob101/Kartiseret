import sharp, { type OverlayOptions } from "sharp";
import type { PreviewData } from "./previewData.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const IMAGE_TIMEOUT_MS = 8_000;

const assetsDir = fileURLToPath(new URL("./assets/", import.meta.url));

function loadAssetBuffer(filename: string): Buffer {
  const filePath = resolve(assetsDir, filename);
  try {
    return readFileSync(filePath);
  } catch (error) {
    throw new Error(`Failed to load OG image asset at ${filePath}: ${error}`);
  }
}

const INTER_REGULAR_B64 =
  loadAssetBuffer("Inter-Regular.ttf").toString("base64");
const INTER_SEMIBOLD_B64 =
  loadAssetBuffer("Inter-SemiBold.ttf").toString("base64");
const INTER_BOLD_B64 = loadAssetBuffer("Inter-Bold.ttf").toString("base64");
const LOGO_SVG = loadAssetBuffer("kartiseret-logo.svg");

const FONT_FACE_CSS = [
  `@font-face{font-family:'Inter OG';font-weight:400;src:url(data:font/ttf;base64,${INTER_REGULAR_B64}) format('truetype')}`,
  `@font-face{font-family:'Inter OG';font-weight:600;src:url(data:font/ttf;base64,${INTER_SEMIBOLD_B64}) format('truetype')}`,
  `@font-face{font-family:'Inter OG';font-weight:700;src:url(data:font/ttf;base64,${INTER_BOLD_B64}) format('truetype')}`,
].join("");

const LOGO_WIDTH = 150;
const LOGO_MARGIN_RIGHT = 45;
const LOGO_MARGIN_BOTTOM = 45;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function wrapTitle(title: string, maximumLength = 25): string[] {
  const words = title.split(/\s+/);
  const lines: string[] = [];

  for (const word of words) {
    const currentLine = lines[lines.length - 1];

    if (!currentLine) {
      lines.push(word);
      continue;
    }

    if (
      currentLine.length + word.length + 1 <= maximumLength ||
      lines.length >= 2
    ) {
      lines[lines.length - 1] = `${currentLine} ${word}`;
      continue;
    }

    lines.push(word);
  }

  if (lines.length > 2) {
    lines.length = 2;
  }

  if ((lines[1]?.length || 0) > maximumLength + 8) {
    lines[1] = `${lines[1]?.slice(0, maximumLength + 5)}…`;
  }

  return lines;
}

function createTheaterRows(
  theaters: PreviewData["theaters"],
  startY: number,
): string {
  return theaters
    .map((theater, index) => {
      const y = startY + index * 85;
      const showtimesFormatted = theater.showtimes.join("  ·  ");
      return `<text x="486" y="${y}" font-size="25" font-weight="700" fill="white" font-family="Inter OG,sans-serif">${escapeXml(theater.theater)}</text><text x="486" y="${y + 38}" font-size="33" font-weight="600" fill="#D8CFF5" font-family="Inter OG,sans-serif">${escapeXml(showtimesFormatted)}</text>`;
    })
    .join("");
}

function createTextOverlay(data: PreviewData): Buffer {
  const titleLines = wrapTitle(data.title);

  const titleSvg = titleLines
    .map((line, index) => {
      const y = 120 + index * 62;
      return `<text x="486" y="${y}" font-size="56" font-weight="700" fill="white" font-family="Inter OG,sans-serif">${escapeXml(line)}</text>`;
    })
    .join("");

  const contextText = data.isComingSoon
    ? "Coming soon on Kartiseret"
    : `${data.city} · ${data.dateLabel}`;

  let bodySvg: string;

  if (data.isComingSoon) {
    bodySvg =
      '<text x="486" y="310" font-size="30" font-weight="400" fill="#D8CFF5" font-family="Inter OG,sans-serif">Coming soon</text>';
  } else if (data.theaters.length > 0) {
    const theaterStartY = data.theaters.length <= 2 ? 340 : 310;
    bodySvg = createTheaterRows(data.theaters, theaterStartY);
  } else {
    bodySvg =
      '<text x="486" y="340" font-size="28" font-weight="600" fill="#D8CFF5" font-family="Inter OG,sans-serif">View available showtimes</text>';
  }

  const svg = [
    '<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">',
    "<defs>",
    `<style>${FONT_FACE_CSS}</style>`,
    '<linearGradient id="panelGrad" x1="0" y1="0" x2="1" y2="0">',
    '<stop offset="0%" stop-color="rgba(8,10,18,0.95)" />',
    '<stop offset="8%" stop-color="rgba(10,12,22,0.91)" />',
    '<stop offset="100%" stop-color="rgba(10,12,22,0.88)" />',
    "</linearGradient>",
    "</defs>",
    '<rect x="430" y="0" width="770" height="630" fill="url(#panelGrad)" />',
    titleSvg,
    `<text x="486" y="245" font-size="26" font-weight="400" fill="#D8CFF5" font-family="Inter OG,sans-serif">${escapeXml(contextText)}</text>`,
    bodySvg,
    "</svg>",
  ].join("");

  return Buffer.from(svg);
}

function createHomepageSvg(): Buffer {
  const svg = [
    '<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">',
    "<defs>",
    `<style>${FONT_FACE_CSS}</style>`,
    "</defs>",
    '<rect width="1200" height="630" fill="#111116" />',
    '<text x="600" y="300" font-size="64" font-weight="700" fill="white" font-family="Inter OG,sans-serif" text-anchor="middle">Kartiseret</text>',
    '<text x="600" y="364" font-size="28" font-weight="400" fill="#D8CFF5" font-family="Inter OG,sans-serif" text-anchor="middle">Movie showtimes across Israel</text>',
    "</svg>",
  ].join("");

  return Buffer.from(svg);
}

async function createLogoLayer(): Promise<OverlayOptions | null> {
  try {
    const logoMeta = await sharp(LOGO_SVG).metadata();
    const svgWidth = logoMeta.width ?? 1800;
    const svgHeight = logoMeta.height ?? 1340;
    const logoHeight = Math.round(LOGO_WIDTH * (svgHeight / svgWidth));

    const logoBuffer = await sharp(LOGO_SVG)
      .resize({ width: LOGO_WIDTH })
      .png()
      .toBuffer();

    return {
      input: logoBuffer,
      left: 1200 - LOGO_WIDTH - LOGO_MARGIN_RIGHT,
      top: 630 - logoHeight - LOGO_MARGIN_BOTTOM,
    };
  } catch (error) {
    console.error("Failed to create logo layer:", error);
    return null;
  }
}

async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    });

    if (!response.ok) {
      return null;
    }

    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

export async function createPreviewImage(data: PreviewData): Promise<Buffer> {
  const [posterSource, downloadedBackdrop] = await Promise.all([
    data.posterUrl ? downloadImage(data.posterUrl) : Promise.resolve(null),
    data.backdropUrl && data.backdropUrl !== data.posterUrl
      ? downloadImage(data.backdropUrl)
      : Promise.resolve(null),
  ]);

  const backdropSource = downloadedBackdrop || posterSource;
  const layers: OverlayOptions[] = [];

  if (backdropSource) {
    const background = await sharp(backdropSource)
      .resize(1200, 630, { fit: "cover" })
      .blur(16)
      .modulate({ brightness: 0.42 })
      .jpeg()
      .toBuffer();

    layers.push({ input: background, left: 0, top: 0 });
  }

  if (posterSource) {
    const poster = await sharp(posterSource)
      .resize(340, 540, { fit: "cover" })
      .jpeg()
      .toBuffer();

    layers.push({ input: poster, left: 55, top: 45 });
  }

  layers.push({
    input: createTextOverlay(data),
    left: 0,
    top: 0,
  });

  const logoLayer = await createLogoLayer();
  if (logoLayer) {
    layers.push(logoLayer);
  }

  return sharp({
    create: {
      width: 1200,
      height: 630,
      channels: 4,
      background: "#111116",
    },
  })
    .composite(layers)
    .jpeg({ quality: 90 })
    .toBuffer();
}

export async function createHomepagePreviewImage(): Promise<Buffer> {
  const layers: OverlayOptions[] = [
    { input: createHomepageSvg(), left: 0, top: 0 },
  ];

  const logoLayer = await createLogoLayer();
  if (logoLayer) {
    layers.push(logoLayer);
  }

  return sharp({
    create: {
      width: 1200,
      height: 630,
      channels: 4,
      background: "#111116",
    },
  })
    .composite(layers)
    .jpeg({ quality: 90 })
    .toBuffer();
}
