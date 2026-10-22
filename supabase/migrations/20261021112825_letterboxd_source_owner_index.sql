begin;

create index letterboxd_source_films_source_user_idx
  on public.letterboxd_source_films (source_id, user_id);

commit;
