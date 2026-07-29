import dotenv from "dotenv";
import express, { type Response } from "express";
import sharp, { type OverlayOptions } from "sharp";
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  decodeDateCode,
  getJerusalemCalendarDate,
  isCanonicalShowtimeFilterMatch,
  parseMovieRouteCode,
  resolveCityCode,
  SHOWTIME_FILTER_OPTIONS,
  uncheckedFromFilterMask,
} from "../src/routing/showtimeLinkCodec.ts";

import {
  buildShowtimeFilterSelections,
  getCanonicalShowtimeMeta,
} from "../src/components/showtimes/showtimeFilters.ts";

import { DEFAULT_LOCATION } from "../src/prefs/definitions/locations.ts";

const serverDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(serverDirectory, "..");
const repositoryRoot = resolve(appRoot, "..");
const distDirectory = resolve(appRoot, "dist");
const indexPath = resolve(distDirectory, "index.html");
const logoPath = resolve(appRoot, "public/logos/favicon.svg");

dotenv.config({ path: resolve(repositoryRoot, ".env.local") });
dotenv.config({ path: resolve(repositoryRoot, ".env") });

function requireEnvironmentValue(
  name: string,
  ...values: Array<string | undefined>
): string {
  for (const value of values) {
    const normalizedValue = value?.trim();
    if (normalizedValue) {
      return normalizedValue;
    }
  }
  throw new Error(`Missing required ${name} environment variable.`);
}

const supabaseUrl = requireEnvironmentValue(
  "SUPABASE_URL",
  process.env.SUPABASE_URL,
  process.env.VITE_SUPABASE_URL,
);

const supabaseKey = requireEnvironmentValue(
  "SUPABASE_PUBLISHABLE_KEY",
  process.env.SUPABASE_PUBLISHABLE_KEY,
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);

const siteUrl = (process.env.SITE_URL || "https://seret.site").replace(/\/$/, "");
const port = Number(process.env.PORT || 3000);

const supabase = createClient(supabaseUrl, supabaseKey);
const app = express();

if (!existsSync(indexPath)) {
  throw new Error(
    `Could not find ${indexPath}. Run "npm run build" before starting the server.`,
  );
}

const baseIndexHtml = readFileSync(indexPath, "utf8");

type DatabaseMovie = {
  english_title: string | null;
  en_poster: string | null;
  backdrop: string | null;
};

type DatabaseShowtime = {
  cinema: string | null;
  showtime: string | null;
  screening_tech: string | null;
  screening_type: string | null;
  dub_language: string | null;
};

type PreviewTheater = {
  theater: string;
  showtimes: string[];
};

type PreviewData = {
  routeCode: string;
  movieCode: string;
  tmdbId: string;
  title: string;
  city: string;
  date: string;
  dateLabel: string;
  posterUrl: string;
  backdropUrl: string;
  theaters: PreviewTheater[];
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeXml(value: string): string {
  return escapeHtml(value);
}

function normalizeShowtime(value: string | null): string {
  const normalizedValue = value?.trim() || "";
  return normalizedValue.length >= 5
    ? normalizedValue.slice(0, 5)
    : normalizedValue;
}

function getShowtimeSortValue(showtime: string): number {
  const [hoursText, minutesText] = showtime.split(":");
  const hours = Number.parseInt(hoursText || "", 10);
  const minutes = Number.parseInt(minutesText || "", 10);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return Number.POSITIVE_INFINITY;
  }

  const totalMinutes = hours * 60 + minutes;

  return totalMinutes < 65 ? totalMinutes + 24 * 60 : totalMinutes;
}

function formatPreviewDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

async function getMovieByTmdbId(
  tmdbId: string,
): Promise<DatabaseMovie | null> {
  for (const tableName of ["finalMovies", "finalSoons"]) {
    const { data, error } = await supabase
      .from(tableName)
      .select("english_title,en_poster,backdrop")
      .eq("tmdb_id", tmdbId)
      .limit(1);

    if (error) {
      throw new Error(
        `Failed to load ${tableName} movie ${tmdbId}: ${error.message}`,
      );
    }

    const movie = data?.[0] as DatabaseMovie | undefined;
    if (movie) {
      return movie;
    }
  }

  return null;
}

function filterShowtimeRows(
  rows: DatabaseShowtime[],
  filterMask: number,
): DatabaseShowtime[] {
  const unchecked = uncheckedFromFilterMask(filterMask);

  if (!unchecked) {
    return [];
  }

  const selections = buildShowtimeFilterSelections(
    SHOWTIME_FILTER_OPTIONS,
    {
      version: 3,
      unchecked: {
        showType: [...unchecked.showType],
        screenFormat: [...unchecked.screenFormat],
        screeningTech: [...unchecked.screeningTech],
        dubLanguage: [...unchecked.dubLanguage],
      },
    },
  );

  return rows.filter((row) =>
    isCanonicalShowtimeFilterMatch(
      getCanonicalShowtimeMeta({
        time: normalizeShowtime(row.showtime),
        href: null,
        screeningTech: row.screening_tech || "",
        screeningType: row.screening_type || "",
        dubLanguage: row.dub_language,
      }),
      selections,
    ),
  );
}

function groupPreviewShowtimes(
  rows: DatabaseShowtime[],
): PreviewTheater[] {
  const showtimesByTheater = new Map<string, Set<string>>();

  for (const row of rows) {
    const theater = row.cinema?.trim();
    const showtime = normalizeShowtime(row.showtime);

    if (!theater || !showtime) {
      continue;
    }

    const existingShowtimes =
      showtimesByTheater.get(theater) || new Set<string>();
    existingShowtimes.add(showtime);
    showtimesByTheater.set(theater, existingShowtimes);
  }

  return [...showtimesByTheater.entries()]
    .map(([theater, showtimes]) => ({
      theater,
      showtimes: [...showtimes]
        .sort(
          (left, right) =>
            getShowtimeSortValue(left) - getShowtimeSortValue(right),
        )
        .slice(0, 4),
    }))
    .sort((left, right) => {
      const leftFirst = left.showtimes[0] || "";
      const rightFirst = right.showtimes[0] || "";

      return (
        getShowtimeSortValue(leftFirst) -
          getShowtimeSortValue(rightFirst) ||
        left.theater.localeCompare(right.theater)
      );
    })
    .slice(0, 3);
}

async function getPreviewData(
  routeCode: string,
): Promise<PreviewData | null> {
  const parsedRoute = parseMovieRouteCode(routeCode);

  if (!parsedRoute) {
    return null;
  }

  const today = getJerusalemCalendarDate();
  let city = DEFAULT_LOCATION;
  let date = today;
  let filterMask = 0;

  if (parsedRoute.kind === "encoded") {
    const decodedCity = resolveCityCode(
      parsedRoute.cityCode,
      DEFAULT_LOCATION,
    );

    const decodedDate = decodeDateCode(parsedRoute.dateCode, today);

    if (!decodedCity || !decodedDate) {
      return null;
    }

    city = decodedCity;
    date = decodedDate;
    filterMask = parsedRoute.filterMask;
  }

  const { data: codeRows, error: codeError } = await supabase
    .from("movieCodes")
    .select("tmdb_id")
    .eq("movie_code", parsedRoute.movieCode)
    .limit(1);

  if (codeError) {
    throw new Error(`Failed to load movie code: ${codeError.message}`);
  }

  const tmdbId = String(codeRows?.[0]?.tmdb_id || "").trim();

  if (!tmdbId) {
    return null;
  }

  const movie = await getMovieByTmdbId(tmdbId);

  if (!movie?.english_title) {
    return null;
  }

  const { data: showtimeRows, error: showtimeError } = await supabase
    .from("finalShowtimes")
    .select(
      "cinema,showtime,screening_tech,screening_type,dub_language",
    )
    .eq("tmdb_id", tmdbId)
    .eq("screening_city", city)
    .eq("date_of_showing", date);

  if (showtimeError) {
    throw new Error(
      `Failed to load movie showtimes: ${showtimeError.message}`,
    );
  }

  const filteredRows = filterShowtimeRows(
    (showtimeRows || []) as DatabaseShowtime[],
    filterMask,
  );

  return {
    routeCode,
    movieCode: parsedRoute.movieCode,
    tmdbId,
    title: movie.english_title,
    city,
    date,
    dateLabel: formatPreviewDate(date),
    posterUrl: movie.en_poster?.trim() || "",
    backdropUrl: movie.backdrop?.trim() || "",
    theaters: groupPreviewShowtimes(filteredRows),
  };
}

function buildPreviewDescription(data: PreviewData): string {
  const theaterText = data.theaters
    .slice(0, 2)
    .map(
      (theater) =>
        `${theater.theater}: ${theater.showtimes.join(", ")}`,
    )
    .join(" · ");

  return theaterText
    ? `${data.city} · ${data.dateLabel} · ${theaterText}`
    : `${data.city} · ${data.dateLabel} · View available showtimes`;
}

function injectOpenGraphTags(
  html: string,
  data: PreviewData,
): string {
  const pageTitle = `${data.title} showtimes in ${data.city}`;
  const description = buildPreviewDescription(data);
  const pageUrl = `${siteUrl}/${data.routeCode}`;
  const imageUrl = `${siteUrl}/api/og-image/${data.routeCode}`;

  const openGraphBlock = `
<!-- OG_START -->
<title>${escapeHtml(pageTitle)} | Kartiseret</title>
<meta name="description" content="${escapeHtml(description)}" />

<meta property="og:title" content="${escapeHtml(pageTitle)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:image" content="${escapeHtml(imageUrl)}" />
<meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${escapeHtml(pageTitle)}" />
<meta property="og:url" content="${escapeHtml(pageUrl)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Kartiseret" />

<meta name="twitter:card" content="summary_large_image" />
<!-- OG_END -->`;

  return html.replace(
    /<!-- OG_START -->[\s\S]*?<!-- OG_END -->/,
    openGraphBlock,
  );
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

  const theaterSvg =
    data.theaters.length > 0
      ? data.theaters
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
          .join("")
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
      >${escapeXml(data.city)} · ${escapeXml(data.dateLabel)}</text>

      ${theaterSvg}
    </svg>
  `);
}

async function downloadImage(url: string): Promise<Buffer> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function createPreviewImage(data: PreviewData): Promise<Buffer> {
  const posterSource = data.posterUrl
    ? await downloadImage(data.posterUrl)
    : null;

  const backdropSource =
    data.backdropUrl && data.backdropUrl !== data.posterUrl
      ? await downloadImage(data.backdropUrl)
      : posterSource;

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

  if (existsSync(logoPath)) {
    const logo = await sharp(logoPath)
      .resize(82, 82)
      .png()
      .toBuffer();

    layers.push({
      input: logo,
      left: 72,
      top: 485,
    });
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

async function sendMovieHtml(
  routeCode: string,
  response: Response,
): Promise<void> {
  const previewData = await getPreviewData(routeCode);

  response.setHeader("Cache-Control", "no-store");

  if (!previewData) {
    response.type("html").send(baseIndexHtml);
    return;
  }

  response
    .type("html")
    .send(injectOpenGraphTags(baseIndexHtml, previewData));
}

app.get("/api/og/:routeCode", async (request, response, next) => {
  try {
    await sendMovieHtml(request.params.routeCode, response);
  } catch (error) {
    next(error);
  }
});

app.get("/api/og-image/:routeCode", async (request, response, next) => {
  try {
    const previewData = await getPreviewData(request.params.routeCode);

    if (!previewData) {
      response.sendStatus(404);
      return;
    }

    const image = await createPreviewImage(previewData);

    response.setHeader("Cache-Control", "no-store");
    response.type("image/jpeg").send(image);
  } catch (error) {
    next(error);
  }
});

app.get(/^\/[0-9A-Za-z]{3,10}$/, async (request, response, next) => {
  try {
    await sendMovieHtml(request.path.slice(1), response);
  } catch (error) {
    next(error);
  }
});

app.use(express.static(distDirectory));

app.use((_request, response) => {
  response.sendFile(indexPath);
});

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: express.NextFunction,
  ) => {
    console.error(error);
    response.status(500).send("Could not create the Kartiseret preview.");
  },
);

app.listen(port, "0.0.0.0", () => {
  console.log(`Kartiseret running on port ${port}`);
});
