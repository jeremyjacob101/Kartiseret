create index coming_soon_date_watches_pending_idx
  on public.coming_soon_date_watches (created_at, user_id, tmdb_id)
  where notified_at is null;

create index coming_soon_date_watches_retry_idx
  on public.coming_soon_date_watches (delivery_id, user_id)
  where notified_at is null and delivery_id is not null;
