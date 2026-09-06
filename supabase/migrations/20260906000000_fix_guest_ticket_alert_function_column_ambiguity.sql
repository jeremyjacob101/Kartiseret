-- The original guest-alert creation function exposes an output column named
-- guest_token. In PL/pgSQL, `ON CONFLICT (guest_token, tmdb_id)` can therefore
-- be resolved as either an output variable or a table column. Use the named
-- primary-key constraint and explicit table aliases throughout the guest RPCs.

create or replace function public.create_guest_ticket_alert(
  p_guest_token uuid,
  p_tmdb_id bigint,
  p_email text,
  p_preferred_city text default 'Jerusalem'
)
returns table (
  guest_token uuid,
  tmdb_id bigint,
  email text,
  preferred_city text,
  created_at timestamptz,
  notified_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict error
declare
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  normalized_city text := btrim(coalesce(p_preferred_city, ''));
begin
  if p_guest_token is null then
    raise exception 'A guest ticket alert token is required.' using errcode = '22023';
  end if;
  if p_tmdb_id is null or p_tmdb_id <= 0 then
    raise exception 'A valid movie is required.' using errcode = '22023';
  end if;
  if length(normalized_email) > 320
    or normalized_email !~* '^[^[:space:]@<>()"''\\]+@[^[:space:]@<>()"''\\]+\.[^[:space:]@<>()"''\\]+$' then
    raise exception 'A valid email address is required.' using errcode = '22023';
  end if;
  if normalized_city = '' then
    normalized_city := 'Jerusalem';
  end if;

  insert into public.ticket_alert_guest_subscriptions as subscription (
    guest_token,
    tmdb_id,
    email,
    preferred_city
  ) values (
    p_guest_token,
    p_tmdb_id,
    normalized_email,
    normalized_city
  )
  on conflict on constraint ticket_alert_guest_subscriptions_pkey do update
    set email = excluded.email,
        preferred_city = excluded.preferred_city,
        created_at = case
          when subscription.notified_at is null
            then subscription.created_at
          else now()
        end,
        notified_at = case
          when subscription.notified_at is null
            then subscription.notified_at
          else null
        end,
        delivery_id = case
          when subscription.notified_at is null
            then subscription.delivery_id
          else null
        end,
        delivery_title = case
          when subscription.notified_at is null
            then subscription.delivery_title
          else null
        end,
        delivery_city = case
          when subscription.notified_at is null
            then subscription.delivery_city
          else null
        end,
        delivery_date = case
          when subscription.notified_at is null
            then subscription.delivery_date
          else null
        end,
        delivery_href = case
          when subscription.notified_at is null
            then subscription.delivery_href
          else null
        end,
        delivery_movie_code = case
          when subscription.notified_at is null
            then subscription.delivery_movie_code
          else null
        end,
        delivery_attempts = case
          when subscription.notified_at is null
            then subscription.delivery_attempts
          else 0
        end,
        last_delivery_attempt_at = case
          when subscription.notified_at is null
            then subscription.last_delivery_attempt_at
          else null
        end,
        last_delivery_error = null,
        resend_email_id = case
          when subscription.notified_at is null
            then subscription.resend_email_id
          else null
        end;

  return query
    select subscription.guest_token,
           subscription.tmdb_id,
           subscription.email,
           subscription.preferred_city,
           subscription.created_at,
           subscription.notified_at
      from public.ticket_alert_guest_subscriptions as subscription
     where subscription.guest_token = p_guest_token
       and subscription.tmdb_id = p_tmdb_id;
end;
$function$;

create or replace function public.cancel_guest_ticket_alert(
  p_guest_token uuid,
  p_tmdb_id bigint
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict error
declare
  deleted_count integer;
begin
  delete from public.ticket_alert_guest_subscriptions as subscription
   where subscription.guest_token = p_guest_token
     and subscription.tmdb_id = p_tmdb_id;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$function$;

create or replace function public.record_guest_ticket_alert_delivery_attempt(
  p_guest_token uuid,
  p_delivery_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict error
declare
  updated_count integer;
begin
  update public.ticket_alert_guest_subscriptions as subscription
     set delivery_attempts = subscription.delivery_attempts + 1,
         last_delivery_attempt_at = now(),
         last_delivery_error = null
   where subscription.guest_token = p_guest_token
     and subscription.delivery_id = p_delivery_id
     and subscription.notified_at is null;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$function$;

revoke all on function public.create_guest_ticket_alert(uuid, bigint, text, text)
  from public, anon, authenticated;
revoke all on function public.cancel_guest_ticket_alert(uuid, bigint)
  from public, anon, authenticated;
revoke all on function public.record_guest_ticket_alert_delivery_attempt(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.create_guest_ticket_alert(uuid, bigint, text, text)
  to anon, authenticated;
grant execute on function public.cancel_guest_ticket_alert(uuid, bigint)
  to anon, authenticated;
grant execute on function public.record_guest_ticket_alert_delivery_attempt(uuid, uuid)
  to service_role;
