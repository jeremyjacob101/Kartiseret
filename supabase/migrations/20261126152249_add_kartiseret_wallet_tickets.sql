begin;

create table public.user_wallet_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_auth.users (id) on delete cascade,
  tmdb_id bigint,
  title text not null,
  city text not null,
  cinema text not null,
  screening_date date not null,
  screening_time time(0) without time zone not null,
  qr_message text not null,
  reminder_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_wallet_tickets_tmdb_id_check check (tmdb_id is null or tmdb_id > 0),
  constraint user_wallet_tickets_title_check check (length(btrim(title)) between 1 and 200),
  constraint user_wallet_tickets_city_check check (length(btrim(city)) between 1 and 200),
  constraint user_wallet_tickets_cinema_check check (length(btrim(cinema)) between 1 and 200),
  constraint user_wallet_tickets_qr_message_check check (
    length(qr_message) between 1 and 2048 and octet_length(qr_message) <= 2048
  )
);

create index user_wallet_tickets_user_date_idx
  on public.user_wallet_tickets (user_id, screening_date, screening_time);

comment on table public.user_wallet_tickets is
  'Private, user-owned QR tickets imported for Kartiseret Wallet passes. QR payloads are credentials and must never be exposed in public responses or logs.';

alter table public.user_wallet_tickets enable row level security;
revoke all on public.user_wallet_tickets from public, anon, authenticated, service_role;
grant select on public.user_wallet_tickets to kartiseret_runtime;
-- Drizzle explicitly includes these server-owned columns with DEFAULT.
grant insert (id, user_id, tmdb_id, title, city, cinema, screening_date, screening_time, qr_message, reminder_enabled, created_at, updated_at)
  on public.user_wallet_tickets to kartiseret_runtime;
grant update (tmdb_id, title, city, cinema, screening_date, screening_time, qr_message, reminder_enabled, updated_at)
  on public.user_wallet_tickets to kartiseret_runtime;
grant delete on public.user_wallet_tickets to kartiseret_runtime;

create policy api_own_select on public.user_wallet_tickets
  for select to kartiseret_runtime
  using (user_id = (select app_auth.current_user_id()));
create policy api_own_insert on public.user_wallet_tickets
  for insert to kartiseret_runtime
  with check (user_id = (select app_auth.current_user_id()));
create policy api_own_update on public.user_wallet_tickets
  for update to kartiseret_runtime
  using (user_id = (select app_auth.current_user_id()))
  with check (user_id = (select app_auth.current_user_id()));
create policy api_own_delete on public.user_wallet_tickets
  for delete to kartiseret_runtime
  using (user_id = (select app_auth.current_user_id()));

create table public.user_wallet_recent_showtime_clicks (
  user_id uuid primary key references app_auth.users (id) on delete cascade,
  tmdb_id bigint not null,
  title text not null,
  city text not null,
  cinema text not null,
  screening_date date not null,
  screening_time time(0) without time zone not null,
  clicked_at timestamptz not null default now(),
  constraint user_wallet_recent_showtime_clicks_tmdb_id_check check (tmdb_id > 0)
);

comment on table public.user_wallet_recent_showtime_clicks is
  'One short-lived, latest-click screening suggestion per user; contains no href or ticket QR.';

alter table public.user_wallet_recent_showtime_clicks enable row level security;
revoke all on public.user_wallet_recent_showtime_clicks from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.user_wallet_recent_showtime_clicks to kartiseret_runtime;
create policy api_own_select on public.user_wallet_recent_showtime_clicks
  for select to kartiseret_runtime
  using (user_id = (select app_auth.current_user_id()));
create policy api_own_insert on public.user_wallet_recent_showtime_clicks
  for insert to kartiseret_runtime
  with check (user_id = (select app_auth.current_user_id()));
create policy api_own_update on public.user_wallet_recent_showtime_clicks
  for update to kartiseret_runtime
  using (user_id = (select app_auth.current_user_id()))
  with check (user_id = (select app_auth.current_user_id()));
create policy api_own_delete on public.user_wallet_recent_showtime_clicks
  for delete to kartiseret_runtime
  using (user_id = (select app_auth.current_user_id()));

commit;
