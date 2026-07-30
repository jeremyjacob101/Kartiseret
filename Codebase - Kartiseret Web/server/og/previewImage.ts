import sharp, { type OverlayOptions } from "sharp";
import type { PreviewData } from "./previewData.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const IMAGE_TIMEOUT_MS = 8_000;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const assetsDir = fileURLToPath(new URL("./assets/", import.meta.url));
const INTER_REGULAR_PATH = resolve(assetsDir, "Inter-Regular.ttf");
const INTER_BOLD_PATH = resolve(assetsDir, "Inter-Bold.ttf");

function loadAssetBuffer(filename: string): Buffer {
  const filePath = resolve(assetsDir, filename);
  try {
    return readFileSync(filePath);
  } catch (error) {
    throw new Error(`Failed to load OG image asset at ${filePath}`, {
      cause: error,
    });
  }
}

const LOGO_SVG = loadAssetBuffer("kartiseret-logo.svg");
const IMDB_LOGO = loadAssetBuffer("imdb.svg").toString("base64");
const RT_CRITIC_LOGO = loadAssetBuffer("rtCriticHot.svg").toString("base64");
const RT_AUDIENCE_LOGO =
  loadAssetBuffer("rtAudienceHot.svg").toString("base64");
const RT_CRITIC_GOOD_LOGO =
  loadAssetBuffer("rtCriticGood.svg").toString("base64");
const RT_CRITIC_BAD_LOGO =
  loadAssetBuffer("rtCriticBad.svg").toString("base64");
const RT_AUDIENCE_GOOD_LOGO =
  loadAssetBuffer("rtAudienceGood.svg").toString("base64");
const RT_AUDIENCE_BAD_LOGO =
  loadAssetBuffer("rtAudienceBad.svg").toString("base64");
const LETTERBOXD_LOGO = loadAssetBuffer("letterboxd.svg").toString("base64");
const YOUTUBE_LOGO = loadAssetBuffer("youtube.svg").toString("base64");

const LOGO_WIDTH = 120;
const LOGO_MARGIN_RIGHT = 42;
const LOGO_MARGIN_TOP = 42;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function wrapTitle(title: string, maximumLength = 18): string[] {
  const words = title.split(/\s+/);
  const lines: string[] = [];
  let truncated = false;

  for (const word of words) {
    const currentLine = lines[lines.length - 1];

    if (!currentLine) {
      lines.push(word.slice(0, maximumLength));
      continue;
    }

    if (currentLine.length + word.length + 1 <= maximumLength) {
      lines[lines.length - 1] = `${currentLine} ${word}`;
      continue;
    }

    if (lines.length < 2) {
      lines.push(word.slice(0, maximumLength));
    } else {
      truncated = true;
      break;
    }
  }

  if (truncated && lines[1]) {
    lines[1] = `${lines[1].slice(0, maximumLength - 3).trimEnd()}...`;
  }

  return lines;
}

type MovieLayout = {
  titleLines: string[];
  eyebrowTop: number;
  titleTop: number;
  titleFontSize: number;
  metaTop: number;
  ratingLogoTop: number;
  ratingValueTop: number;
  trailerTop: number;
  dividerTop: number;
};

function getMovieLayout(title: string): MovieLayout {
  const titleLines = wrapTitle(title);

  if (titleLines.length === 2) {
    return {
      titleLines,
      eyebrowTop: 202,
      titleTop: 240,
      titleFontSize: 52,
      metaTop: 378,
      ratingLogoTop: 442,
      ratingValueTop: 514,
      trailerTop: 469,
      dividerTop: 445,
    };
  }

  return {
    titleLines,
    eyebrowTop: 242,
    titleTop: 286,
    titleFontSize: 70,
    metaTop: 378,
    ratingLogoTop: 442,
    ratingValueTop: 514,
    trailerTop: 469,
    dividerTop: 445,
  };
}

function formatRuntime(runtime: number | null): string | null {
  if (!runtime) return null;
  const hours = Math.floor(runtime / 60);
  const minutes = runtime % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function formatPreviewReleaseDate(releaseDate: string | null): string {
  if (!releaseDate) {
    return "TBA";
  }

  const parsedDate = new Date(`${releaseDate}T12:00:00Z`);
  if (Number.isNaN(parsedDate.getTime())) {
    return releaseDate;
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parsedDate);
}

function getCriticLogo(score: number | null, votes: number | null): string {
  if ((score ?? 0) >= 75 && (votes ?? 0) >= 80) return RT_CRITIC_LOGO;
  return (score ?? 0) >= 60 ? RT_CRITIC_GOOD_LOGO : RT_CRITIC_BAD_LOGO;
}

function getAudienceLogo(score: number | null, votes: number | null): string {
  if ((score ?? 0) >= 90 && (votes ?? 0) >= 500) return RT_AUDIENCE_LOGO;
  return (score ?? 0) >= 60 ? RT_AUDIENCE_GOOD_LOGO : RT_AUDIENCE_BAD_LOGO;
}

function createRatings(data: PreviewData, layout: MovieLayout): string {
  if (data.isComingSoon) {
    return "";
  }

  const ratings: Array<[string, string | null]> = [
    [IMDB_LOGO, data.imdbRating ? data.imdbRating.toFixed(1) : null],
    [
      getAudienceLogo(data.rtAudienceRating, data.rtAudienceVotes),
      data.rtAudienceRating ? `${Math.round(data.rtAudienceRating)}%` : null,
    ],
    [
      getCriticLogo(data.rtCriticRating, data.rtCriticVotes),
      data.rtCriticRating ? `${Math.round(data.rtCriticRating)}%` : null,
    ],
    [LETTERBOXD_LOGO, data.lbRating ? data.lbRating.toFixed(1) : null],
  ].filter((rating): rating is [string, string] => Boolean(rating[1]));

  const logoX = [530, 650, 770, 890];
  return ratings
    .slice(0, 4)
    .map(([logo], index) => {
      return `<image href="data:image/svg+xml;base64,${logo}" x="${logoX[index]}" y="${layout.ratingLogoTop}" width="62" height="62" preserveAspectRatio="xMidYMid meet"/>`;
    })
    .join("");
}

function createTextOverlay(data: PreviewData, layout: MovieLayout): Buffer {
  const ratingsSvg = createRatings(data, layout);

  const svg = [
    '<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">',
    '<rect width="1200" height="630" fill="rgba(10,12,22,0.46)" />',
    `<image href="data:image/svg+xml;base64,${YOUTUBE_LOGO}" x="405" y="${layout.trailerTop}" width="46" height="34" preserveAspectRatio="xMidYMid meet"/>`,
    `<rect x="489" y="${layout.dividerTop}" width="1" height="82" fill="#A990D1" fill-opacity="0.7" />`,
    ratingsSvg,
    "</svg>",
  ].join("");

  return Buffer.from(svg);
}

async function createTextLayer(
  text: string,
  width: number,
  fontSize: number,
  color: string,
  bold = false,
  align: "left" | "center" = "left",
): Promise<Buffer> {
  return sharp({
    text: {
      text: `<span foreground="${color}" font_desc="Inter ${bold ? "Bold" : "Regular"} ${fontSize}">${escapeXml(text)}</span>`,
      font: "Inter",
      fontfile: bold ? INTER_BOLD_PATH : INTER_REGULAR_PATH,
      width,
      align,
      rgba: true,
    },
  })
    .trim()
    .png()
    .toBuffer();
}

async function createMovieTextLayers(
  data: PreviewData,
  layout: MovieLayout,
): Promise<OverlayOptions[]> {
  const infoText = [
    data.year ? String(data.year) : null,
    formatRuntime(data.runtime),
    data.genres.length ? data.genres.join(", ") : null,
  ]
    .filter(Boolean)
    .join("  •  ");
  const ratingValues = [
    data.imdbRating ? data.imdbRating.toFixed(1) : null,
    data.rtAudienceRating ? `${Math.round(data.rtAudienceRating)}%` : null,
    data.rtCriticRating ? `${Math.round(data.rtCriticRating)}%` : null,
    data.lbRating ? data.lbRating.toFixed(1) : null,
  ].filter((value): value is string => Boolean(value));
  const eyebrowInput = await createTextLayer(
    data.isComingSoon ? "COMING SOON" : "NOW PLAYING",
    400,
    20,
    "#C5A9EB",
    true,
  );
  const titleInputs = await Promise.all(
    layout.titleLines.map((line) =>
      createTextLayer(line, 680, layout.titleFontSize, "#FFFFFF", true)),
  );
  const eyebrowHeight = (await sharp(eyebrowInput).metadata()).height ?? 0;
  const titleHeights = await Promise.all(
    titleInputs.map(
      async (input) => (await sharp(input).metadata()).height ?? 0,
    ),
  );
  const titleTops =
    layout.titleLines.length === 2
      ? [
          layout.metaTop - titleHeights[1] - titleHeights[0] - 20,
          layout.metaTop - titleHeights[1] - 14,
        ]
      : [layout.titleTop];
  const eyebrowTop =
    layout.titleLines.length === 2
      ? titleTops[0] - eyebrowHeight - 16
      : layout.eyebrowTop;
  const layers: OverlayOptions[] = [
    { input: eyebrowInput, left: 400, top: eyebrowTop },
    ...titleInputs.map((input, index) => ({
      input,
      left: 400,
      top: titleTops[index],
    })),
    {
      input: await createTextLayer(infoText, 730, 24, "#E6DFF3"),
      left: 400,
      top: layout.metaTop,
    },
  ];

  if (data.isComingSoon) {
    layers.push({
      input: await createTextLayer(
        `Release Date: ${formatPreviewReleaseDate(data.releaseDate)}`,
        620,
        26,
        "#FFFFFF",
        true,
      ),
      left: 530,
      top: layout.ratingLogoTop + 27,
    });
    return layers;
  }

  const ratingLogoCenters = [561, 681, 801, 921];
  for (const [index, value] of ratingValues.entries()) {
    const input = await createTextLayer(
      value,
      90,
      26,
      "#FFFFFF",
      true,
      "center",
    );
    const { width = 0 } = await sharp(input).metadata();
    layers.push({
      input,
      left: Math.round(ratingLogoCenters[index] - width / 2),
      top: layout.ratingValueTop,
    });
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

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export async function downloadImage(
  url: string,
  fetchImage: typeof fetch = fetch,
): Promise<Buffer | null> {
  if (!isHttpsUrl(url)) {
    return null;
  }

  try {
    const response = await fetchImage(url, {
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    });

    if (!response.ok || (response.url && !isHttpsUrl(response.url))) {
      return null;
    }

    const contentType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (!contentType?.startsWith("image/")) {
      return null;
    }

    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null) {
      const parsedLength = Number(declaredLength);
      if (
        !Number.isFinite(parsedLength) ||
        parsedLength < 0 ||
        parsedLength > MAX_IMAGE_BYTES
      ) {
        return null;
      }
    }

    if (!response.body) {
      return null;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }

      totalBytes += value.byteLength;
      if (totalBytes > MAX_IMAGE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }

    if (totalBytes === 0) {
      return null;
    }

    return Buffer.concat(
      chunks.map((chunk) => Buffer.from(chunk)),
      totalBytes,
    );
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
  const layout = getMovieLayout(data.title);
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
      .resize(330, 495, { fit: "cover" })
      .composite([
        {
          input: Buffer.from(
            '<svg width="330" height="495"><rect width="330" height="495" rx="34" fill="white"/></svg>',
          ),
          blend: "dest-in",
        },
      ])
      .png()
      .toBuffer();

    layers.push({ input: poster, left: 35, top: 45 });
  }

  layers.push({
    input: createTextOverlay(data, layout),
    left: 0,
    top: 0,
  });

  layers.push(...(await createMovieTextLayers(data, layout)));

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
