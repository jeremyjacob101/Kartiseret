-- Run ONLY after PR4 is deployed and authenticated API acceptance succeeds.
-- This separate cutover preserves the old deployed client during additive prep.
-- Service-role grants/publication are deliberately retained for Python workers.
BEGIN;
REVOKE ALL ON public."userPreferences", public.admin_users, public."tableFixes", public.ticket_alert_subscriptions FROM anon, authenticated;
-- REVOKE ALL at table level does not remove pre-existing column grants.
REVOKE SELECT (user_id,tmdb_id,created_at,notified_at,delivery_title,delivery_date), INSERT (user_id,tmdb_id) ON public.ticket_alert_subscriptions FROM anon, authenticated;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public."finalMovies",public."finalSoons",public."finalShowtimes" FROM anon,authenticated;
COMMIT;
