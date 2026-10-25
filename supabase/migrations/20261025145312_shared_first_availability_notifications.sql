begin;

alter table public.ticket_alert_subscriptions add column baseline_cities text[] not null default array[]::text[];
grant insert (baseline_cities) on public.ticket_alert_subscriptions to kartiseret_runtime;

alter table public.ticket_alert_preferences add column notification_mode text not null
  default 'first_any_city' check (notification_mode in ('first_any_city','first_per_city'));
comment on table public.ticket_alert_preferences is 'Account-wide city, first-availability notification mode, and showtime filter defaults for all watched films.';
comment on column public.ticket_alert_preferences.cities is
  'NULL follows the account preferred city (Jerusalem fallback); explicit arrays select cities, including all cities.';
update public.ticket_alert_subscriptions set criteria_overrides = criteria_overrides - 'cities'
where criteria_overrides->'cities' = 'null'::jsonb;

create table public.movie_notification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_auth.users(id) on delete cascade,
  tmdb_id bigint not null check (tmdb_id > 0),
  event_type text not null check (event_type in ('coming_soon','showtime')),
  scope_city text not null,
  event_payload jsonb not null check (jsonb_typeof(event_payload) = 'object'),
  status text not null check (status in ('pending','suppressed','sent','cancelled')),
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  delivery_id uuid,
  unique (user_id,tmdb_id,event_type,scope_city),
  check ((event_type = 'coming_soon' and scope_city = '') or (event_type = 'showtime' and scope_city <> ''))
);
create table public.movie_notification_deliveries (
  id uuid primary key,
  user_id uuid not null references app_auth.users(id) on delete cascade,
  events jsonb not null check (jsonb_typeof(events) = 'array'),
  status text not null default 'pending' check (status in ('pending','sent','cancelled')),
  attempts integer not null default 0,
  first_attempt_at timestamptz,
  email_snapshot jsonb,
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  resend_email_id text,
  last_error text
);
alter table public.movie_notification_events add foreign key (delivery_id)
  references public.movie_notification_deliveries(id);
create unique index movie_notification_one_pending_delivery on public.movie_notification_deliveries(user_id) where status = 'pending';
create index movie_notification_pending on public.movie_notification_events(user_id) where status = 'pending';
alter table public.movie_notification_events enable row level security;
alter table public.movie_notification_deliveries enable row level security;
revoke all on public.movie_notification_events, public.movie_notification_deliveries from public, anon, authenticated;
grant all on public.movie_notification_events, public.movie_notification_deliveries to service_role;
grant select on public.movie_notification_events to kartiseret_runtime;
create policy api_own_select on public.movie_notification_events for select to kartiseret_runtime
  using (user_id = (select app_auth.current_user_id()));

-- Historical session rows remain untouched for audit. Collapse completed and
-- attempted scopes so cutover cannot replay the previous flood under new IDs.
insert into public.movie_notification_events(user_id,tmdb_id,event_type,scope_city,event_payload,status,notified_at)
select distinct on (user_id,tmdb_id,event_type,scope_city)
  user_id,tmdb_id,event_type,scope_city,event_payload,status,notified_at
from (
  select user_id,tmdb_id,event_type,
    case when event_type='showtime' then coalesce(nullif(event_payload->>'screening_city',''),'__legacy__') else '' end scope_city,
    event_payload,case when status='sent' then 'sent' else 'suppressed' end status,notified_at
  from public.letterboxd_event_alerts
  where status in ('sent','suppressed') or (status='pending' and delivery_attempts>0)
  union all
  select user_id,tmdb_id,'showtime',coalesce(nullif(delivery_city,''),'__legacy__'),
    jsonb_build_object('title',delivery_title,'screening_city',delivery_city,'date_of_showing',delivery_date,'ticket_href',delivery_href),
    case when notified_at is not null then 'sent' else 'suppressed' end,notified_at
  from public.ticket_alert_subscriptions where notified_at is not null or delivery_attempts>0
  union all
  select user_id,tmdb_id,'coming_soon','',jsonb_build_object('title',coalesce(delivery_title,title),'release_date',delivery_date),
    case when notified_at is not null then 'sent' else 'suppressed' end,notified_at
  from public.coming_soon_date_watches where notified_at is not null or delivery_attempts>0
) history order by user_id,tmdb_id,event_type,scope_city,(status='sent') desc,notified_at;
update public.letterboxd_event_alerts set status='cancelled',delivery_id=null,
  last_delivery_error='Retired by shared first-availability cutover'
where status='pending';

create function public.movie_notification_is_watched(p_user uuid,p_movie bigint,p_type text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select exists (select 1 from public.letterboxd_source_films where user_id=p_user and tmdb_id=p_movie and removed_at is null)
  or (p_type='showtime' and exists (select 1 from public.ticket_alert_subscriptions where user_id=p_user and tmdb_id=p_movie))
  or (p_type='coming_soon' and exists (select 1 from public.coming_soon_date_watches where user_id=p_user and tmdb_id=p_movie));
$$;

-- One transaction serializes reconciliation and insertion for every account.
-- Only the worker may call this function; clients cannot forge delivery state.
create function public.queue_movie_notifications(p_candidates jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare item jsonb; account_id uuid; movie_id bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('movie-notification-queue',0));
  for account_id in select user_id from public.movie_notification_events where status='pending'
    union select (value->>'user_id')::uuid from jsonb_array_elements(p_candidates) order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('movie-notifications:'||account_id::text,0));
  end loop;
  update public.movie_notification_events e set status='cancelled'
  where e.status='pending' and e.delivery_id is null and not exists (
    select 1 from jsonb_array_elements(p_candidates) c
    where (c->>'user_id')::uuid=e.user_id and (c->>'tmdb_id')::bigint=e.tmdb_id
      and c->>'event_type'=e.event_type and c->>'scope_city'=e.scope_city
  );
  -- A mode change before claiming can narrow several per-city candidates to
  -- one earliest city. Already claimed snapshots remain immutable for retries.
  with first_choice as (
    select distinct on (value->>'user_id',value->>'tmdb_id') value
    from jsonb_array_elements(p_candidates) with ordinality
    where value->>'event_type'='showtime' and value->>'notification_mode'='first_any_city'
    order by value->>'user_id',value->>'tmdb_id',ordinality
  )
  update public.movie_notification_events e set status='cancelled'
  from first_choice c where e.user_id=(c.value->>'user_id')::uuid
    and e.tmdb_id=(c.value->>'tmdb_id')::bigint and e.event_type='showtime'
    and e.status='pending' and e.delivery_id is null and (
      e.scope_city <> c.value->>'scope_city' or exists (
        select 1 from public.movie_notification_events closed where closed.user_id=e.user_id
          and closed.tmdb_id=e.tmdb_id and closed.event_type='showtime' and closed.status in ('sent','suppressed')
      )
    );
  for item in select value from jsonb_array_elements(p_candidates) loop
    account_id := (item->>'user_id')::uuid;
    movie_id := (item->>'tmdb_id')::bigint;
    if not public.movie_notification_is_watched(account_id,movie_id,item->>'event_type') then continue; end if;
    if item->>'event_type'='showtime' and item->>'notification_mode'='first_any_city' and exists (
      select 1 from public.movie_notification_events where user_id=account_id and tmdb_id=movie_id
        and event_type='showtime' and (status in ('sent','suppressed') or (status='pending' and scope_city <> item->>'scope_city'))
    ) then continue; end if;
    insert into public.movie_notification_events(user_id,tmdb_id,event_type,scope_city,event_payload,status)
    values (account_id,movie_id,item->>'event_type',item->>'scope_city',item->'event_payload',item->>'status')
    on conflict (user_id,tmdb_id,event_type,scope_city) do update
      set status=excluded.status,event_payload=excluded.event_payload,delivery_id=null
      where movie_notification_events.status='cancelled' or (movie_notification_events.status='pending' and movie_notification_events.delivery_id is null);
  end loop;
end;
$$;

create function public.claim_movie_notification_delivery(p_user uuid,p_delivery uuid)
returns setof public.movie_notification_deliveries language plpgsql security definer set search_path=pg_catalog,public as $$
declare snapshot jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('movie-notifications:'||p_user::text,0));
  if exists (select 1 from public.movie_notification_deliveries where user_id=p_user and status='pending') then
    return query select * from public.movie_notification_deliveries where user_id=p_user and status='pending';
    return;
  end if;
  select jsonb_agg(jsonb_build_object('id',id,'tmdb_id',tmdb_id,'event_type',event_type,'event_payload',event_payload) order by event_type,tmdb_id,scope_city)
    into snapshot from public.movie_notification_events
    where user_id=p_user and status='pending' and delivery_id is null;
  if snapshot is null then return; end if;
  insert into public.movie_notification_deliveries(id,user_id,events) values(p_delivery,p_user,snapshot);
  update public.movie_notification_events set delivery_id=p_delivery
    where user_id=p_user and status='pending' and delivery_id is null;
  return query select * from public.movie_notification_deliveries where id=p_delivery;
end;
$$;

create function public.start_movie_notification_delivery(p_delivery uuid,p_snapshot jsonb)
returns setof public.movie_notification_deliveries language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  -- Resend's idempotency window is finite. Uncertain old attempts are retired,
  -- never replayed with a new key after that window.
  update public.movie_notification_deliveries set status='cancelled',last_error='Unconfirmed delivery exceeded safe retry window'
    where id=p_delivery and status='pending' and first_attempt_at < now()-interval '23 hours';
  if found then
    update public.movie_notification_events set status='suppressed' where delivery_id=p_delivery and status='pending';
    return;
  end if;
  return query update public.movie_notification_deliveries set attempts=attempts+1,
    first_attempt_at=coalesce(first_attempt_at,now()),email_snapshot=coalesce(email_snapshot,p_snapshot)
    where id=p_delivery and status='pending' returning *;
end;
$$;

create function public.complete_movie_notification_delivery(p_delivery uuid,p_resend_id text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  update public.movie_notification_deliveries set status='sent',notified_at=now(),resend_email_id=p_resend_id where id=p_delivery and status='pending';
  if not found then return; end if;
  update public.movie_notification_events set status='sent',notified_at=now() where delivery_id=p_delivery and status='pending';
  update public.ticket_alert_subscriptions s set notified_at=coalesce(s.notified_at,e.notified_at),delivery_title=e.event_payload->>'title',delivery_city=e.scope_city,
    delivery_date=(e.event_payload->>'date_of_showing')::date,delivery_href=e.event_payload->>'ticket_href'
  from public.movie_notification_events e where e.delivery_id=p_delivery and e.event_type='showtime' and e.user_id=s.user_id and e.tmdb_id=s.tmdb_id;
  update public.coming_soon_date_watches s set notified_at=coalesce(s.notified_at,e.notified_at),delivery_title=e.event_payload->>'title',delivery_date=(e.event_payload->>'release_date')::date
  from public.movie_notification_events e where e.delivery_id=p_delivery and e.event_type='coming_soon' and e.user_id=s.user_id and e.tmdb_id=s.tmdb_id;
end;
$$;

create function app_auth.cancel_unwatched_movie_notifications()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare target_user uuid; target_movie bigint; batch record;
begin
  if tg_op='UPDATE' then
    if old.removed_at is not null or new.removed_at is null then return new; end if;
  end if;
  target_user := old.user_id; target_movie := old.tmdb_id;
  if target_movie is null then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('movie-notifications:'||target_user::text,0));
  for batch in select distinct d.id,d.attempts from public.movie_notification_deliveries d join public.movie_notification_events e on e.delivery_id=d.id
    where e.user_id=target_user and e.tmdb_id=target_movie and e.status='pending' and d.status='pending'
      and not public.movie_notification_is_watched(e.user_id,e.tmdb_id,e.event_type)
  loop
    update public.movie_notification_deliveries set status='cancelled',last_error='Watch removed before delivery confirmation' where id=batch.id;
    update public.movie_notification_events set
      status=case when not public.movie_notification_is_watched(user_id,tmdb_id,event_type) then 'cancelled'
        when batch.attempts>0 then 'suppressed' else 'pending' end,delivery_id=null
      where delivery_id=batch.id and status='pending';
  end loop;
  update public.movie_notification_events set status='cancelled' where user_id=target_user and tmdb_id=target_movie and status='pending'
    and not public.movie_notification_is_watched(user_id,tmdb_id,event_type);
  return null;
end;
$$;
create trigger ticket_watch_cancel_shared_notifications after delete on public.ticket_alert_subscriptions
  for each row execute function app_auth.cancel_unwatched_movie_notifications();
create trigger date_watch_cancel_shared_notifications after delete on public.coming_soon_date_watches
  for each row execute function app_auth.cancel_unwatched_movie_notifications();
create trigger source_watch_cancel_shared_notifications after update of removed_at or delete on public.letterboxd_source_films
  for each row execute function app_auth.cancel_unwatched_movie_notifications();

revoke all on function public.movie_notification_is_watched(uuid,bigint,text), public.queue_movie_notifications(jsonb),
  public.claim_movie_notification_delivery(uuid,uuid), public.start_movie_notification_delivery(uuid,jsonb), public.complete_movie_notification_delivery(uuid,text),
  app_auth.cancel_unwatched_movie_notifications() from public,anon,authenticated,kartiseret_runtime;
grant execute on function public.movie_notification_is_watched(uuid,bigint,text), public.queue_movie_notifications(jsonb),
  public.claim_movie_notification_delivery(uuid,uuid), public.start_movie_notification_delivery(uuid,jsonb), public.complete_movie_notification_delivery(uuid,text) to service_role;
comment on table public.movie_notification_events is 'Shared first-date and first-ticket availability history across manual watches and Letterboxd sources.';
commit;
