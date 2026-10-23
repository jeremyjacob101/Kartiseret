begin;

alter table public.letterboxd_sources
  drop constraint letterboxd_sources_url_check;

alter table public.letterboxd_sources
  add constraint letterboxd_sources_url_check check (
    source_url ~ '^https://letterboxd\.com/[A-Za-z0-9_-]+/(watchlist|list/[A-Za-z0-9_-]+)(/share/[A-Za-z0-9_-]+)?/$'
    or source_url ~ '^https://boxd\.it/[A-Za-z0-9]+[$][A-Za-z0-9_-]+/$'
  );

commit;
