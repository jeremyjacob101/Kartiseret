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

The worker uses the existing production runtime database profile. Confirm `.env` has valid `PROD_DATABASE_URL` and `PROD_DATABASE_SSL_CA_CERT` values for the production Supabase project. The database user must be `kartiseret_api`, never the publisher login, and the connection must use verified TLS. The worker reads the revision inside an explicit read-only transaction.

On the scraper Mac, from the checkout that cron will use, run:

```sh
uv sync --locked
uv run --locked --no-sync python -m backend.config.cdn_cache_warmer --check-revision
mkdir -p "$HOME/Library/Logs/Kartiseret"
pwd
crontab -e
```

The revision check uses the configured production database and does not contact Vercel or change the saved revision. Add this single line to the scraper user's crontab, replacing the checkout path with the absolute path printed by `pwd`:

```cron
* * * * * "/absolute/path/to/checkout/backend/config/cdn_cache_warmer.sh" >> "$HOME/Library/Logs/Kartiseret/cdn-cache-warmer.log" 2>&1
```

The script starts one-shot runs at 0, 20, and 40 seconds. The worker skips overlapping runs using its lock and stores the revision at `~/.cache/kartiseret/cdn-cache-warmer-revision`. Check the entry with `crontab -l`. Remove the line with `crontab -e` to stop future batches. Keep the Mac awake for cron to run.

To run one immediate production cycle manually, use:

```sh
uv run --locked --no-sync python -m backend.config.cdn_cache_warmer --once
```

This can delete the `public-catalog` tag if the saved revision is absent or differs from the database. A successful cycle logs the HTTP status, `x-vercel-cache`, `x-vercel-id`, TTFB, and catalog revision. Compare the Vercel region in `x-vercel-id` with requests from Israel to confirm the worker warms the region your users reach.

## Expected request volume

At a 20-second cadence, the homepage warmer makes about 129,600 CDN requests per 30 days, plus the same number of small read-only revision queries. Cache hits avoid rendering the page in the function. They still count as CDN requests.
