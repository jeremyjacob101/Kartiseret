-- Restore the account-only batch operations removed by the guest-alert cleanup.
-- These functions keep claiming and attempt counting atomic for one user's
-- email batch while remaining inaccessible to browser-facing roles.

create or replace function public.claim_ticket_alert_delivery(
  p_user_id uuid,
  p_delivery_id uuid,
  p_items jsonb
)
returns setof public.ticket_alert_subscriptions
language sql
security definer
set search_path = ''
as $function$
  update public.ticket_alert_subscriptions as subscription
  set
    delivery_id = p_delivery_id,
    delivery_title = nullif(btrim(item.title), ''),
    delivery_city = nullif(btrim(item.city), ''),
    delivery_date = item.showing_date,
    delivery_href = nullif(btrim(item.ticket_href), ''),
    delivery_movie_code = nullif(btrim(item.movie_code), ''),
    last_delivery_error = null
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as item(
    tmdb_id bigint,
    title text,
    city text,
    showing_date date,
    ticket_href text,
    movie_code text
  )
  where subscription.user_id = p_user_id
    and subscription.tmdb_id = item.tmdb_id
    and subscription.notified_at is null
    and subscription.delivery_id is null
    and nullif(btrim(item.title), '') is not null
    and nullif(btrim(item.city), '') is not null
    and item.showing_date is not null
    and nullif(btrim(item.ticket_href), '') is not null
    and (
      item.movie_code is null
      or nullif(btrim(item.movie_code), '') is null
      or btrim(item.movie_code) ~ '^[0-9A-Za-z]{3}$'
    )
  returning subscription.*;
$function$;

create or replace function public.record_ticket_alert_delivery_attempt(
  p_user_id uuid,
  p_delivery_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  updated_count integer;
begin
  update public.ticket_alert_subscriptions as subscription
  set
    delivery_attempts = subscription.delivery_attempts + 1,
    last_delivery_attempt_at = now(),
    last_delivery_error = null
  where subscription.user_id = p_user_id
    and subscription.delivery_id = p_delivery_id
    and subscription.notified_at is null;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$function$;

revoke all on function public.claim_ticket_alert_delivery(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.record_ticket_alert_delivery_attempt(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_ticket_alert_delivery(uuid, uuid, jsonb)
  to service_role;
grant execute on function public.record_ticket_alert_delivery_attempt(uuid, uuid)
  to service_role;
