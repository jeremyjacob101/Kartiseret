-- Additive preparation: safe to apply before the PR4 application deployment.
-- Runtime identity is set with SET LOCAL inside one Drizzle transaction.
-- Existing rows retain their choices; only newly created trigger/default rows
-- receive signup-location initialization once.
ALTER TABLE public."userPreferences" ADD COLUMN signup_initialized boolean NOT NULL DEFAULT true;
ALTER TABLE public."userPreferences" ALTER COLUMN signup_initialized SET DEFAULT false;
GRANT USAGE ON SCHEMA auth TO kartiseret_runtime;
GRANT SELECT (user_id) ON public.admin_users TO kartiseret_runtime;
GRANT SELECT, INSERT, UPDATE ON public."userPreferences" TO kartiseret_runtime;
GRANT SELECT (user_id,tmdb_id,created_at,notified_at,delivery_title,delivery_date), INSERT (user_id,tmdb_id) ON public.ticket_alert_subscriptions TO kartiseret_runtime;
GRANT DELETE ON public.ticket_alert_subscriptions TO kartiseret_runtime;
GRANT INSERT (tmdb_id,title_fix) ON public."tableFixes" TO kartiseret_runtime;
GRANT UPDATE (tmdb_id,solo_update,english_title,release_year,en_poster,backdrop,en_trailer,genres,runtime,imdb_id,"imdbRating","imdbVotes",rt_id,"rtCriticRating","rtCriticVotes","rtAudienceRating","rtAudienceVotes",lb_id,"lbRating","lbVotes","tmdbRating","tmdbVotes",popularity), DELETE ON public."finalMovies" TO kartiseret_runtime;
GRANT UPDATE (tmdb_id,solo_update,english_title,release_year,en_poster,backdrop,en_trailer,genres,runtime), DELETE ON public."finalSoons" TO kartiseret_runtime;
GRANT UPDATE (tmdb_id,english_title) ON public."finalShowtimes" TO kartiseret_runtime;
CREATE POLICY api_admin_own ON public.admin_users FOR SELECT TO kartiseret_runtime USING (user_id = (SELECT auth.uid()));
CREATE POLICY api_own_select ON public."userPreferences" FOR SELECT TO kartiseret_runtime USING (user_id = (SELECT auth.uid()));
CREATE POLICY api_own_insert ON public."userPreferences" FOR INSERT TO kartiseret_runtime WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY api_own_update ON public."userPreferences" FOR UPDATE TO kartiseret_runtime USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY api_own_select ON public."ticket_alert_subscriptions" FOR SELECT TO kartiseret_runtime USING (user_id = (SELECT auth.uid()));
CREATE POLICY api_own_insert ON public."ticket_alert_subscriptions" FOR INSERT TO kartiseret_runtime WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY api_own_delete ON public."ticket_alert_subscriptions" FOR DELETE TO kartiseret_runtime USING (user_id = (SELECT auth.uid()));
CREATE POLICY api_admin_update ON public."finalMovies" FOR UPDATE TO kartiseret_runtime USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT auth.uid()))) WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT auth.uid())));
CREATE POLICY api_admin_delete ON public."finalMovies" FOR DELETE TO kartiseret_runtime USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT auth.uid())));
CREATE POLICY api_admin_update ON public."finalSoons" FOR UPDATE TO kartiseret_runtime USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT auth.uid()))) WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT auth.uid())));
CREATE POLICY api_admin_delete ON public."finalSoons" FOR DELETE TO kartiseret_runtime USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT auth.uid())));
CREATE POLICY api_admin_update ON public."finalShowtimes" FOR UPDATE TO kartiseret_runtime USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT auth.uid()))) WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT auth.uid())));
CREATE POLICY api_admin_insert ON public."tableFixes" FOR INSERT TO kartiseret_runtime WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT auth.uid())));
