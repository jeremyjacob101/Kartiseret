begin;

create table public.letterboxd_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_auth.users (id) on delete cascade,
  source_url text not null,
  source_type text not null,
  created_at timestamptz not null default now(),
  last_sync_attempt_at timestamptz,
  last_successful_sync_at timestamptz,
  last_sync_error text,
  film_count integer not null default 0,
  matched_film_count integer not null default 0,
  constraint letterboxd_sources_source_type_check
    check (source_type in ('watchlist', 'list')),
  constraint letterboxd_sources_url_check check (
    source_url ~ '^https://letterboxd\.com/[A-Za-z0-9_-]+/(watchlist|list/[A-Za-z0-9_-]+)/$'
  ),
  constraint letterboxd_sources_film_counts_check check (
    film_count >= 0 and matched_film_count >= 0 and matched_film_count <= film_count
  ),
  constraint letterboxd_sources_user_source_url_key unique (user_id, source_url),
  constraint letterboxd_sources_id_user_id_key unique (id, user_id)
);

create table public.letterboxd_source_films (
  source_id uuid not null,
  user_id uuid not null references app_auth.users (id) on delete cascade,
  letterboxd_slug text not null,
  title text not null,
  release_year smallint,
  tmdb_id bigint,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  removed_at timestamptz,
  needs_baseline boolean not null default true,
  constraint letterboxd_source_films_pkey primary key (source_id, letterboxd_slug),
  constraint letterboxd_source_films_source_user_fkey
    foreign key (source_id, user_id)
    references public.letterboxd_sources (id, user_id) on delete cascade,
  constraint letterboxd_source_films_slug_check check (
    letterboxd_slug ~ '^[A-Za-z0-9_-]{1,180}$'
  ),
  constraint letterboxd_source_films_title_check check (
    length(btrim(title)) between 1 and 200
  ),
  constraint letterboxd_source_films_release_year_check check (
    release_year is null or release_year between 1870 and 2200
  ),
  constraint letterboxd_source_films_tmdb_id_check check (
    tmdb_id is null or tmdb_id > 0
  )
);

create table public.letterboxd_event_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_auth.users (id) on delete cascade,
  tmdb_id bigint not null,
  event_key text not null,
  event_type text not null,
  event_payload jsonb not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  delivery_id uuid,
  delivery_attempts integer not null default 0,
  last_delivery_attempt_at timestamptz,
  last_delivery_error text,
  notified_at timestamptz,
  resend_email_id text,
  constraint letterboxd_event_alerts_user_event_key unique (user_id, event_key),
  constraint letterboxd_event_alerts_tmdb_id_check check (tmdb_id > 0),
  constraint letterboxd_event_alerts_event_key_check check (
    event_key ~ '^[a-f0-9]{64}$'
  ),
  constraint letterboxd_event_alerts_type_check check (
    event_type in ('coming_soon', 'showtime')
  ),
  constraint letterboxd_event_alerts_payload_check check (
    jsonb_typeof(event_payload) = 'object'
  ),
  constraint letterboxd_event_alerts_status_check check (
    status in ('pending', 'suppressed', 'sent', 'cancelled')
  ),
  constraint letterboxd_event_alerts_delivery_attempts_check check (
    delivery_attempts >= 0
  ),
  constraint letterboxd_event_alerts_sent_at_check check (
    (status = 'sent') = (notified_at is not null)
  )
);

alter table public.letterboxd_sources enable row level security;
alter table public.letterboxd_source_films enable row level security;
alter table public.letterboxd_event_alerts enable row level security;

revoke all on public.letterboxd_sources, public.letterboxd_source_films,
  public.letterboxd_event_alerts from public, anon, authenticated;

grant select (
  id, user_id, source_url, source_type, created_at, last_sync_attempt_at,
  last_successful_sync_at, last_sync_error, film_count, matched_film_count
) on public.letterboxd_sources to kartiseret_runtime;
grant insert (user_id, source_url, source_type)
  on public.letterboxd_sources to kartiseret_runtime;
grant delete on public.letterboxd_sources to kartiseret_runtime;

create policy api_own_select on public.letterboxd_sources
  for select to kartiseret_runtime
  using (user_id = (select app_auth.current_user_id()));
create policy api_own_insert on public.letterboxd_sources
  for insert to kartiseret_runtime
  with check (user_id = (select app_auth.current_user_id()));
create policy api_own_delete on public.letterboxd_sources
  for delete to kartiseret_runtime
  using (user_id = (select app_auth.current_user_id()));

grant all on public.letterboxd_sources, public.letterboxd_source_films,
  public.letterboxd_event_alerts to service_role;

create index letterboxd_sources_user_created_idx
  on public.letterboxd_sources (user_id, created_at desc);
create index letterboxd_source_films_active_user_tmdb_idx
  on public.letterboxd_source_films (user_id, tmdb_id)
  where removed_at is null and tmdb_id is not null;
create index letterboxd_source_films_baseline_idx
  on public.letterboxd_source_films (user_id, tmdb_id)
  where removed_at is null and tmdb_id is not null and needs_baseline;
create index letterboxd_event_alerts_pending_idx
  on public.letterboxd_event_alerts (user_id, created_at)
  where status = 'pending';
create index letterboxd_event_alerts_retry_idx
  on public.letterboxd_event_alerts (delivery_id, user_id)
  where status = 'pending' and delivery_id is not null;

create or replace function app_auth.cancel_letterboxd_alerts_without_active_source()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_user_id uuid;
  target_tmdb_id bigint;
begin
  if tg_op = 'UPDATE' then
    if old.removed_at is not null or new.removed_at is null then
      return new;
    end if;
    target_user_id := new.user_id;
    target_tmdb_id := new.tmdb_id;
  else
    target_user_id := old.user_id;
    target_tmdb_id := old.tmdb_id;
  end if;

  if target_tmdb_id is not null and not exists (
    select 1 from public.letterboxd_source_films active
    where active.user_id = target_user_id
      and active.tmdb_id = target_tmdb_id
      and active.removed_at is null
  ) then
    update public.letterboxd_event_alerts
    set status = 'cancelled',
        delivery_id = null,
        last_delivery_error = null
    where user_id = target_user_id
      and tmdb_id = target_tmdb_id
      and status = 'pending'
      and notified_at is null;
  end if;

  return null;
end;
$$;

revoke all on function app_auth.cancel_letterboxd_alerts_without_active_source()
  from public, anon, authenticated;
grant execute on function app_auth.cancel_letterboxd_alerts_without_active_source()
  to kartiseret_runtime, service_role;

create trigger letterboxd_source_films_cancel_pending_after_remove
after update of removed_at or delete on public.letterboxd_source_films
for each row execute function app_auth.cancel_letterboxd_alerts_without_active_source();

comment on table public.letterboxd_sources is
  'Owner-scoped public Letterboxd watchlist or list URLs; the backend syncs public pages without user credentials.';
comment on table public.letterboxd_source_films is
  'Latest film membership snapshot for public Letterboxd sources, including first-seen baselines.';
comment on table public.letterboxd_event_alerts is
  'Source-generated date and future ticket event alert ledger, separate from manually created watches.';

commit;
