-- Read-only acceptance after applying PR5 in the explicitly selected environment.
SELECT jsonb_build_object(
 'auth_tables_with_rls', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app_auth' AND c.relkind='r' AND c.relrowsecurity),
 'application_auth_fks', (SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='f' AND confrelid='app_auth.users'::regclass),
 'retired_provider_application_fks', (SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='f' AND confrelid='auth.users'::regclass),
 'anonymous_auth_schema_usage', has_schema_privilege('anon','app_auth','USAGE'),
 'browser_auth_schema_usage', has_schema_privilege('authenticated','app_auth','USAGE'),
 'worker_auth_schema_usage', has_schema_privilege('service_role','app_auth','USAGE'),
 'runtime_auth_schema_usage', has_schema_privilege('kartiseret_api','app_auth','USAGE'),
 'runtime_admin_membership_write', has_table_privilege('kartiseret_api','public.admin_users','INSERT'),
 'worker_alert_table_access', has_table_privilege('service_role','public.ticket_alert_subscriptions','SELECT,INSERT,UPDATE,DELETE'),
 'realtime_tables', (SELECT jsonb_agg(tablename ORDER BY tablename) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public'),
 'remaining_controlled_dev_accounts', (SELECT count(*) FROM app_auth.users WHERE email LIKE 'pr5-hosted-%@example.test'),
 'migrations', (SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations)
) AS postflight;
