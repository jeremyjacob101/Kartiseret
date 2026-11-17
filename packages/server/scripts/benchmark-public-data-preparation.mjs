import { cpus } from "node:os";
import { writeFile } from "node:fs/promises";
import {
  getCinemathequeData,
  getMovieCatalog,
  getMovieShowtimes,
  getShowtimeRange,
  getTicketAvailabilityShowtimes,
} from "../dist/public-data/service.js";
import { withPublicationSnapshot } from "../dist/public-data/snapshot.js";

const sampleCount = Number(process.env.BENCH_SAMPLES ?? 30);
const warmSampleCount = Number(process.env.BENCH_WARM_SAMPLES ?? 60);
const concurrency = Number(process.env.BENCH_CONCURRENCY ?? 10);
const databaseDelaysMs = (process.env.BENCH_DB_DELAYS_MS ?? "0,5")
  .split(",")
  .map(Number);
const rowScales = (process.env.BENCH_ROW_SCALES ?? "100,500,1500")
  .split(",")
  .map(Number);
const movie = (index, mode) => ({
  tmdbId: 9100000 + index,
  englishTitle: `${mode} movie ${index}`,
  releaseYear: 2026,
  releaseDate: mode === "comingSoon" ? "2027-04-12" : undefined,
  genres: ["Drama", "Comedy"],
  enPoster: `/poster-${index}.jpg`,
  backdrop: `/backdrop-${index}.jpg`,
  enTrailer: null,
  imdbId: `tt${String(index).padStart(7, "0")}`,
  rtId: null,
  imdbRating: 7.1,
  imdbVotes: "1000",
  rtAudienceRating: null,
  rtAudienceVotes: null,
  rtCriticRating: 75,
  rtCriticVotes: null,
  lbId: null,
  lbRating: null,
  lbVotes: null,
  tmdbRating: 7.2,
  tmdbVotes: 500,
  runtime: 110,
  popularity: index % 100,
  altOptions: [],
  soloUpdate: false,
});
const showtime = (index, scale) => ({
  tmdbId: 9100000 + (index % scale),
  screeningCity: index % 3 === 0 ? "Jerusalem" : "Tel Aviv",
  dateOfShowing: `2026-11-${String(1 + (index % 30)).padStart(2, "0")}`,
  cinema: `Cinema ${index % 30}`,
  showtime: `${String(10 + (index % 12)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}`,
  englishHref: `https://tickets.example/en/${index}`,
  hebrewHref: `https://tickets.example/he/${index}`,
  screeningTech: index % 2 === 0 ? "IMAX" : "",
  screeningType: "",
  dubLanguage: null,
});

function delay(ms) {
  return ms > 0
    ? new Promise((resolve) => setTimeout(resolve, ms))
    : Promise.resolve();
}

function repository({ scale, delayMs }) {
  const nowPlaying = Array.from({ length: scale }, (_, index) =>
    movie(index, "nowPlaying"),
  );
  const comingSoon = Array.from({ length: scale }, (_, index) =>
    movie(index + scale, "comingSoon"),
  );
  const showtimes = Array.from({ length: scale }, (_, index) =>
    showtime(index, scale),
  );
  const theques = showtimes.map((row, index) => ({
    movie: nowPlaying[index],
    showtime: row,
  }));
  const counts = {
    revisionReads: 0,
    nowPlayingRows: 0,
    comingSoonRows: 0,
    movieCodes: 0,
    showtimeRows: 0,
    movieShowtimeRows: 0,
    cinemathequeRows: 0,
  };
  const repo = {
    revision: "1",
    rankingDate: "2026-11-17",
    counts,
    async readSnapshot(read, expected) {
      counts.revisionReads += 1;
      await delay(delayMs);
      if (expected !== undefined && expected !== this.revision)
        throw new Error("publication_changed");
      return read(this.revision, { rankingDate: this.rankingDate });
    },
    async findNowPlayingRows() {
      counts.nowPlayingRows += 1;
      await delay(delayMs);
      return nowPlaying;
    },
    async findComingSoonRows() {
      counts.comingSoonRows += 1;
      await delay(delayMs);
      return comingSoon;
    },
    async findMovieCodes(ids) {
      counts.movieCodes += 1;
      await delay(delayMs);
      return new Map(
        ids.map((id) => [
          id,
          (Number(id) % 46656).toString(36).padStart(3, "0"),
        ]),
      );
    },
    async findShowtimeRows() {
      counts.showtimeRows += 1;
      await delay(delayMs);
      return showtimes;
    },
    async findMovieShowtimeRows() {
      counts.movieShowtimeRows += 1;
      await delay(delayMs);
      return showtimes;
    },
    async findCinemathequeRows() {
      counts.cinemathequeRows += 1;
      await delay(delayMs);
      return theques;
    },
    async findTheaterCityRows() {
      await delay(delayMs);
      return [];
    },
    async findMovieCodeByCode() {
      await delay(delayMs);
      return null;
    },
    async findNowPlayingMovieById() {
      await delay(delayMs);
      return null;
    },
    async findComingSoonMovieById() {
      await delay(delayMs);
      return null;
    },
  };
  return repo;
}

function operation(name, repo, variant = 0) {
  switch (name) {
    case "catalog-now-playing":
      return () => getMovieCatalog(repo, "nowPlaying");
    case "catalog-coming-soon":
      return () => getMovieCatalog(repo, "comingSoon");
    case "showtimes-1-day":
      return () =>
        getShowtimeRange(repo, {
          city: "Jerusalem",
          startDate: "2026-11-17",
          endDate: "2026-11-17",
        });
    case "showtimes-7-days":
      return () =>
        getShowtimeRange(repo, {
          city: "Jerusalem",
          startDate: "2026-11-17",
          endDate: "2026-11-23",
        });
    case "showtimes-30-days":
      return () =>
        getShowtimeRange(repo, {
          city: variant ? `City ${variant}` : "Jerusalem",
          startDate: "2026-11-01",
          endDate: "2026-11-30",
        });
    case "movie-showtimes":
      return () => getMovieShowtimes(repo, "9100001", "2026-11-17");
    case "ticket-availability":
      return () =>
        getTicketAvailabilityShowtimes(repo, "9100001", "2026-11-17");
    case "cinematheques":
      return () =>
        getCinemathequeData(repo, {
          city: "Jerusalem",
          startDate: "2026-11-17",
          endDate: "2026-11-30",
        });
    default:
      throw new Error(`Unknown operation ${name}`);
  }
}

async function inSnapshot(repo, work) {
  return withPublicationSnapshot(repo, () => work());
}

function percentile(sorted, p) {
  return (
    sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0
  );
}

function summarize(samples, cpuUs, operations, counts) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    samples: samples.length,
    p50Ms: Number(percentile(sorted, 0.5).toFixed(3)),
    p95Ms: Number(percentile(sorted, 0.95).toFixed(3)),
    meanMs: Number(
      (samples.reduce((sum, value) => sum + value, 0) / samples.length).toFixed(
        3,
      ),
    ),
    cpuMsPerOperation: Number((cpuUs / 1000 / operations).toFixed(3)),
    queryCounts: counts,
  };
}

async function timed(operation) {
  const started = performance.now();
  await operation();
  return performance.now() - started;
}

async function benchmarkCase(name, scale, delayMs) {
  const coldTimes = [];
  const coldCounts = {};
  let coldCpu = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const repo = repository({ scale, delayMs });
    const cpuStart = process.cpuUsage();
    coldTimes.push(await timed(() => inSnapshot(repo, operation(name, repo))));
    const cpu = process.cpuUsage(cpuStart);
    coldCpu += cpu.user + cpu.system;
    for (const [key, value] of Object.entries(repo.counts))
      coldCounts[key] = (coldCounts[key] ?? 0) + value;
  }

  const hotRepo = repository({ scale, delayMs });
  await inSnapshot(hotRepo, operation(name, hotRepo));
  const hotStartCounts = structuredClone(hotRepo.counts);
  const hotTimes = [];
  const hotCpuStart = process.cpuUsage();
  for (let index = 0; index < warmSampleCount; index += 1)
    hotTimes.push(
      await timed(() => inSnapshot(hotRepo, operation(name, hotRepo))),
    );
  const hotCpu = process.cpuUsage(hotCpuStart);
  const hotQueryCounts = Object.fromEntries(
    Object.keys(hotRepo.counts).map((key) => [
      key,
      hotRepo.counts[key] - hotStartCounts[key],
    ]),
  );

  const revisionRepo = repository({ scale, delayMs });
  await inSnapshot(revisionRepo, operation(name, revisionRepo));
  revisionRepo.revision = "2";
  const revisionBefore = structuredClone(revisionRepo.counts);
  const revisionChangeMs = await timed(() =>
    inSnapshot(revisionRepo, operation(name, revisionRepo)),
  );
  const revisionQueries = Object.fromEntries(
    Object.keys(revisionRepo.counts).map((key) => [
      key,
      revisionRepo.counts[key] - revisionBefore[key],
    ]),
  );

  const dateRepo = repository({ scale, delayMs });
  await inSnapshot(dateRepo, operation(name, dateRepo));
  dateRepo.rankingDate = "2026-11-18";
  const dateBefore = structuredClone(dateRepo.counts);
  const dateChangeMs = await timed(() =>
    inSnapshot(dateRepo, operation(name, dateRepo)),
  );
  const dateQueries = Object.fromEntries(
    Object.keys(dateRepo.counts).map((key) => [
      key,
      dateRepo.counts[key] - dateBefore[key],
    ]),
  );

  const sameRepo = repository({ scale, delayMs });
  const sameStart = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, () =>
      inSnapshot(sameRepo, operation(name, sameRepo)),
    ),
  );
  const sameConcurrencyMs = performance.now() - sameStart;

  const distinctRepo = repository({ scale, delayMs });
  const distinctStart = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, (_, index) =>
      inSnapshot(
        distinctRepo,
        operation("showtimes-30-days", distinctRepo, index + 1),
      ),
    ),
  );
  const distinctConcurrencyMs = performance.now() - distinctStart;

  return {
    operation: name,
    rows: scale,
    simulatedDatabaseDelayMs: delayMs,
    cold: summarize(coldTimes, coldCpu, sampleCount, coldCounts),
    hot: summarize(
      hotTimes,
      hotCpu.user + hotCpu.system,
      warmSampleCount,
      hotQueryCounts,
    ),
    afterPublicationChange: {
      latencyMs: Number(revisionChangeMs.toFixed(3)),
      queryCounts: revisionQueries,
    },
    afterJerusalemDateChange: {
      latencyMs: Number(dateChangeMs.toFixed(3)),
      queryCounts: dateQueries,
    },
    concurrentIdentical: {
      requests: concurrency,
      elapsedMs: Number(sameConcurrencyMs.toFixed(3)),
      queryCounts: sameRepo.counts,
    },
    concurrentDistinct: {
      requests: concurrency,
      elapsedMs: Number(distinctConcurrencyMs.toFixed(3)),
      queryCounts: distinctRepo.counts,
    },
  };
}

const results = [];
for (const delayMs of databaseDelaysMs) {
  for (const scale of rowScales) {
    const names = [
      "catalog-now-playing",
      "catalog-coming-soon",
      "showtimes-1-day",
      "showtimes-7-days",
      "showtimes-30-days",
      "movie-showtimes",
      "ticket-availability",
      "cinematheques",
    ];
    for (const name of names)
      results.push(await benchmarkCase(name, scale, delayMs));
  }
}

const output = {
  benchmark: "public-data-preparation-cache",
  generatedAt: new Date().toISOString(),
  gitCommit: process.env.BENCH_GIT_COMMIT ?? null,
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  cpu: cpus()[0]?.model ?? "unknown",
  logicalCpus: cpus().length,
  methodology: {
    sampleCount,
    warmSampleCount,
    concurrency,
    rowScales,
    databaseDelaysMs,
    note: "Deterministic service-level benchmark with an in-memory repository and simulated DB latency. Cold means a fresh repository/cache in this process, not a fresh Vercel instance. Query counts verify cache behavior; production CDN/Fluid startup is not simulated.",
  },
  results,
};
const outputPath = process.argv[2];
if (!outputPath)
  throw new Error(
    "Usage: node packages/server/scripts/benchmark-public-data-preparation.mjs <output.json>",
  );
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(
  JSON.stringify({
    outputPath,
    cases: results.length,
    node: output.node,
    platform: output.platform,
    cpu: output.cpu,
  }),
);
