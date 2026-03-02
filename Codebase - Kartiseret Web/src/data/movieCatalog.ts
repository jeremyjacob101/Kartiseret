import moviesCsv from "./csvs/finalMovies_rows.csv?raw";
import showtimesCsv from "./csvs/finalShowtimes_rows.csv?raw";

const TOP_MOVIE_COUNT = 10;
const THEATER_SORT_ORDER = [
  "Movieland",
  "Yes Planet",
  "Cinema City",
  "Lev Cinema",
  "Rav Hen",
];

export const defaultCity = "Haifa";
export const fixedAppDateString = "2026-03-02";
export const fixedShowtimeWindowEndDateString = "2026-03-11";

type CsvRow = Record<string, string>;

export type Movie = {
  tmdbId: string;
  title: string;
  year: number;
  imageSrc: string;
  backdropSrc?: string;
  imdbRating: number;
  rtRating: number;
  runtime: number;
  popularity: number;
};

export type TheaterShowtimes = {
  theater: string;
  showtimes: string[];
};

export type MovieShowtimeDay = {
  date: string;
  theaters: TheaterShowtimes[];
};

function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
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

  const [rawHeader = [], ...dataRows] = rows;
  const header = rawHeader.map((value) => value.replace(/^\uFEFF/, ""));

  return dataRows
    .filter((dataRow) => dataRow.some((value) => value.length > 0))
    .map((dataRow) =>
      Object.fromEntries(
        header.map((columnName, columnIndex) => [
          columnName,
          dataRow[columnIndex] ?? "",
        ]),
      ),
    );
}

function parseNumber(value: string, fallback = 0): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeTitle(value: string): string {
  return normalizeText(value).replace(/^"+|"+$/g, "");
}

function formatShowtime(value: string): string {
  const trimmed = value.trim();
  return trimmed.length >= 5 ? trimmed.slice(0, 5) : trimmed;
}

function parseIsoDate(dateString: string): Date {
  const [year, month, day] = dateString
    .split("-")
    .map((value) => Number.parseInt(value, 10));

  return new Date(year, (month || 1) - 1, day || 1);
}

function formatIsoDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function buildDateRange(startDateString: string, endDateString: string): string[] {
  const dates: string[] = [];
  const currentDate = parseIsoDate(startDateString);
  const endDate = parseIsoDate(endDateString);

  while (currentDate <= endDate) {
    dates.push(formatIsoDate(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return dates;
}

function compareTheaters(left: string, right: string): number {
  const leftOrder = THEATER_SORT_ORDER.indexOf(left);
  const rightOrder = THEATER_SORT_ORDER.indexOf(right);
  const safeLeftOrder = leftOrder === -1 ? Number.POSITIVE_INFINITY : leftOrder;
  const safeRightOrder =
    rightOrder === -1 ? Number.POSITIVE_INFINITY : rightOrder;

  if (safeLeftOrder !== safeRightOrder) {
    return safeLeftOrder - safeRightOrder;
  }

  return left.localeCompare(right);
}

function buildMovies(rows: CsvRow[]): Movie[] {
  return [...rows]
    .sort((left, right) => parseNumber(right.popularity) - parseNumber(left.popularity))
    .slice(0, TOP_MOVIE_COUNT)
    .map((row) => ({
      tmdbId: normalizeText(row.tmdb_id),
      title: normalizeTitle(row.english_title),
      year: Number.parseInt(row.release_year, 10) || 0,
      imageSrc: normalizeText(row.poster),
      backdropSrc: normalizeText(row.backdrop) || normalizeText(row.poster),
      imdbRating: parseNumber(row.imdbRating),
      rtRating: Math.round(
        parseNumber(row.rtCriticRating || row.rtAudienceRating),
      ),
      runtime: Number.parseInt(row.runtime, 10) || 0,
      popularity: parseNumber(row.popularity),
    }));
}

function buildMovieShowtimes(
  rows: CsvRow[],
  selectedMovies: readonly Movie[],
): Record<string, MovieShowtimeDay[]> {
  const showtimeWindowDates = buildDateRange(
    fixedAppDateString,
    fixedShowtimeWindowEndDateString,
  );
  const selectedMovieIds = new Set(
    selectedMovies.map((movie) => movie.tmdbId),
  );
  const groupedShowtimes = new Map<string, Map<string, Map<string, Set<string>>>>();

  for (const row of rows) {
    const tmdbId = normalizeText(row.tmdb_id);

    if (!selectedMovieIds.has(tmdbId)) {
      continue;
    }

    if (normalizeText(row.screening_city) !== defaultCity) {
      continue;
    }

    const date = normalizeText(row.date_of_showing);

    if (date < fixedAppDateString || date > fixedShowtimeWindowEndDateString) {
      continue;
    }

    const theater = normalizeText(row.cinema);
    const showtime = formatShowtime(row.showtime);

    if (!date || !theater || !showtime) {
      continue;
    }

    let movieDates = groupedShowtimes.get(tmdbId);
    if (!movieDates) {
      movieDates = new Map();
      groupedShowtimes.set(tmdbId, movieDates);
    }

    let theaterMap = movieDates.get(date);
    if (!theaterMap) {
      theaterMap = new Map();
      movieDates.set(date, theaterMap);
    }

    let showtimeSet = theaterMap.get(theater);
    if (!showtimeSet) {
      showtimeSet = new Set();
      theaterMap.set(theater, showtimeSet);
    }

    showtimeSet.add(showtime);
  }

  return Object.fromEntries(
    selectedMovies.map((movie) => {
      const movieDates = groupedShowtimes.get(movie.tmdbId);

      if (!movieDates) {
        return [
          movie.tmdbId,
          showtimeWindowDates.map((date) => ({
            date,
            theaters: [],
          })),
        ];
      }

      const days = showtimeWindowDates.map((date) => {
        const theaterMap = movieDates.get(date);

        return {
          date,
          theaters: theaterMap
            ? [...theaterMap.entries()]
                .sort(([leftTheater], [rightTheater]) =>
                  compareTheaters(leftTheater, rightTheater),
                )
                .map(([theater, showtimeSet]) => ({
                  theater,
                  showtimes: [...showtimeSet].sort((leftTime, rightTime) =>
                    leftTime.localeCompare(rightTime),
                  ),
                }))
            : [],
        };
      });

      return [movie.tmdbId, days];
    }),
  );
}

export const movies = buildMovies(parseCsv(moviesCsv));

const movieShowtimesByTmdbId = buildMovieShowtimes(
  parseCsv(showtimesCsv),
  movies,
);

export function getMovieShowtimeDays(
  tmdbId: string,
): readonly MovieShowtimeDay[] {
  return movieShowtimesByTmdbId[tmdbId] ?? [];
}
