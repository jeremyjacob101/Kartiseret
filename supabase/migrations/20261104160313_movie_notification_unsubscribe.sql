begin;

-- Bearer secrets are kept as SHA-256 digests. The plaintext is returned only
-- once by the authenticated internal API and is stored in the immutable email
-- snapshot by the worker.
create table app_auth.movie_notification_unsubscribe_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_auth.users(id) on delete cascade,
  delivery_id uuid not null references public.movie_notification_deliveries(id) on delete cascade,
  purpose text not null check (purpose in ('manage_letterboxd', 'one_click_all')),
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  consumed_at timestamptz,
  unique (delivery_id, purpose),
  check (expires_at > created_at)
);
alter table app_auth.movie_notification_unsubscribe_tokens enable row level security;
revoke all on app_auth.movie_notification_unsubscribe_tokens
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on app_auth.movie_notification_unsubscribe_tokens
  to kartiseret_runtime;
create policy notification_unsubscribe_runtime
  on app_auth.movie_notification_unsubscribe_tokens
  for all to kartiseret_runtime using (true) with check (true);
create index movie_notification_unsubscribe_user_idx
  on app_auth.movie_notification_unsubscribe_tokens (user_id, purpose)
  where revoked_at is null;

create function app_auth.movie_notification_delivery_has_letterboxd_support(
  p_user_id uuid,
  p_delivery_id uuid
)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare eligible boolean;
begin
  if not exists (
    select 1 from public.movie_notification_deliveries d
    where d.id = p_delivery_id and d.user_id = p_user_id and d.status = 'pending'
  ) then return false; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('movie-notification-queue', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('movie-notifications:' || p_user_id::text, 0)
  );

  select exists (
    select 1
    from public.movie_notification_deliveries d
    cross join lateral pg_catalog.jsonb_array_elements(d.events) e
    join public.letterboxd_source_films f
      on f.user_id = d.user_id
      and f.tmdb_id = (e.value->>'tmdb_id')::bigint
      and f.removed_at is null
    where d.id = p_delivery_id and d.user_id = p_user_id and d.status = 'pending'
  ) into eligible;
  return coalesce(eligible, false);
end;
$$;

-- Serialize the final delivery start with unsubscribe operations and queue
-- reconciliation. An accepted provider request cannot be recalled afterward.
create or replace function public.start_movie_notification_delivery(
  p_delivery uuid,
  p_snapshot jsonb
)
returns setof public.movie_notification_deliveries
language plpgsql security definer set search_path = pg_catalog, public as $$
declare account_id uuid;
begin
  select d.user_id into account_id
  from public.movie_notification_deliveries d where d.id = p_delivery;
  if account_id is null then return; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('movie-notification-queue', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('movie-notifications:' || account_id::text, 0)
  );

  update public.movie_notification_deliveries
  set status = 'cancelled', last_error = 'Unconfirmed delivery exceeded safe retry window'
  where id = p_delivery and status = 'pending'
    and first_attempt_at < statement_timestamp() - interval '23 hours';
  if found then
    update public.movie_notification_events
    set status = 'suppressed'
    where delivery_id = p_delivery and status = 'pending';
    return;
  end if;

  return query
  update public.movie_notification_deliveries
  set attempts = attempts + 1,
      first_attempt_at = coalesce(first_attempt_at, statement_timestamp()),
      email_snapshot = coalesce(email_snapshot, p_snapshot)
  where id = p_delivery and user_id = account_id and status = 'pending'
  returning *;
end;
$$;

create function app_auth.movie_notification_unsubscribe_sources(p_token_hash bytea)
returns table (id uuid, source_url text, source_type text)
language plpgsql security definer set search_path = '' as $$
declare account_id uuid;
begin
  select t.user_id into account_id
  from app_auth.movie_notification_unsubscribe_tokens t
  where t.token_hash = p_token_hash
    and t.purpose = 'manage_letterboxd'
    and t.expires_at > statement_timestamp()
    and t.revoked_at is null;
  if account_id is null then
    raise exception 'invalid unsubscribe token' using errcode = '22023';
  end if;
  return query
    select s.id, s.source_url, s.source_type
    from public.letterboxd_sources s
    where s.user_id = account_id
    order by s.created_at, s.id;
end;
$$;

create function app_auth.remove_movie_notification_letterboxd_sources(
  p_token_hash bytea,
  p_source_ids uuid[]
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare account_id uuid; result jsonb;
begin
  select t.user_id into account_id
  from app_auth.movie_notification_unsubscribe_tokens t
  where t.token_hash = p_token_hash
    and t.purpose = 'manage_letterboxd'
    and t.expires_at > statement_timestamp()
    and t.revoked_at is null;
  if account_id is null then
    raise exception 'invalid unsubscribe token' using errcode = '22023';
  end if;
  if p_source_ids is null or cardinality(p_source_ids) < 1 or cardinality(p_source_ids) > 50 then
    raise exception 'invalid source selection' using errcode = '22023';
  end if;

  -- Match queue_movie_notifications lock ordering so a stale collection cannot
  -- reinsert work while these sources and watches are being removed.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('movie-notification-queue', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('movie-notifications:' || account_id::text, 0)
  );

  -- Recheck after taking the account lock. A preceding all-alerts unsubscribe
  -- revokes this token while holding the same lock.
  select t.user_id into account_id
  from app_auth.movie_notification_unsubscribe_tokens t
  where t.token_hash = p_token_hash
    and t.purpose = 'manage_letterboxd'
    and t.expires_at > statement_timestamp()
    and t.revoked_at is null
  for update;
  if account_id is null then
    raise exception 'invalid unsubscribe token' using errcode = '22023';
  end if;

  -- Existing IDs owned by another user are rejected. IDs already removed (or
  -- unknown IDs) are a safe no-op so a repeated form submission is idempotent.
  if exists (
    select 1 from public.letterboxd_sources s
    where s.id = any(p_source_ids) and s.user_id <> account_id
  ) then
    raise exception 'invalid source selection' using errcode = '22023';
  end if;

  with removed as (
    delete from public.letterboxd_sources s
    where s.id = any(p_source_ids) and s.user_id = account_id
    returning s.id, s.source_url, s.source_type
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', r.id, 'sourceUrl', r.source_url, 'sourceType', r.source_type
      ) order by r.source_url
    ), '[]'::jsonb
  ) into result from removed r;

  return result;
end;
$$;

create function app_auth.unsubscribe_all_movie_notifications(p_token_hash bytea)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare token_id uuid; account_id uuid; consumed timestamptz; revoked timestamptz; expires timestamptz;
begin
  select t.id, t.user_id, t.consumed_at
    into token_id, account_id, consumed
  from app_auth.movie_notification_unsubscribe_tokens t
  where t.token_hash = p_token_hash and t.purpose = 'one_click_all';
  if token_id is null then return false; end if;
  if consumed is not null then return true; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('movie-notification-queue', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('movie-notifications:' || account_id::text, 0)
  );

  select t.consumed_at, t.revoked_at, t.expires_at
    into consumed, revoked, expires
  from app_auth.movie_notification_unsubscribe_tokens t
  where t.id = token_id
  for update;
  if not found then return false; end if;
  if consumed is not null then return true; end if;
  if revoked is not null or expires <= statement_timestamp() then return false; end if;

  update app_auth.movie_notification_unsubscribe_tokens
  set consumed_at = statement_timestamp()
  where id = token_id;
  update app_auth.movie_notification_unsubscribe_tokens
  set revoked_at = statement_timestamp()
  where user_id = account_id and id <> token_id and revoked_at is null;

  -- Existing triggers retire unsupported pending work and preserve the
  -- notification ledger. The global and per-account locks serialize this
  -- with collection and delivery claims.
  delete from public.letterboxd_sources where user_id = account_id;
  delete from public.ticket_alert_subscriptions where user_id = account_id;
  delete from public.coming_soon_date_watches where user_id = account_id;
  return true;
end;
$$;

revoke all on function app_auth.movie_notification_unsubscribe_sources(bytea),
  app_auth.remove_movie_notification_letterboxd_sources(bytea, uuid[]),
  app_auth.unsubscribe_all_movie_notifications(bytea),
  app_auth.movie_notification_delivery_has_letterboxd_support(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_auth.movie_notification_unsubscribe_sources(bytea),
  app_auth.remove_movie_notification_letterboxd_sources(bytea, uuid[]),
  app_auth.unsubscribe_all_movie_notifications(bytea),
  app_auth.movie_notification_delivery_has_letterboxd_support(uuid, uuid)
  to kartiseret_runtime;

comment on table app_auth.movie_notification_unsubscribe_tokens is
  'Hashed, delivery-scoped credentials for managing or stopping movie notifications.';

commit;
