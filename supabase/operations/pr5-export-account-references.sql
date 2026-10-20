-- Operator-only backup, before cutover. Redirect into a private file OUTSIDE Git.
-- Includes personal account/reference data, but excludes provider hashes/tokens.
SELECT jsonb_build_object(
 'exported_at', now(),
 'identities', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'email',email,'email_verified',email_confirmed_at IS NOT NULL,'signup_location',raw_user_meta_data->>'signup_location')),'[]'::jsonb) FROM auth.users WHERE email IS NOT NULL AND btrim(email)<>''),
 'preferences', (SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) FROM public."userPreferences" p),
 'admin_memberships', (SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) FROM public.admin_users a),
 'subscriptions', (SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) FROM public.ticket_alert_subscriptions s)
) AS account_reference_backup;
