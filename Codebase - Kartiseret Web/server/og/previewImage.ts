import sharp, { type OverlayOptions } from "sharp";
import type { PreviewData } from "./previewData.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const IMAGE_TIMEOUT_MS = 8_000;

const assetsDir = fileURLToPath(new URL("./assets/", import.meta.url));
const INTER_REGULAR_PATH = resolve(assetsDir, "Inter-Regular.ttf");
const INTER_BOLD_PATH = resolve(assetsDir, "Inter-Bold.ttf");

function loadAssetBuffer(filename: string): Buffer {
  const filePath = resolve(assetsDir, filename);
  try {
    return readFileSync(filePath);
  } catch (error) {
    throw new Error(`Failed to load OG image asset at ${filePath}: ${error}`);
  }
}

const LOGO_SVG = loadAssetBuffer("kartiseret-logo.svg");
const IMDB_LOGO = loadAssetBuffer("imdb.svg").toString("base64");
const RT_CRITIC_LOGO = loadAssetBuffer("rtCriticGood.svg").toString("base64");
const RT_AUDIENCE_LOGO = loadAssetBuffer("rtAudienceGood.svg").toString("base64");
const LETTERBOXD_LOGO = loadAssetBuffer("letterboxd.svg").toString("base64");
const YOUTUBE_LOGO = loadAssetBuffer("youtube.svg").toString("base64");

const LOGO_WIDTH = 150;
const LOGO_MARGIN_RIGHT = 45;
const LOGO_MARGIN_TOP = 35;

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

function formatRuntime(runtime: number | null): string | null {
  if (!runtime) return null;
  const hours = Math.floor(runtime / 60);
  const minutes = runtime % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function createRatings(data: PreviewData): string {
  const ratings: Array<[string, string | null]> = [
    [IMDB_LOGO, data.imdbRating ? data.imdbRating.toFixed(1) : null],
    [RT_CRITIC_LOGO, data.rtCriticRating ? `${Math.round(data.rtCriticRating)}%` : null],
    [RT_AUDIENCE_LOGO, data.rtAudienceRating ? `${Math.round(data.rtAudienceRating)}%` : null],
    [LETTERBOXD_LOGO, data.lbRating ? data.lbRating.toFixed(1) : null],
  ].filter((rating): rating is [string, string] => Boolean(rating[1]));

  const logoX = [565, 685, 803, 924];
  return ratings.slice(0, 4).map(([logo], index) => {
    return `<image href="data:image/svg+xml;base64,${logo}" x="${logoX[index]}" y="462" width="62" height="62" preserveAspectRatio="xMidYMid meet"/>`;
  }).join("");
}

function createTextOverlay(data: PreviewData): Buffer {
  const ratingsSvg = createRatings(data);

  const svg = [
    '<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">',
    "<defs>",
    '<linearGradient id="panelGrad" x1="0" y1="0" x2="1" y2="0">',
    '<stop offset="0%" stop-color="rgba(8,10,18,0.72)" />',
    '<stop offset="8%" stop-color="rgba(10,12,22,0.62)" />',
    '<stop offset="100%" stop-color="rgba(10,12,22,0.52)" />',
    "</linearGradient>",
    "</defs>",
    '<rect x="430" y="0" width="770" height="630" fill="url(#panelGrad)" />',
    `<image href="data:image/svg+xml;base64,${YOUTUBE_LOGO}" x="435" y="476" width="48" height="48" preserveAspectRatio="xMidYMid meet"/>`,
    '<rect x="513" y="462" width="1" height="78" fill="#A990D1" fill-opacity="0.7" />',
    ratingsSvg,
    "</svg>",
  ].join("");

  return Buffer.from(svg);
}

async function createTextLayer(
  text: string,
  width: number,
  height: number,
  fontSize: number,
  color: string,
  bold = false,
): Promise<Buffer> {
  return sharp({
    text: {
      text: `<span foreground="${color}" font_desc="Inter ${bold ? "Bold" : "Regular"} ${fontSize}">${escapeXml(text)}</span>`,
      font: "Inter",
      fontfile: bold ? INTER_BOLD_PATH : INTER_REGULAR_PATH,
      width,
      height,
      rgba: true,
    },
  }).png().toBuffer();
}

async function createMovieTextLayers(data: PreviewData): Promise<OverlayOptions[]> {
  const infoText = [data.year ? String(data.year) : null, formatRuntime(data.runtime), data.genres.length ? data.genres.join(", ") : null].filter(Boolean).join("  •  ");
  const ratingValues = [data.imdbRating ? data.imdbRating.toFixed(1) : null, data.rtCriticRating ? `${Math.round(data.rtCriticRating)}%` : null, data.rtAudienceRating ? `${Math.round(data.rtAudienceRating)}%` : null, data.lbRating ? data.lbRating.toFixed(1) : null].filter((value): value is string => Boolean(value));
  const layers: OverlayOptions[] = [
    { input: await createTextLayer(data.isComingSoon ? "COMING SOON" : "NOW PLAYING", 400, 30, 14, "#C5A9EB", true), left: 435, top: 252 },
    { input: await createTextLayer(wrapTitle(data.title).join("\n"), 650, 120, 46, "#FFFFFF", true), left: 435, top: 287 },
    { input: await createTextLayer(infoText, 680, 36, 20, "#E6DFF3"), left: 435, top: 397 },
  ];
  const ratingValueX = [551, 671, 789, 910];
  for (const [index, value] of ratingValues.entries()) {
    layers.push({ input: await createTextLayer(value, 90, 38, index === 0 || index === 3 ? 25 : 28, "#FFFFFF", true), left: ratingValueX[index], top: 528 });
  }
  return layers;
}

function createHomepageSvg(): Buffer {
  const svg = [
    '<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">',
    "<defs>",
    "</defs>",
    '<rect width="1200" height="630" fill="#111116" />',
    '<text x="600" y="300" font-size="64" font-weight="700" fill="white" font-family="Arial, Helvetica, sans-serif" text-anchor="middle">Kartiseret</text>',
    '<text x="600" y="364" font-size="28" font-weight="400" fill="#D8CFF5" font-family="Arial, Helvetica, sans-serif" text-anchor="middle">Movie showtimes across Israel</text>',
    "</svg>",
  ].join("");

  return Buffer.from(svg);
}

async function createLogoLayer(): Promise<OverlayOptions | null> {
  try {
    const logoBuffer = await sharp(LOGO_SVG)
      .resize({ width: LOGO_WIDTH })
      .png()
      .toBuffer();

    return {
      input: logoBuffer,
      left: 1200 - LOGO_WIDTH - LOGO_MARGIN_RIGHT,
      top: LOGO_MARGIN_TOP,
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
      .modulate({ brightness: 0.62 })
      .jpeg()
      .toBuffer();

    layers.push({ input: background, left: 0, top: 0 });
  }

  if (posterSource) {
    const poster = await sharp(posterSource)
      .resize(340, 540, { fit: "cover" })
      .composite([
        {
          input: Buffer.from(
            '<svg width="340" height="540"><rect width="340" height="540" rx="38" fill="white"/></svg>',
          ),
          blend: "dest-in",
        },
      ])
      .jpeg()
      .toBuffer();

    layers.push({ input: poster, left: 55, top: 45 });
  }

  layers.push({
    input: createTextOverlay(data),
    left: 0,
    top: 0,
  });

  layers.push(...(await createMovieTextLayers(data)));

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
