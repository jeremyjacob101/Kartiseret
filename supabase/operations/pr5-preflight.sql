-- Read-only. Run against the explicitly selected project before PR5 cutover.
WITH refs AS (
 SELECT user_id FROM public."userPreferences"
 UNION SELECT user_id FROM public.admin_users
 UNION SELECT user_id FROM public.ticket_alert_subscriptions
)
SELECT jsonb_build_object(
 'email_accounts', (SELECT count(*) FROM auth.users WHERE email IS NOT NULL AND btrim(email)<>''),
 'referenced_identities', (SELECT count(*) FROM refs),
 'unresolvable_references', (SELECT count(*) FROM refs r LEFT JOIN auth.users u ON u.id=r.user_id WHERE u.id IS NULL OR u.email IS NULL OR btrim(u.email)=''),
 'duplicate_normalized_emails', (SELECT count(*) FROM (SELECT lower(btrim(email)) FROM auth.users WHERE email IS NOT NULL AND btrim(email)<>'' GROUP BY 1 HAVING count(*)>1) duplicates),
 'provider_application_fks', (SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='f' AND confrelid='auth.users'::regclass),
 'application_auth_schema_exists', to_regnamespace('app_auth') IS NOT NULL,
 'custom_auth_triggers', (SELECT coalesce(jsonb_agg(jsonb_build_object('table',event_object_table,'trigger',trigger_name)),'[]'::jsonb) FROM information_schema.triggers WHERE trigger_schema IN ('public','auth')),
 'migrations', (SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations)
) AS preflight;
