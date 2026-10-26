begin;

create table public.coming_soon_date_watches (
  user_id uuid not null references app_auth.users (id) on delete cascade,
  tmdb_id bigint not null,
  title text not null,
  release_year smallint,
  poster_path text,
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  delivery_id uuid,
  delivery_title text,
  delivery_date date,
  delivery_attempts integer not null default 0,
  last_delivery_attempt_at timestamptz,
  last_delivery_error text,
  resend_email_id text,
  constraint coming_soon_date_watches_pkey primary key (user_id, tmdb_id),
  constraint coming_soon_date_watches_tmdb_id_check check (tmdb_id > 0),
  constraint coming_soon_date_watches_title_check check (
    length(btrim(title)) between 1 and 200
  ),
  constraint coming_soon_date_watches_release_year_check check (
    release_year is null or release_year between 1870 and 2200
  ),
  constraint coming_soon_date_watches_poster_path_check check (
    poster_path is null or poster_path ~ '^/[A-Za-z0-9_./-]+$'
  ),
  constraint coming_soon_date_watches_delivery_attempts_check check (
    delivery_attempts >= 0
  )
);

comment on table public.coming_soon_date_watches is
  'Owner-scoped TMDb title watches for the local Coming Soon publication date; delivery state is separate from ticket alerts.';

alter table public.coming_soon_date_watches enable row level security;
revoke all on public.coming_soon_date_watches from public, anon, authenticated;

grant select (
  user_id, tmdb_id, title, release_year, poster_path, created_at,
  notified_at, delivery_title, delivery_date
) on public.coming_soon_date_watches to kartiseret_runtime;
grant insert (user_id, tmdb_id, title, release_year, poster_path)
  on public.coming_soon_date_watches to kartiseret_runtime;
grant delete on public.coming_soon_date_watches to kartiseret_runtime;

create policy api_own_select on public.coming_soon_date_watches
  for select to kartiseret_runtime
  using (user_id = (select app_auth.current_user_id()));
create policy api_own_insert on public.coming_soon_date_watches
  for insert to kartiseret_runtime
  with check (user_id = (select app_auth.current_user_id()));
create policy api_own_delete on public.coming_soon_date_watches
  for delete to kartiseret_runtime
  using (user_id = (select app_auth.current_user_id()));

grant select, update on public.coming_soon_date_watches to service_role;

commit;
