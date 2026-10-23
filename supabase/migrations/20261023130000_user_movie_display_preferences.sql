begin;

create table public.user_movie_display_preferences (
  user_id uuid not null references app_auth.users (id) on delete cascade,
  tmdb_id bigint not null,
  title text not null,
  release_year smallint,
  treatment text not null,
  hide_backdrop boolean not null default true,
  constraint user_movie_display_preferences_pkey primary key (user_id, tmdb_id),
  constraint user_movie_display_preferences_tmdb_id_check check (tmdb_id > 0),
  constraint user_movie_display_preferences_title_check check (
    length(btrim(title)) between 1 and 200
  ),
  constraint user_movie_display_preferences_release_year_check check (
    release_year is null or release_year between 1870 and 2200
  ),
  constraint user_movie_display_preferences_treatment_check check (
    treatment in ('standard', 'remove')
  )
);

comment on table public.user_movie_display_preferences is
  'Per-account display choices for movies selected from the TMDb title picker.';

alter table public.user_movie_display_preferences enable row level security;

revoke all on public.user_movie_display_preferences from public, anon, authenticated;
grant select on public.user_movie_display_preferences to kartiseret_runtime;
grant insert (user_id, tmdb_id, title, release_year, treatment, hide_backdrop),
  update (title, release_year, treatment, hide_backdrop), delete
  on public.user_movie_display_preferences to kartiseret_runtime;

create policy api_own_select on public.user_movie_display_preferences
  for select to kartiseret_runtime
  using (user_id = (select app_auth.current_user_id()));
create policy api_own_insert on public.user_movie_display_preferences
  for insert to kartiseret_runtime
  with check (user_id = (select app_auth.current_user_id()));
create policy api_own_update on public.user_movie_display_preferences
  for update to kartiseret_runtime
  using (user_id = (select app_auth.current_user_id()))
  with check (user_id = (select app_auth.current_user_id()));
create policy api_own_delete on public.user_movie_display_preferences
  for delete to kartiseret_runtime
  using (user_id = (select app_auth.current_user_id()));

commit;
