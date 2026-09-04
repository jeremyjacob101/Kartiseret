create table public.ticket_alert_guest_subscriptions (
  guest_token uuid not null,
  tmdb_id bigint not null,
  email text not null,
  preferred_city text not null default 'Jerusalem',
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  delivery_id uuid,
  delivery_title text,
  delivery_city text,
  delivery_date date,
  delivery_href text,
  delivery_movie_code text,
  delivery_attempts integer not null default 0,
  last_delivery_attempt_at timestamptz,
  last_delivery_error text,
  resend_email_id text,
  constraint ticket_alert_guest_subscriptions_pkey primary key (guest_token, tmdb_id),
  constraint ticket_alert_guest_subscriptions_tmdb_id_positive check (tmdb_id > 0),
  constraint ticket_alert_guest_subscriptions_email_format check (
    length(email) <= 320
    and email ~* '^[^[:space:]@<>()"''\\]+@[^[:space:]@<>()"''\\]+\.[^[:space:]@<>()"''\\]+$'
  ),
  constraint ticket_alert_guest_subscriptions_delivery_attempts_nonnegative check (
    delivery_attempts >= 0
  ),
  constraint ticket_alert_guest_subscriptions_movie_code_format check (
    delivery_movie_code is null
    or delivery_movie_code ~ '^[0-9A-Za-z]{3}$'
  )
);

comment on table public.ticket_alert_guest_subscriptions is
  'One-shot email requests from visitors who have not created a Kartiseret account.';
comment on column public.ticket_alert_guest_subscriptions.guest_token is
  'Random browser token kept in local storage; it is the bearer credential for guest alert management.';

create index ticket_alert_guest_subscriptions_pending_idx
  on public.ticket_alert_guest_subscriptions (created_at, guest_token)
  where notified_at is null;

create index ticket_alert_guest_subscriptions_delivery_retry_idx
  on public.ticket_alert_guest_subscriptions (delivery_id, guest_token)
  where notified_at is null and delivery_id is not null;

alter table public.ticket_alert_guest_subscriptions enable row level security;

revoke all on table public.ticket_alert_guest_subscriptions from public, anon, authenticated;

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

  insert into public.ticket_alert_guest_subscriptions (
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
  on conflict (guest_token, tmdb_id) do update
    set email = excluded.email,
        preferred_city = excluded.preferred_city,
        created_at = case
          when public.ticket_alert_guest_subscriptions.notified_at is null
            then public.ticket_alert_guest_subscriptions.created_at
          else now()
        end,
        notified_at = case
          when public.ticket_alert_guest_subscriptions.notified_at is null
            then public.ticket_alert_guest_subscriptions.notified_at
          else null
        end,
        delivery_id = case
          when public.ticket_alert_guest_subscriptions.notified_at is null
            then public.ticket_alert_guest_subscriptions.delivery_id
          else null
        end,
        delivery_title = case
          when public.ticket_alert_guest_subscriptions.notified_at is null
            then public.ticket_alert_guest_subscriptions.delivery_title
          else null
        end,
        delivery_city = case
          when public.ticket_alert_guest_subscriptions.notified_at is null
            then public.ticket_alert_guest_subscriptions.delivery_city
          else null
        end,
        delivery_date = case
          when public.ticket_alert_guest_subscriptions.notified_at is null
            then public.ticket_alert_guest_subscriptions.delivery_date
          else null
        end,
        delivery_href = case
          when public.ticket_alert_guest_subscriptions.notified_at is null
            then public.ticket_alert_guest_subscriptions.delivery_href
          else null
        end,
        delivery_movie_code = case
          when public.ticket_alert_guest_subscriptions.notified_at is null
            then public.ticket_alert_guest_subscriptions.delivery_movie_code
          else null
        end,
        delivery_attempts = case
          when public.ticket_alert_guest_subscriptions.notified_at is null
            then public.ticket_alert_guest_subscriptions.delivery_attempts
          else 0
        end,
        last_delivery_attempt_at = case
          when public.ticket_alert_guest_subscriptions.notified_at is null
            then public.ticket_alert_guest_subscriptions.last_delivery_attempt_at
          else null
        end,
        last_delivery_error = null,
        resend_email_id = case
          when public.ticket_alert_guest_subscriptions.notified_at is null
            then public.ticket_alert_guest_subscriptions.resend_email_id
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
declare
  deleted_count integer;
begin
  delete from public.ticket_alert_guest_subscriptions
   where guest_token = p_guest_token
     and tmdb_id = p_tmdb_id;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$function$;

create or replace function public.claim_guest_ticket_alert_delivery(
  p_guest_token uuid,
  p_delivery_id uuid,
  p_items jsonb
)
returns setof public.ticket_alert_guest_subscriptions
language sql
security definer
set search_path = ''
as $function$
  update public.ticket_alert_guest_subscriptions as subscription
     set delivery_id = p_delivery_id,
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
   where subscription.guest_token = p_guest_token
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

create or replace function public.record_guest_ticket_alert_delivery_attempt(
  p_guest_token uuid,
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
  update public.ticket_alert_guest_subscriptions
     set delivery_attempts = delivery_attempts + 1,
         last_delivery_attempt_at = now(),
         last_delivery_error = null
   where guest_token = p_guest_token
     and delivery_id = p_delivery_id
     and notified_at is null;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$function$;

revoke all on function public.create_guest_ticket_alert(uuid, bigint, text, text)
  from public, anon, authenticated;
revoke all on function public.cancel_guest_ticket_alert(uuid, bigint)
  from public, anon, authenticated;
revoke all on function public.claim_guest_ticket_alert_delivery(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.record_guest_ticket_alert_delivery_attempt(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.create_guest_ticket_alert(uuid, bigint, text, text)
  to anon, authenticated;
grant execute on function public.cancel_guest_ticket_alert(uuid, bigint)
  to anon, authenticated;
grant execute on function public.claim_guest_ticket_alert_delivery(uuid, uuid, jsonb)
  to service_role;
grant execute on function public.record_guest_ticket_alert_delivery_attempt(uuid, uuid)
  to service_role;

grant select (
  user_id,
  tmdb_id,
  created_at,
  notified_at,
  delivery_title,
  delivery_date
)
on public.ticket_alert_subscriptions to authenticated;
