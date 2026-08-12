import type { Movie, MovieLocalizedContent, ShowtimeEntry } from "../data/movieCatalog";
import type { AppLocale } from "./locale";
import { translateMessage, type MessageKey } from "./messages.ts";

const HEBREW_CITY_NAMES: Readonly<Record<string, string>> = {
  Acre: "עכו",
  Afula: "עפולה",
  Ashdod: "אשדוד",
  Ashkelon: "אשקלון",
  Ayalon: "איילון",
  "Bat Yam": "בת ים",
  "Beer Sheva": "באר שבע",
  Bethlehem: "בית לחם",
  "Bnei Brak": "בני ברק",
  Carmiel: "כרמיאל",
  Chadera: "חדרה",
  "Even Yehuda": "אבן יהודה",
  Givatayim: "גבעתיים",
  Glilot: "גלילות",
  Hadera: "חדרה",
  Haifa: "חיפה",
  Hebron: "חברון",
  Herziliya: "הרצליה",
  Holon: "חולון",
  Jericho: "יריחו",
  Jerusalem: "ירושלים",
  "Kfar Saba": "כפר סבא",
  "Kfar Yona": "כפר יונה",
  "Kiryat Bialik": "קריית ביאליק",
  "Kiryat Ono": "קריית אונו",
  Lod: "לוד",
  Modiin: "מודיעין",
  Nahariya: "נהריה",
  Nablus: "שכם",
  Nazareth: "נצרת",
  "Ness Ziona": "נס ציונה",
  Netanya: "נתניה",
  Omer: "עומר",
  "Petach Tikvah": "פתח תקווה",
  Qalqilya: "קלקיליה",
  Raanana: "רעננה",
  Ramallah: "רמאללה",
  Ramla: "רמלה",
  "Ramat Gan": "רמת גן",
  "Ramat Hasharon": "רמת השרון",
  Rehovot: "רחובות",
  "Rishon Letzion": "ראשון לציון",
  Safed: "צפת",
  "Tel Aviv": "תל אביב",
  Tiberias: "טבריה",
  Tulkarm: "טולכרם",
  Yavne: "יבנה",
  "Zichron Yaakov": "זכרון יעקב",
};

const HEBREW_THEATER_NAMES: Readonly<Record<string, string>> = {
  "Cinema City": "סינמה סיטי",
  Cinematheque: "סינמטק",
  "Haifa Cinematheque": "סינמטק חיפה",
  "Herziliya Cinematheque": "סינמטק הרצליה",
  "Holon Cinematheque": "סינמטק חולון",
  "Hot Cinema": "הוט סינמה",
  "Jaffa Cinema": "קולנוע יפו",
  "Jerusalem Cinematheque": "סינמטק ירושלים",
  "Lev Cinema": "קולנוע לב",
  MovieLand: "מובילנד",
  "Rav Hen": "רב חן",
  "Sam Spiegel Cinema": "קולנוע סם שפיגל",
  "Tel Aviv Cinematheque": "סינמטק תל אביב",
  "Yes Planet": "יס פלאנט",
};

const HEBREW_THEATER_NAME_ENTRIES = Object.entries(HEBREW_THEATER_NAMES).sort(
  ([left], [right]) => right.length - left.length,
);
const HEBREW_CITY_NAME_ENTRIES = Object.entries(HEBREW_CITY_NAMES).sort(
  ([left], [right]) => right.length - left.length,
);

const HEBREW_GENRES: Readonly<Record<string, string>> = {
  Action: "פעולה",
  Adventure: "הרפתקאות",
  Animation: "אנימציה",
  Comedy: "קומדיה",
  Crime: "פשע",
  Documentary: "תיעודי",
  Drama: "דרמה",
  Family: "משפחה",
  Fantasy: "פנטזיה",
  History: "היסטוריה",
  Horror: "אימה",
  Music: "מוזיקה",
  Mystery: "מסתורין",
  Romance: "רומנטיקה",
  "Sci-Fi": "מדע בדיוני",
  "Science Fiction": "מדע בדיוני",
  "TV Movie": "סרט טלוויזיה",
  Thriller: "מותחן",
  War: "מלחמה",
  Western: "מערבון",
};

const FILTER_MESSAGE_KEYS: Readonly<Record<string, MessageKey>> = {
  Regular: "filter.regular",
  Premium: "filter.premium",
  "Not Just Cinema": "filter.notJustCinema",
  Upgrade: "filter.upgrade",
  Prime: "filter.prime",
  Lounge: "filter.lounge",
  VIP: "filter.vip",
  "VIP Light": "filter.vipLight",
  Standard: "filter.standard",
  Original: "filter.original",
  Hebrew: "filter.hebrew",
  French: "filter.french",
};

const hebrewMovieCache = new WeakMap<Movie, Movie>();

function hasText(value: string | null | undefined): value is string {
  return Boolean(value?.trim());
}

function getRequestedMovieContent(
  movie: Movie,
  locale: AppLocale,
): Partial<MovieLocalizedContent> | undefined {
  return movie.localizations[locale];
}

export function localizeMovie(movie: Movie, locale: AppLocale): Movie {
  if (locale === "en") {
    return movie;
  }

  const cachedMovie = hebrewMovieCache.get(movie);

  if (cachedMovie) {
    return cachedMovie;
  }

  const localizedContent = getRequestedMovieContent(movie, locale);
  const localizedGenres =
    localizedContent?.genres && localizedContent.genres.length > 0
      ? localizedContent.genres
      : movie.genres.map((genre) => localizeGenre(genre, locale));
  const localizedMovie: Movie = {
    ...movie,
    title: hasText(localizedContent?.title)
      ? localizedContent.title
      : movie.title,
    genres: localizedGenres,
    imageSrc: hasText(localizedContent?.imageSrc)
      ? localizedContent.imageSrc
      : movie.imageSrc,
    backdropSrc: hasText(localizedContent?.backdropSrc)
      ? localizedContent.backdropSrc
      : movie.backdropSrc,
    trailerKey: hasText(localizedContent?.trailerKey)
      ? localizedContent.trailerKey
      : movie.trailerKey,
  };

  hebrewMovieCache.set(movie, localizedMovie);
  return localizedMovie;
}

export function localizeMovies(
  movies: readonly Movie[],
  locale: AppLocale,
): Movie[] {
  return locale === "en"
    ? [...movies]
    : movies.map((movie) => localizeMovie(movie, locale));
}

export function getEnglishMovieTitle(movie: Movie): string {
  return movie.localizations.en?.title?.trim() || movie.title;
}

export function localizeGenre(genre: string, locale: AppLocale): string {
  return locale === "he" ? (HEBREW_GENRES[genre] ?? genre) : genre;
}

export function localizeCityName(city: string, locale: AppLocale): string {
  return locale === "he" ? (HEBREW_CITY_NAMES[city] ?? city) : city;
}

export function localizeTheaterName(
  theater: string,
  locale: AppLocale,
): string {
  if (locale !== "he") {
    return theater;
  }

  const exactMatch = HEBREW_THEATER_NAMES[theater];

  if (exactMatch) {
    return exactMatch;
  }

  let localizedTheater = theater;

  for (const [englishName, hebrewName] of HEBREW_THEATER_NAME_ENTRIES) {
    if (theater.toLowerCase().includes(englishName.toLowerCase())) {
      localizedTheater = theater.replace(
        new RegExp(englishName, "i"),
        hebrewName,
      );
      break;
    }
  }

  for (const [englishCity, hebrewCity] of HEBREW_CITY_NAME_ENTRIES) {
    localizedTheater = localizedTheater.replace(
      new RegExp(englishCity, "gi"),
      hebrewCity,
    );
  }

  return localizedTheater;
}

export function localizeFilterOption(
  option: string,
  locale: AppLocale,
): string {
  const messageKey = FILTER_MESSAGE_KEYS[option];

  return messageKey ? translateMessage(locale, messageKey) : option;
}

export function getLocalizedShowtimeHref(
  showtime: ShowtimeEntry,
  locale: AppLocale,
): string | null {
  return showtime.localizedHrefs?.[locale] ?? showtime.href;
}
