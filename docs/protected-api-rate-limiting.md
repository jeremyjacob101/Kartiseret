# Protected API rate limit

Protected account routes allow 600 requests per client IP in a fixed 60-second
window. The counter is shared through PostgreSQL, so it applies consistently to
Vercel instances. Public catalog and showtime endpoints are outside this quota.
People behind a shared public IP share the quota; 600 requests per minute leaves
room for normal enthusiast use, multiple tabs, and watchlist editing.

The limiter is best-effort. If its client IP is unavailable or PostgreSQL cannot
update the counter, the server logs a sanitized diagnostic and continues to
session verification and normal authorization. It never skips authentication.
Better Auth's separate authentication rate limit is unchanged.

Apply `supabase/migrations/20261026132720_protected_api_rate_limits.sql` to the
target database before deploying the application change. The application role
alone can access the new table; browser roles receive no table privileges.
Counters are HMAC keyed, window values use PostgreSQL time, and expired rows are
removed in bounded batches after they have been expired for 24 hours.
