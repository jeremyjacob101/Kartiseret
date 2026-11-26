# Production CDN cache warmer

The production homepage is cached in Vercel for five minutes, with up to five minutes of stale-while-revalidate. Public SEO pages and the sitemap share the `public-catalog` cache tag. The worker on the scraper Mac checks the production catalog revision every 20 seconds. When it changes, the worker deletes that Vercel cache tag and requests the homepage to refill the cache.

The worker warms only `https://seret.site/`. Other tagged pages refresh on demand after a publication and use the same five-minute cache policy. Cached public pages reduce their cache lifetime around the 1:05 a.m. Israel cinema-day boundary. Signed-in pages remain uncached.

## Vercel setup

Deploy the code to the production Vercel project so it begins returning the public cache headers and tag. No Vercel environment variables, cron jobs, routing changes, or dashboard cache settings are required.

Create a Vercel access token that can manage the production project's CDN cache. Find the production project ID and team ID in Vercel project/team settings. Add these machine-local values to the scraper Mac's ignored `.env` file:

```dotenv
VERCEL_API_TOKEN=your-token
VERCEL_PROJECT_ID=prj_your-production-project-id
VERCEL_TEAM_ID=team_your-team-id
```

Keep the token on the machine only. Do not add it to the Vercel project's environment variables or commit it.

## Scraper Mac setup

The worker uses the existing production runtime database profile. Confirm `.env` has valid `PROD_DATABASE_URL` and `PROD_DATABASE_SSL_CA_CERT` values for the production Supabase project. The database user must be `kartiseret_api`, never the publisher login, and the connection must use verified TLS. The worker sets each PostgreSQL session to read-only before querying the revision.

From the repository checkout that the machine keeps updated, install and start the LaunchAgent:

```sh
./backend/config/cdn_cache_warmer.sh install
```

The installer syncs the locked Python environment, validates required configuration, and registers a user LaunchAgent that runs at login and restarts if it exits. The worker state is stored at `~/.cache/kartiseret/cdn-cache-warmer-revision`. Logs are written to `~/Library/Logs/Kartiseret/cdn-cache-warmer.log`.

Check or stop it with:

```sh
./backend/config/cdn_cache_warmer.sh status
./backend/config/cdn_cache_warmer.sh stop
```

Start it again with `./backend/config/cdn_cache_warmer.sh start`. Remove the LaunchAgent with `./backend/config/cdn_cache_warmer.sh uninstall`. Uninstall keeps the logs and saved revision state.

To run one immediate production cycle manually, use:

```sh
uv run --locked --no-sync python -m backend.config.cdn_cache_warmer --once
```

This can delete the `public-catalog` tag if the saved revision is absent or differs from the database. A successful cycle logs the HTTP status, `x-vercel-cache`, `x-vercel-id`, TTFB, and catalog revision. Compare the Vercel region in `x-vercel-id` with requests from Israel to confirm the worker warms the region your users reach.

## Expected request volume

At a 20-second cadence, the homepage warmer makes about 129,600 CDN requests per 30 days, plus the same number of small read-only revision queries. Cache hits avoid rendering the page in the function. They still count as CDN requests.
