-- Coordinated PR5 auth cutover. Apply only during the reviewed release window.
-- Import identity records only: no provider password hashes or sessions.
BEGIN;
CREATE SCHEMA app_auth;
REVOKE ALL ON SCHEMA app_auth FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA app_auth TO kartiseret_runtime;
CREATE TABLE app_auth.users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
 email text NOT NULL UNIQUE, email_verified boolean NOT NULL DEFAULT false,
 image text, signup_location varchar(200),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app_auth.sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token text NOT NULL UNIQUE,
 user_id uuid NOT NULL REFERENCES app_auth.users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), ip_address text, user_agent text
);
CREATE INDEX sessions_user_id_idx ON app_auth.sessions(user_id);
CREATE TABLE app_auth.accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id text NOT NULL, provider_id text NOT NULL,
 user_id uuid NOT NULL REFERENCES app_auth.users(id) ON DELETE CASCADE,
 access_token text, refresh_token text, id_token text,
 access_token_expires_at timestamptz, refresh_token_expires_at timestamptz,
 scope text, password text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX accounts_user_id_idx ON app_auth.accounts(user_id);
CREATE UNIQUE INDEX accounts_provider_account_idx ON app_auth.accounts(provider_id,account_id);
CREATE TABLE app_auth.verifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), identifier text NOT NULL, value text NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verifications_identifier_idx ON app_auth.verifications(identifier);
CREATE TABLE app_auth.rate_limits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key text NOT NULL UNIQUE,
 count integer NOT NULL, last_request bigint NOT NULL
);
DO $guard$
BEGIN
 IF EXISTS (
   SELECT 1 FROM (SELECT user_id FROM public."userPreferences" UNION SELECT user_id FROM public.admin_users UNION SELECT user_id FROM public.ticket_alert_subscriptions) r
   LEFT JOIN auth.users u ON u.id=r.user_id WHERE u.id IS NULL OR u.email IS NULL OR btrim(u.email)=''
 ) THEN RAISE EXCEPTION 'PR5 identity transition requires a canonical email for every referenced account'; END IF;
END $guard$;
INSERT INTO app_auth.users(id,name,email,email_verified,signup_location,created_at,updated_at)
 SELECT id,'Kartiseret member',lower(btrim(email)),email_confirmed_at IS NOT NULL,
 nullif(left(btrim(raw_user_meta_data->>'signup_location'),200),''),coalesce(created_at,now()),coalesce(updated_at,now())
 FROM auth.users WHERE email IS NOT NULL AND btrim(email)<>'';
ALTER TABLE public.admin_users DROP CONSTRAINT admin_users_user_id_fkey,
 ADD CONSTRAINT admin_users_user_id_fkey FOREIGN KEY(user_id) REFERENCES app_auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."userPreferences" DROP CONSTRAINT userpreferences_user_id_fkey,
 ADD CONSTRAINT userpreferences_user_id_fkey FOREIGN KEY(user_id) REFERENCES app_auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.ticket_alert_subscriptions DROP CONSTRAINT ticket_alert_subscriptions_user_id_fkey,
 ADD CONSTRAINT ticket_alert_subscriptions_user_id_fkey FOREIGN KEY(user_id) REFERENCES app_auth.users(id) ON DELETE CASCADE;
CREATE FUNCTION app_auth.current_user_id() RETURNS uuid LANGUAGE sql STABLE SET search_path='' AS $f$
 SELECT nullif(current_setting('app.user_id',true),'')::uuid
$f$;
REVOKE ALL ON FUNCTION app_auth.current_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_auth.current_user_id() TO kartiseret_runtime;
-- Remove the retired provider identity policies, including old browser policies.
DO $policies$
DECLARE p record;
BEGIN
 FOR p IN SELECT tablename,policyname FROM pg_policies WHERE schemaname='public' AND
   (coalesce(qual,'')||coalesce(with_check,'')) LIKE '%auth.uid%'
 LOOP EXECUTE format('DROP POLICY %I ON public.%I',p.policyname,p.tablename); END LOOP;
END $policies$;
CREATE POLICY api_admin_own ON public.admin_users FOR SELECT TO kartiseret_runtime USING (user_id = (SELECT app_auth.current_user_id()));
CREATE POLICY api_own_select ON public."userPreferences" FOR SELECT TO kartiseret_runtime USING (user_id = (SELECT app_auth.current_user_id()));
CREATE POLICY api_own_insert ON public."userPreferences" FOR INSERT TO kartiseret_runtime WITH CHECK (user_id = (SELECT app_auth.current_user_id()));
CREATE POLICY api_own_update ON public."userPreferences" FOR UPDATE TO kartiseret_runtime USING (user_id = (SELECT app_auth.current_user_id())) WITH CHECK (user_id = (SELECT app_auth.current_user_id()));
CREATE POLICY api_own_select ON public."ticket_alert_subscriptions" FOR SELECT TO kartiseret_runtime USING (user_id = (SELECT app_auth.current_user_id()));
CREATE POLICY api_own_insert ON public."ticket_alert_subscriptions" FOR INSERT TO kartiseret_runtime WITH CHECK (user_id = (SELECT app_auth.current_user_id()));
CREATE POLICY api_own_delete ON public."ticket_alert_subscriptions" FOR DELETE TO kartiseret_runtime USING (user_id = (SELECT app_auth.current_user_id()));
CREATE POLICY api_admin_update ON public."finalMovies" FOR UPDATE TO kartiseret_runtime USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT app_auth.current_user_id()))) WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT app_auth.current_user_id())));
CREATE POLICY api_admin_delete ON public."finalMovies" FOR DELETE TO kartiseret_runtime USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT app_auth.current_user_id())));
CREATE POLICY api_admin_update ON public."finalSoons" FOR UPDATE TO kartiseret_runtime USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT app_auth.current_user_id()))) WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT app_auth.current_user_id())));
CREATE POLICY api_admin_delete ON public."finalSoons" FOR DELETE TO kartiseret_runtime USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT app_auth.current_user_id())));
CREATE POLICY api_admin_update ON public."finalShowtimes" FOR UPDATE TO kartiseret_runtime USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT app_auth.current_user_id()))) WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT app_auth.current_user_id())));
CREATE POLICY api_admin_insert ON public."tableFixes" FOR INSERT TO kartiseret_runtime WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT app_auth.current_user_id())));
REVOKE ALL ON public.admin_users, public."userPreferences", public.ticket_alert_subscriptions FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA app_auth TO kartiseret_runtime;
DO $rls$
DECLARE table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['users','sessions','accounts','verifications','rate_limits'] LOOP
  EXECUTE format('ALTER TABLE app_auth.%I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('CREATE POLICY server_runtime ON app_auth.%I FOR ALL TO kartiseret_runtime USING (true) WITH CHECK (true)',table_name);
 END LOOP;
END $rls$;
COMMIT;
