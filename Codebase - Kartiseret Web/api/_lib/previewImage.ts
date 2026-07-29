import sharp, { type OverlayOptions } from "sharp";
import type { PreviewData } from "./previewData";

const IMAGE_TIMEOUT_MS = 8_000;

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
    const currentLine = lines.at(-1);

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

function createTheaterRows(theaters: PreviewData["theaters"]): string {
  return theaters
    .map((theater, index) => {
      const y = 350 + index * 78;

      return `
        <text
          x="480"
          y="${y}"
          font-size="23"
          font-weight="700"
          fill="white"
          font-family="Arial, Helvetica, sans-serif"
        >${escapeXml(theater.theater)}</text>

        <text
          x="480"
          y="${y + 34}"
          font-size="28"
          fill="#d9d1ee"
          font-family="Arial, Helvetica, sans-serif"
        >${escapeXml(theater.showtimes.join("   "))}</text>
      `;
    })
    .join("");
}

function createTextOverlay(data: PreviewData): Buffer {
  const titleLines = wrapTitle(data.title);

  const titleSvg = titleLines
    .map(
      (line, index) => `
        <text
          x="480"
          y="${145 + index * 60}"
          font-size="52"
          font-weight="700"
          fill="white"
          font-family="Arial, Helvetica, sans-serif"
        >${escapeXml(line)}</text>
      `,
    )
    .join("");

  const contextText = data.isComingSoon
    ? "Coming soon on Kartiseret"
    : `${data.city} · ${data.dateLabel}`;

  const theaterSvg = data.isComingSoon
    ? `
        <text
          x="480"
          y="375"
          font-size="30"
          fill="#d9d1ee"
          font-family="Arial, Helvetica, sans-serif"
        >Coming soon</text>
      `
    : data.theaters.length > 0
      ? createTheaterRows(data.theaters)
      : `
          <text
            x="480"
            y="375"
            font-size="27"
            fill="#d9d1ee"
            font-family="Arial, Helvetica, sans-serif"
          >View the latest available showtimes</text>
        `;

  return Buffer.from(`
    <svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="425"
        y="0"
        width="775"
        height="630"
        fill="#111116"
        fill-opacity="0.92"
      />

      <text
        x="480"
        y="70"
        font-size="22"
        font-weight="700"
        letter-spacing="4"
        fill="#a996d7"
        font-family="Arial, Helvetica, sans-serif"
      >KARTISERET</text>

      ${titleSvg}

      <text
        x="480"
        y="280"
        font-size="25"
        fill="#d9d1ee"
        font-family="Arial, Helvetica, sans-serif"
      >${escapeXml(contextText)}</text>

      ${theaterSvg}
    </svg>
  `);
}

function createHomepageSvg(): Buffer {
  return Buffer.from(`
    <svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
      <rect width="1200" height="630" fill="#111116" />

      <text
        x="600"
        y="280"
        font-size="64"
        font-weight="700"
        fill="white"
        font-family="Arial, Helvetica, sans-serif"
        text-anchor="middle"
      >Kartiseret</text>

      <text
        x="600"
        y="350"
        font-size="28"
        fill="#d9d1ee"
        font-family="Arial, Helvetica, sans-serif"
        text-anchor="middle"
      >Movie showtimes across Israel</text>
    </svg>
  `);
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
