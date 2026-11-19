begin;

create table public.homepage_featured_weekly_lineups (
  week_start date primary key,
  now_playing_ids integer[] not null default '{}',
  coming_soon_ids integer[] not null default '{}',
  generated_at timestamptz not null default now(),
  constraint homepage_weekly_lineup_size check (
    cardinality(now_playing_ids) <= 40 and cardinality(coming_soon_ids) <= 40
  )
);

create table public.homepage_movie_highlights (
  tmdb_id integer primary key check (tmdb_id > 0),
  starts_on date not null,
  ends_on date not null,
  priority smallint not null default 0 check (priority between -100 and 100),
  label text check (label in ('kids', 'sci-fi', 'marvel')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint homepage_movie_highlight_date_range check (starts_on <= ends_on)
);

create index homepage_movie_highlights_active_dates
  on public.homepage_movie_highlights (starts_on, ends_on, priority desc)
  where enabled;

create table public.homepage_promotions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 120),
  body text not null check (length(btrim(body)) between 1 and 280),
  starts_on date not null,
  ends_on date not null,
  priority smallint not null default 0 check (priority between -100 and 100),
  cta_label text check (cta_label is null or length(btrim(cta_label)) between 1 and 60),
  cta_href text check (cta_href is null or length(btrim(cta_href)) between 1 and 2048),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint homepage_promotion_date_range check (starts_on <= ends_on),
  constraint homepage_promotion_cta_pair check ((cta_label is null) = (cta_href is null))
);

create index homepage_promotions_active_dates
  on public.homepage_promotions (starts_on, ends_on, priority desc)
  where enabled;

alter table public.homepage_featured_weekly_lineups enable row level security;
alter table public.homepage_movie_highlights enable row level security;
alter table public.homepage_promotions enable row level security;

revoke all on public.homepage_featured_weekly_lineups,
  public.homepage_movie_highlights, public.homepage_promotions
  from public, anon, authenticated;

grant select on public.homepage_featured_weekly_lineups,
  public.homepage_movie_highlights, public.homepage_promotions
  to kartiseret_runtime;
grant insert, update, delete on public.homepage_movie_highlights,
  public.homepage_promotions to kartiseret_runtime;
grant select, insert, update on public.homepage_featured_weekly_lineups to service_role;

create policy homepage_weekly_runtime_read
  on public.homepage_featured_weekly_lineups for select to kartiseret_runtime
  using (true);
create policy homepage_highlights_runtime_read
  on public.homepage_movie_highlights for select to kartiseret_runtime
  using (true);
create policy homepage_promotions_runtime_read
  on public.homepage_promotions for select to kartiseret_runtime
  using (true);

create policy homepage_highlights_admin_insert
  on public.homepage_movie_highlights for insert to kartiseret_runtime
  with check (exists (
    select 1 from public.admin_users
    where user_id = (select app_auth.current_user_id())
  ));
create policy homepage_highlights_admin_update
  on public.homepage_movie_highlights for update to kartiseret_runtime
  using (exists (
    select 1 from public.admin_users
    where user_id = (select app_auth.current_user_id())
  ))
  with check (exists (
    select 1 from public.admin_users
    where user_id = (select app_auth.current_user_id())
  ));
create policy homepage_highlights_admin_delete
  on public.homepage_movie_highlights for delete to kartiseret_runtime
  using (exists (
    select 1 from public.admin_users
    where user_id = (select app_auth.current_user_id())
  ));

create policy homepage_promotions_admin_insert
  on public.homepage_promotions for insert to kartiseret_runtime
  with check (exists (
    select 1 from public.admin_users
    where user_id = (select app_auth.current_user_id())
  ));
create policy homepage_promotions_admin_update
  on public.homepage_promotions for update to kartiseret_runtime
  using (exists (
    select 1 from public.admin_users
    where user_id = (select app_auth.current_user_id())
  ))
  with check (exists (
    select 1 from public.admin_users
    where user_id = (select app_auth.current_user_id())
  ));
create policy homepage_promotions_admin_delete
  on public.homepage_promotions for delete to kartiseret_runtime
  using (exists (
    select 1 from public.admin_users
    where user_id = (select app_auth.current_user_id())
  ));

comment on table public.homepage_featured_weekly_lineups is
  'Idempotently generated weekly candidate movie IDs for the homepage carousel.';
comment on table public.homepage_movie_highlights is
  'Admin scheduled movie highlights shown on the homepage carousel.';
comment on table public.homepage_promotions is
  'Admin scheduled cinema promotions shown on the homepage carousel.';

commit;
