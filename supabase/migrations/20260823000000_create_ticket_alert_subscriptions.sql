create table public.ticket_alert_subscriptions (
  user_id uuid not null references auth.users (id) on delete cascade,
  tmdb_id bigint not null,
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
  constraint ticket_alert_subscriptions_pkey primary key (user_id, tmdb_id),
  constraint ticket_alert_subscriptions_tmdb_id_positive check (tmdb_id > 0),
  constraint ticket_alert_subscriptions_delivery_attempts_nonnegative check (
    delivery_attempts >= 0
  ),
  constraint ticket_alert_subscriptions_movie_code_format check (
    delivery_movie_code is null
    or delivery_movie_code ~ '^[0-9A-Za-z]{3}$'
  )
);

comment on table public.ticket_alert_subscriptions is
  'One-shot user requests for an email when a coming-soon movie gains a ticket link.';
comment on column public.ticket_alert_subscriptions.delivery_id is
  'Stable per-user delivery batch ID, also used as the Resend idempotency key.';
comment on column public.ticket_alert_subscriptions.delivery_href is
  'Ticket URL selected when the delivery batch was claimed.';

create index ticket_alert_subscriptions_pending_idx
  on public.ticket_alert_subscriptions (created_at, user_id)
  where notified_at is null;

create index ticket_alert_subscriptions_pending_movie_idx
  on public.ticket_alert_subscriptions (tmdb_id, user_id)
  where notified_at is null and delivery_id is null;

create index ticket_alert_subscriptions_delivery_retry_idx
  on public.ticket_alert_subscriptions (delivery_id, user_id)
  where notified_at is null and delivery_id is not null;

alter table public.ticket_alert_subscriptions enable row level security;

revoke all on table public.ticket_alert_subscriptions from public, anon, authenticated;
grant select (user_id, tmdb_id, created_at, notified_at)
  on table public.ticket_alert_subscriptions to authenticated;
grant insert (user_id, tmdb_id)
  on table public.ticket_alert_subscriptions to authenticated;
grant delete on table public.ticket_alert_subscriptions to authenticated;

create policy "Users can read their ticket alerts"
  on public.ticket_alert_subscriptions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their ticket alerts"
  on public.ticket_alert_subscriptions
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can cancel their ticket alerts"
  on public.ticket_alert_subscriptions
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

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
  update public.ticket_alert_subscriptions
  set
    delivery_attempts = delivery_attempts + 1,
    last_delivery_attempt_at = now(),
    last_delivery_error = null
  where user_id = p_user_id
    and delivery_id = p_delivery_id
    and notified_at is null;

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
