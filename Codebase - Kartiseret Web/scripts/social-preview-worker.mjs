import { toComingSoonMovie, toNowPlayingMovie } from "../../packages/server/dist/catalog/movie-mapper.js";
import { createSocialPreviewFingerprint } from "../../packages/server/dist/social-preview.js";
import { socialPreviewCardDataSchema } from "../../packages/contracts/dist/social-preview.js";
import { createPreviewImage, MAX_IMAGE_BYTES } from "../server/og/previewImage.ts";
import { createInterface } from "node:readline";

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function nullableSafeInteger(value) {
  const result = nullableNumber(value);
  return result !== null && Number.isSafeInteger(result) ? result : null;
}

function nullableText(value) {
  if (value === null || value === undefined) return null;
  return String(value);
}

function movieMapperRecord(row, isComingSoon) {
  const common = {
    tmdbId: Number(row.tmdb_id),
    englishTitle: row.english_title,
    releaseYear: nullableSafeInteger(row.release_year),
    genres: row.genres ?? null,
    enPoster: row.en_poster ?? null,
    backdrop: row.backdrop ?? null,
    socialPreviewFingerprint: row.social_preview_fingerprint ?? null,
    enTrailer: row.en_trailer ?? null,
    soloUpdate: row.solo_update === true,
    altOptions: row.alt_options ?? [],
  };

  if (isComingSoon) {
    return {
      ...common,
      releaseDate: String(row.release_date ?? ""),
      runtime: nullableNumber(row.runtime),
      popularity: nullableNumber(row.popularity),
    };
  }

  return {
    ...common,
    imdbId: nullableText(row.imdb_id),
    rtId: nullableText(row.rt_id),
    imdbRating: nullableNumber(row.imdbRating),
    imdbVotes: nullableText(row.imdbVotes),
    rtAudienceRating: nullableText(row.rtAudienceRating),
    rtAudienceVotes: nullableText(row.rtAudienceVotes),
    rtCriticRating: nullableNumber(row.rtCriticRating),
    rtCriticVotes: nullableText(row.rtCriticVotes),
    lbId: nullableText(row.lb_id),
    lbRating: nullableNumber(row.lbRating),
    lbVotes: nullableText(row.lbVotes),
    tmdbRating: nullableNumber(row.tmdbRating),
    tmdbVotes: nullableText(row.tmdbVotes),
    runtime: nullableNumber(row.runtime),
    popularity: nullableNumber(row.popularity),
  };
}

function positiveOrNull(value) {
  return value !== null && value > 0 ? value : null;
}

function cardDataForRow(row) {
  const isComingSoon = row.table === "finalSoons";
  const record = movieMapperRecord(row.record, isComingSoon);
  const movie = isComingSoon
    ? toComingSoonMovie(record)
    : toNowPlayingMovie(record);
  const data = socialPreviewCardDataSchema.parse({
    tmdbId: movie.tmdbId,
    title: movie.title,
    posterUrl: movie.imageSrc,
    backdropUrl: movie.backdropSrc ?? movie.imageSrc,
    isComingSoon,
    year: movie.year > 0 ? movie.year : null,
    releaseDate: isComingSoon ? (movie.releaseDate ?? null) : null,
    runtime: movie.runtime > 0 ? movie.runtime : null,
    genres: movie.genres.slice(0, 3),
    imdbRating: isComingSoon ? null : positiveOrNull(movie.imdbRating),
    rtCriticRating: isComingSoon ? null : positiveOrNull(movie.rtCriticRating),
    rtCriticVotes: isComingSoon ? null : positiveOrNull(movie.rtCriticVotes),
    rtAudienceRating: isComingSoon
      ? null
      : positiveOrNull(movie.rtAudienceRating),
    rtAudienceVotes: isComingSoon
      ? null
      : positiveOrNull(movie.rtAudienceVotes),
    lbRating: isComingSoon ? null : positiveOrNull(movie.lbRating),
  });
  return data;
}

function decodeSource(value) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > MAX_IMAGE_BYTES * 1.4) {
    throw new Error("Invalid or oversized source image payload.");
  }
  const buffer = Buffer.from(value, "base64");
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw new Error("Invalid or oversized source image payload.");
  }
  return buffer;
}

async function handle(message) {
  if (message.op === "fingerprint") {
    const data = cardDataForRow(message);
    return { fingerprint: createSocialPreviewFingerprint(data), data };
  }
  if (message.op === "render") {
    const data = socialPreviewCardDataSchema.parse(message.data);
    const image = await createPreviewImage(data, {
      posterSource: decodeSource(message.posterSource),
      backdropSource: decodeSource(message.backdropSource),
    });
    if (!image.length || image.length > 2 * 1024 * 1024) {
      throw new Error("Rendered social preview exceeds the output size limit.");
    }
    return { jpeg: image.toString("base64") };
  }
  throw new Error("Unsupported social preview worker operation.");
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  try {
    const message = JSON.parse(line);
    const result = await handle(message);
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown error";
    process.stdout.write(`${JSON.stringify({ ok: false, error: reason })}\n`);
  }
}
