# Public data preparation cache benchmark

## Compared builds

- Before: `349992e6d2eb082502734c46e7d04a19f6f51a27` (current `main` when the branch was created)
- After: `f01c6ac5` (cache implementation commit)
- Machine: Node `v24.22.2`, Apple M5, macOS arm64
- Samples: 15 cache misses and 50 warm calls per configuration; concurrency batches of 10

The raw per-configuration measurements are in [before.json](./before.json) and [after.json](./after.json).

## Method

The harness invokes the actual public-data service functions against a deterministic in-memory repository. It covers eight operations—now-playing and coming-soon catalogs, 1/7/30-day showtime ranges, movie showtimes, ticket availability, and cinematheques—at 100, 500, and 1,500 rows, with 0 ms and 5 ms simulated latency for each repository query. That gives 48 configurations. Each records p50, p95, mean latency, process CPU per operation, and query counts.

It also measures a new publication revision, a new Jerusalem calendar date, 10 concurrent identical requests, and 10 concurrent requests with distinct query arguments. `cold` means a cache miss in a new repository instance inside the already-running Node process. It does not measure Vercel process startup, real Supabase network latency, CDN behavior, or browser paint.

## Results

Across the 48 configurations, the median of each case's p50 was:

| Scenario | Before | After | Change |
| --- | ---: | ---: | ---: |
| Cache miss latency | 11.88 ms | 12.19 ms | +0.32 ms (+2.7%) |
| Warm cache-hit latency | 11.88 ms | 3.85 ms | −8.03 ms (−67.6%) |
| Cache-miss CPU per operation | 3.34 ms | 4.09 ms | +0.76 ms (+22.7%) |
| Warm cache-hit CPU per operation | 3.24 ms | 0.51 ms | −2.73 ms (−84.2%) |

The miss cost is the defensive copy and cache bookkeeping. It is small in wall time when repository calls have latency, but visible in CPU. In the 1,500-row group, median cache-miss p50 rose from 14.05 ms to 15.81 ms (+1.75 ms); warm p50 fell from 14.08 ms to 3.86 ms (−72.6%). With a 5 ms delay on each simulated repository call, median cache-miss p50 rose 0.29 ms, while warm p50 fell from 17.04 ms to 6.33 ms. The remaining warm latency includes the revision check, which is still performed on every request.

The largest cache-miss p50 increase in one configuration was 2.97 ms (1,500-row cinematheque result, no simulated DB delay). The largest p95 increase was 11.28 ms in the 1,500-row, 7-day showtime case with 5 ms simulated DB latency (20.85 ms before, 32.13 ms after). That p95 is based on only 15 samples and appears noisy; it needs a production-like rerun before drawing conclusions about tail latency.

The cache avoided all preparation queries on warm hits in every configuration, while each call still read the publication revision. Changing either the publication revision or Jerusalem date caused the expected preparation queries to run again. For 10 concurrent identical requests, the benchmark ran one preparation query per component after the change, versus 10 before; requests with distinct arguments remained separate.

## Interpretation and limits

This is a service-level microbenchmark, not evidence that production page TTFB will fall by a particular amount. The result supports the intended tradeoff when a process serves repeat requests for the same revision: a sub-millisecond median miss cost in aggregate cases, followed by substantially lower repeated latency and CPU. Cold function startup and real database round trips remain outside this benchmark. The request timing added by this change logs data preparation, cache activity, SSR rendering, assembly, and response completion so those can be measured in Vercel after the PR deploys.

Cache entries are process-local and bounded to 128 entries / 16 MiB per repository. The cache key includes the repeatable-read publication revision and the Jerusalem date. Entries become visible only after the owning database transaction commits; no existing response freshness window was changed.
