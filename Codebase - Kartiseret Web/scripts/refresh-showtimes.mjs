import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const movieCsvPath = path.join(projectRoot, "public/csvs/finalMovies_rows.csv");
const showtimesInputPath = path.join(
  projectRoot,
  "public/csvs/finalShowtimes_rows.csv",
);
const showtimeOutputPaths = [
  path.join(projectRoot, "public/csvs/finalShowtimes_rows.csv"),
  path.join(projectRoot, "src/data/csvs/finalShowtimes_rows.csv"),
];

const keepCities = new Set(["Tel Aviv", "Haifa", "Jerusalem"]);
const topMovieCount = 10;
const windowStart = new Date(2026, 2, 2);
const windowDays = 14;
const generatedAt = "2026-03-02 12:00:00+00";

const cinemaConfigs = {
  "Lev Cinema": {
    screeningType: "Regular",
    screeningTech: "2D",
    runId: "242",
    englishHref(orderId) {
      return `https://ticket.lev.co.il/order/${orderId}?lang=en`;
    },
    hebrewHref(orderId) {
      return `https://ticket.lev.co.il/order/${orderId}?lang=he`;
    },
    fallbackTimes: ["10:40", "13:10", "15:50", "18:30", "21:30"],
  },
  "Cinema City": {
    screeningType: "Regular",
    screeningTech: "2D",
    runId: "242",
    englishHref(orderId) {
      return `https://tickets.cinema-city.co.il/order/${orderId}?lang=en`;
    },
    hebrewHref(orderId) {
      return `https://tickets.cinema-city.co.il/order/${orderId}?lang=he`;
    },
    fallbackTimes: ["12:00", "14:30", "17:00", "19:40", "21:00"],
  },
  "Yes Planet": {
    screeningType: "Regular",
    screeningTech: "2D",
    runId: "242",
    englishHref(orderId) {
      return `https://tickets5.planetcinema.co.il/order/${orderId}?lang=en`;
    },
    hebrewHref(orderId) {
      return `https://tickets5.planetcinema.co.il/order/${orderId}?lang=he`;
    },
    fallbackTimes: ["12:30", "15:10", "17:30", "20:10"],
  },
  "Hot Cinema": {
    screeningType: "Not Just Cinema",
    screeningTech: "2D",
    runId: "169",
    englishHref(orderId) {
      return `https://tickets.hotcinema.co.il/site/1195/tickets?code=1195-${orderId}&languageid=en_gb`;
    },
    hebrewHref(orderId) {
      return `https://tickets.hotcinema.co.il/site/1195/tickets?code=1195-${orderId}&languageid=he_IL`;
    },
    fallbackTimes: ["14:30", "17:00", "20:00"],
  },
  "Rav Hen": {
    screeningType: "Regular",
    screeningTech: "2D",
    runId: "242",
    englishHref(orderId) {
      return `https://tickets5.rav-hen.co.il/order/${orderId}?lang=he`;
    },
    hebrewHref(orderId) {
      return `https://tickets5.rav-hen.co.il/order/${orderId}?lang=he`;
    },
    fallbackTimes: ["17:00", "20:00"],
  },
  Movieland: {
    screeningType: "Regular",
    screeningTech: "2D",
    runId: "242",
    englishHref(orderId) {
      return `https://tickets.movieland.co.il/order/${orderId}?lang=en`;
    },
    hebrewHref(orderId) {
      return `https://tickets.movieland.co.il/order/${orderId}?lang=he`;
    },
    fallbackTimes: ["10:15", "12:45", "15:15", "17:45", "20:15", "22:30"],
  },
};

const dailyShowtimeRanges = {
  "1317288": [4, 8],
  "1316092": [3, 7],
  "1291335": [3, 6],
  "1312157": [2, 5],
  "1529023": [2, 5],
  "1063873": [1, 4],
  "1119449": [1, 3],
  "1140498": [3, 7],
  "1400743": [1, 4],
  "1297842": [4, 8],
};

const cinemaFallbackTimePool = {
  "Lev Cinema": [
    "10:40",
    "11:00",
    "12:50",
    "13:10",
    "14:30",
    "15:00",
    "16:00",
    "17:10",
    "18:30",
    "18:50",
    "19:20",
    "21:00",
    "21:30",
    "21:50",
  ],
  "Cinema City": [
    "10:30",
    "11:15",
    "12:00",
    "12:45",
    "14:30",
    "15:15",
    "17:00",
    "17:45",
    "19:40",
    "20:20",
    "21:00",
    "22:10",
  ],
  "Yes Planet": [
    "10:20",
    "11:00",
    "12:30",
    "13:15",
    "15:10",
    "16:00",
    "17:30",
    "18:30",
    "20:10",
    "21:30",
    "21:50",
    "22:20",
  ],
  "Hot Cinema": [
    "10:30",
    "11:00",
    "12:40",
    "13:50",
    "14:45",
    "15:50",
    "17:00",
    "18:40",
    "19:40",
    "20:30",
    "21:20",
    "21:45",
  ],
  "Rav Hen": [
    "10:45",
    "12:15",
    "14:00",
    "15:45",
    "17:00",
    "18:45",
    "20:30",
    "22:10",
  ],
  Movieland: [
    "10:15",
    "11:30",
    "12:45",
    "14:00",
    "15:15",
    "16:30",
    "17:45",
    "19:00",
    "20:15",
    "21:30",
    "22:30",
  ],
};

const movieCityPlans = {
  "Tel Aviv": [
    { cinema: "Lev Cinema", movieIds: "ALL" },
    { cinema: "Rav Hen", movieIds: "ALL" },
  ],
  Jerusalem: [
    { cinema: "Lev Cinema", movieIds: "ALL" },
    { cinema: "Cinema City", movieIds: "ALL" },
    { cinema: "Yes Planet", movieIds: "ALL" },
  ],
  Haifa: [
    { cinema: "Hot Cinema", movieIds: "ALL" },
    { cinema: "Yes Planet", movieIds: "ALL" },
    { cinema: "Movieland", movieIds: "ALL" },
  ],
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let index = 0;
  let inQuotes = false;

  while (index < text.length) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }

        inQuotes = false;
        index += 1;
        continue;
      }

      field += character;
      index += 1;
      continue;
    }

    if (character === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }

    if (character === ",") {
      row.push(field);
      field = "";
      index += 1;
      continue;
    }

    if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index += 1;
      continue;
    }

    if (character === "\r") {
      index += 1;
      continue;
    }

    field += character;
    index += 1;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [rawHeader = [], ...rawData] = rows;
  const header = rawHeader.map((value) => value.replace(/^\uFEFF/, ""));
  const data = rawData
    .filter((rawRow) => rawRow.some((value) => value.length > 0))
    .map((rawRow) =>
      Object.fromEntries(
        header.map((columnName, columnIndex) => [
          columnName,
          rawRow[columnIndex] ?? "",
        ]),
      ),
    );

  return { header, data };
}

function escapeCsvValue(value) {
  const stringValue = String(value ?? "");
  return /[",\n\r]/.test(stringValue)
    ? `"${stringValue.replaceAll('"', '""')}"`
    : stringValue;
}

function formatCsv(header, rows) {
  const lines = [header.map(escapeCsvValue).join(",")];

  for (const row of rows) {
    lines.push(header.map((columnName) => escapeCsvValue(row[columnName])).join(","));
  }

  return `${lines.join("\n")}\n`;
}

function normalizeText(value) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeTitle(value) {
  return normalizeText(value).replace(/^"+|"+$/g, "");
}

function parseNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

const windowEnd = formatDate(new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate() + windowDays - 1));

function toShowtimeValue(time) {
  return `${time}:00`;
}

function buildOrderId(seed, length) {
  const numericSeed = Number.parseInt(
    createHash("sha1").update(seed).digest("hex").slice(0, 12),
    16,
  );

  return String(numericSeed % 10 ** length).padStart(length, "0");
}

function buildUuid(seed) {
  const hex = createHash("sha1").update(seed).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function buildSeedNumber(seed) {
  return Number.parseInt(createHash("sha1").update(seed).digest("hex").slice(0, 12), 16);
}

function uniqueSortedTimes(times) {
  return [...new Set(times.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function pickTimes(pool, count, offset) {
  const uniquePool = uniqueSortedTimes(pool);
  if (uniquePool.length === 0) {
    return [];
  }

  if (uniquePool.length <= count) {
    return uniquePool;
  }

  const selected = [];
  const step = Math.max(1, Math.floor(uniquePool.length / count));

  for (let index = 0; index < count; index += 1) {
    const selectedIndex = (offset + index * step) % uniquePool.length;
    selected.push(uniquePool[selectedIndex]);
  }

  return uniqueSortedTimes(selected);
}

function getTargetShowtimeCount({ city, cinema, tmdbId, dateOfShowing }) {
  const [minCount, maxCount] = dailyShowtimeRanges[tmdbId] ?? [1, 4];
  const variationSeed = buildSeedNumber(`${city}|${cinema}|${tmdbId}|${dateOfShowing}`);
  const theaterBias =
    {
      "Lev Cinema": 0,
      "Cinema City": 1,
      "Yes Planet": 1,
      "Hot Cinema": -1,
      "Rav Hen": -1,
      Movieland: 0,
    }[cinema] ?? 0;
  const span = Math.max(1, maxCount - minCount + 1);
  const randomizedCount = minCount + (variationSeed % span);
  return Math.max(1, Math.min(8, randomizedCount + theaterBias));
}

const { header: showtimeHeader, data: rawShowtimes } = parseCsv(
  readFileSync(showtimesInputPath, "utf8"),
);
const { data: movieRows } = parseCsv(readFileSync(movieCsvPath, "utf8"));

const filteredShowtimes = rawShowtimes.filter((row) =>
  keepCities.has(normalizeText(row.screening_city)),
);
const baseShowtimes = filteredShowtimes.filter((row) => {
  const city = normalizeText(row.screening_city);
  const date = normalizeText(row.date_of_showing);
  return !(keepCities.has(city) && date >= formatDate(windowStart) && date <= windowEnd);
});

const topMovies = [...movieRows]
  .sort((left, right) => parseNumber(right.popularity) - parseNumber(left.popularity))
  .slice(0, topMovieCount)
  .map((row) => ({
    tmdbId: normalizeText(row.tmdb_id),
    englishTitle: normalizeTitle(row.english_title),
  }));

const topMovieIds = topMovies.map((movie) => movie.tmdbId);
const movieMetaById = new Map(
  topMovies.map((movie) => {
    const sampleRow =
      filteredShowtimes.find((row) => normalizeText(row.tmdb_id) === movie.tmdbId) ??
      {};

    return [
      movie.tmdbId,
      {
        english_title: sampleRow.english_title || movie.englishTitle,
        hebrew_title: sampleRow.hebrew_title || movie.englishTitle,
        original_language: sampleRow.original_language || "English",
        dub_language: sampleRow.dub_language || "",
      },
    ];
  }),
);

const observedTimesByCityMovieCinema = new Map();
const observedTimesByMovie = new Map();
const existingRowKeys = new Set();
const existingTimesByDateKey = new Map();

for (const row of baseShowtimes) {
  const tmdbId = normalizeText(row.tmdb_id);
  const city = normalizeText(row.screening_city);
  const cinema = normalizeText(row.cinema);
  const date = normalizeText(row.date_of_showing);
  const time = normalizeText(row.showtime).slice(0, 5);

  existingRowKeys.add([city, cinema, tmdbId, date, time].join("|"));

  const dateKey = [city, cinema, tmdbId, date].join("|");
  const existingTimes = existingTimesByDateKey.get(dateKey) ?? new Set();
  if (time) {
    existingTimes.add(time);
  }
  existingTimesByDateKey.set(dateKey, existingTimes);

  if (!topMovieIds.includes(tmdbId) || !time) {
    continue;
  }

  const cityMovieCinemaKey = [city, tmdbId, cinema].join("|");
  const movieTimes = observedTimesByMovie.get(tmdbId) ?? [];
  movieTimes.push(time);
  observedTimesByMovie.set(tmdbId, movieTimes);

  const times = observedTimesByCityMovieCinema.get(cityMovieCinemaKey) ?? [];
  times.push(time);
  observedTimesByCityMovieCinema.set(cityMovieCinemaKey, times);
}

const generatedRows = [];

for (let dayOffset = 0; dayOffset < windowDays; dayOffset += 1) {
  const currentDate = new Date(windowStart);
  currentDate.setDate(windowStart.getDate() + dayOffset);
  const dateOfShowing = formatDate(currentDate);

  for (const [city, planEntries] of Object.entries(movieCityPlans)) {
    for (const planEntry of planEntries) {
      const movieIds =
        planEntry.movieIds === "ALL" ? topMovieIds : planEntry.movieIds;

      for (const tmdbId of movieIds) {
        const existingDateKey = [city, planEntry.cinema, tmdbId, dateOfShowing].join("|");
        const targetCount = getTargetShowtimeCount({
          city,
          cinema: planEntry.cinema,
          tmdbId,
          dateOfShowing,
        });
        const existingTimesForDate = existingTimesByDateKey.get(existingDateKey) ?? new Set();
        const count = Math.max(0, targetCount - existingTimesForDate.size);

        if (count === 0) {
          continue;
        }

        const observedPool =
          observedTimesByCityMovieCinema.get([city, tmdbId, planEntry.cinema].join("|")) ??
          observedTimesByMovie.get(tmdbId) ??
          cinemaFallbackTimePool[planEntry.cinema] ??
          cinemaConfigs[planEntry.cinema].fallbackTimes;
        const offsetSeed = Number.parseInt(tmdbId.slice(-2), 10) + dayOffset;
        const availableTimes = uniqueSortedTimes([
          ...observedPool,
          ...(cinemaFallbackTimePool[planEntry.cinema] ?? []),
          ...cinemaConfigs[planEntry.cinema].fallbackTimes,
        ]).filter((time) => !existingTimesForDate.has(time));
        const selectedTimes = pickTimes(availableTimes, count, offsetSeed);
        const movieMeta = movieMetaById.get(tmdbId);

        for (const time of selectedTimes) {
          const rowKey = [city, planEntry.cinema, tmdbId, dateOfShowing, time].join("|");

          if (existingRowKeys.has(rowKey)) {
            continue;
          }

          const orderIdLength = planEntry.cinema === "Hot Cinema" ? 6 : 6;
          const orderId = buildOrderId(rowKey, orderIdLength);
          const cinemaConfig = cinemaConfigs[planEntry.cinema];

          generatedRows.push({
            id: buildUuid(`generated:${rowKey}`),
            created_at: generatedAt,
            english_title: movieMeta.english_title,
            original_language: movieMeta.original_language,
            screening_city: city,
            date_of_showing: dateOfShowing,
            showtime: toShowtimeValue(time),
            cinema: planEntry.cinema,
            english_href: cinemaConfig.englishHref(orderId),
            screening_type: cinemaConfig.screeningType,
            hebrew_title: movieMeta.hebrew_title,
            hebrew_href: cinemaConfig.hebrewHref(orderId),
            dub_language: movieMeta.dub_language,
            screening_tech: cinemaConfig.screeningTech,
            tmdb_id: tmdbId,
            run_id: cinemaConfig.runId,
          });
          existingRowKeys.add(rowKey);
          existingTimesForDate.add(time);
        }

        existingTimesByDateKey.set(existingDateKey, existingTimesForDate);
      }
    }
  }
}

const combinedRows = [...baseShowtimes, ...generatedRows].sort((left, right) => {
  return [
    normalizeText(left.screening_city),
    normalizeText(left.date_of_showing),
    normalizeText(left.cinema),
    normalizeText(left.english_title),
    normalizeText(left.showtime),
    normalizeText(left.id),
  ]
    .join("|")
    .localeCompare(
      [
        normalizeText(right.screening_city),
        normalizeText(right.date_of_showing),
        normalizeText(right.cinema),
        normalizeText(right.english_title),
        normalizeText(right.showtime),
        normalizeText(right.id),
      ].join("|"),
    );
});

const csvOutput = formatCsv(showtimeHeader, combinedRows);

for (const outputPath of showtimeOutputPaths) {
  writeFileSync(outputPath, csvOutput);
}

console.log(
  `Wrote ${combinedRows.length} rows (${baseShowtimes.length} kept, ${generatedRows.length} generated).`,
);
