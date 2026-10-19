-- Emergency application rollback only. Run BEFORE serving the pre-PR4 client
-- after privilege retirement. Existing owner/admin RLS policies are retained;
-- restore only the privileges its observed browser queries need.
BEGIN;
GRANT SELECT, INSERT, UPDATE ON public."userPreferences" TO authenticated;
GRANT SELECT (user_id) ON public.admin_users TO authenticated;
GRANT INSERT (tmdb_id,title_fix) ON public."tableFixes" TO authenticated;
GRANT UPDATE, DELETE ON public."finalMovies",public."finalSoons" TO authenticated;
GRANT UPDATE (tmdb_id,english_title) ON public."finalShowtimes" TO authenticated;
GRANT SELECT (user_id,tmdb_id,created_at,notified_at,delivery_title,delivery_date), INSERT (user_id,tmdb_id) ON public.ticket_alert_subscriptions TO authenticated;
GRANT DELETE ON public.ticket_alert_subscriptions TO authenticated;
COMMIT;
