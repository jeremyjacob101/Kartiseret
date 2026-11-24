begin;

alter table public."userPreferences"
  add column notification_delivery text not null default 'email'
  check (notification_delivery in ('email','iphone','both','neither'));

alter table public.movie_notification_deliveries
  add column email_status text not null default 'pending'
    check (email_status in ('pending','sent','cancelled','not_requested')),
  add column push_status text not null default 'not_requested'
    check (push_status in ('pending','sent','suppressed','cancelled','not_requested')),
  add column delivery_mode text not null default 'email'
    check (delivery_mode in ('email','iphone','both','neither'));

update public.movie_notification_deliveries
set email_status = case status when 'sent' then 'sent' when 'cancelled' then 'cancelled' else 'pending' end;

create table public.apns_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_auth.users(id) on delete cascade,
  device_token text unique,
  environment text not null check (environment in ('development','production')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index apns_devices_user_active on public.apns_devices(user_id) where active and device_token is not null;

create table public.movie_notification_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.movie_notification_deliveries(id) on delete cascade,
  device_id uuid references public.apns_devices(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending','sending','sent','suppressed','uncertain')),
  attempts integer not null default 0,
  first_attempt_at timestamptz,
  next_attempt_at timestamptz,
  payload_snapshot jsonb check (payload_snapshot is null or jsonb_typeof(payload_snapshot) = 'object'),
  apns_id text,
  last_error text,
  created_at timestamptz not null default now(),
  unique (delivery_id,device_id)
);
create index movie_notification_push_pending on public.movie_notification_push_deliveries(delivery_id,status,next_attempt_at);

alter table public.apns_devices enable row level security;
alter table public.movie_notification_push_deliveries enable row level security;
revoke all on public.apns_devices, public.movie_notification_push_deliveries from public, anon, authenticated, kartiseret_runtime;
grant select on public.apns_devices to kartiseret_runtime, service_role;
grant all on public.apns_devices, public.movie_notification_push_deliveries to service_role;
create policy api_own_select on public.apns_devices for select to kartiseret_runtime
  using (user_id = (select app_auth.current_user_id()));

create or replace function public.finish_movie_notification_delivery(p_delivery uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.movie_notification_deliveries%rowtype; sent_push boolean;
begin
  select * into d from public.movie_notification_deliveries where id=p_delivery for update;
  if not found or d.status <> 'pending' then return; end if;

  if d.push_status='pending' then
    if exists (select 1 from public.movie_notification_push_deliveries
      where delivery_id=p_delivery and status in ('pending','sending')) then
      return;
    end if;
    if exists (select 1 from public.movie_notification_push_deliveries
      where delivery_id=p_delivery and status='sent') then
      update public.movie_notification_deliveries set push_status='sent' where id=p_delivery;
    elsif exists (select 1 from public.movie_notification_push_deliveries
        where delivery_id=p_delivery)
      or not exists (select 1 from public.apns_devices
        where user_id=d.user_id and active and device_token is not null) then
      update public.movie_notification_deliveries set push_status='suppressed' where id=p_delivery;
    end if;
  end if;

  select exists (select 1 from public.movie_notification_push_deliveries
    where delivery_id=p_delivery and status='sent') into sent_push;
  select * into d from public.movie_notification_deliveries where id=p_delivery;
  if d.email_status='pending' or d.push_status='pending' then return; end if;

  if d.email_status='sent' or sent_push then
    update public.movie_notification_deliveries set status='sent',notified_at=now() where id=p_delivery;
    update public.movie_notification_events set status='sent',notified_at=now()
      where delivery_id=p_delivery and status='pending';
    update public.ticket_alert_subscriptions s set notified_at=coalesce(s.notified_at,e.notified_at),
      delivery_title=e.event_payload->>'title',delivery_city=e.scope_city,
      delivery_date=(e.event_payload->>'date_of_showing')::date,delivery_href=e.event_payload->>'ticket_href'
      from public.movie_notification_events e where e.delivery_id=p_delivery and e.event_type='showtime'
      and e.user_id=s.user_id and e.tmdb_id=s.tmdb_id;
    update public.coming_soon_date_watches s set notified_at=coalesce(s.notified_at,e.notified_at),
      delivery_title=e.event_payload->>'title',delivery_date=(e.event_payload->>'release_date')::date
      from public.movie_notification_events e where e.delivery_id=p_delivery and e.event_type='coming_soon'
      and e.user_id=s.user_id and e.tmdb_id=s.tmdb_id;
  else
    update public.movie_notification_deliveries set status='cancelled' where id=p_delivery;
    update public.movie_notification_events set status='suppressed'
      where delivery_id=p_delivery and status='pending';
  end if;
end;
$$;

create or replace function public.claim_movie_notification_delivery(p_user uuid,p_delivery uuid)
returns setof public.movie_notification_deliveries language plpgsql security definer set search_path=pg_catalog,public as $$
declare snapshot jsonb; mode text; wants_email boolean; wants_push boolean; device_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('movie-notifications:'||p_user::text,0));
  if exists (select 1 from public.movie_notification_deliveries d where d.user_id=p_user and d.status='pending'
      and (d.email_status='pending' or d.push_status='pending')) then
    return query select * from public.movie_notification_deliveries d where d.user_id=p_user and d.status='pending'
      and (d.email_status='pending' or d.push_status='pending') order by d.created_at limit 1;
    return;
  end if;
  select coalesce(notification_delivery,'email') into mode from public."userPreferences" where user_id=p_user;
  mode := coalesce(mode,'email');
  if mode='neither' then
    update public.movie_notification_events set status='suppressed'
      where user_id=p_user and status='pending' and delivery_id is null;
    return;
  end if;
  wants_email := mode in ('email','both');
  wants_push := mode in ('iphone','both');
  select count(*) into device_count from public.apns_devices
    where user_id=p_user and active and device_token is not null;
  if not wants_email and device_count=0 then return; end if;
  select jsonb_agg(jsonb_build_object('id',id,'tmdb_id',tmdb_id,'event_type',event_type,'event_payload',event_payload) order by event_type,tmdb_id,scope_city)
    into snapshot from public.movie_notification_events
    where user_id=p_user and status='pending' and delivery_id is null;
  if snapshot is null then return; end if;
  insert into public.movie_notification_deliveries(id,user_id,events,email_status,push_status,delivery_mode)
    values(p_delivery,p_user,snapshot,case when wants_email then 'pending' else 'not_requested' end,
      case when wants_push and device_count>0 then 'pending' else 'not_requested' end,mode);
  update public.movie_notification_events set delivery_id=p_delivery
    where user_id=p_user and status='pending' and delivery_id is null;
  if wants_push and device_count>0 then
    insert into public.movie_notification_push_deliveries(delivery_id,device_id)
      select p_delivery,id from public.apns_devices
      where user_id=p_user and active and device_token is not null
      on conflict (delivery_id,device_id) do nothing;
  end if;
  return query select * from public.movie_notification_deliveries where id=p_delivery;
end;
$$;

create or replace function public.reconcile_movie_notification_delivery(p_delivery uuid)
returns setof public.movie_notification_deliveries language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.movie_notification_deliveries%rowtype; mode text; wants_email boolean; wants_push boolean; target_user uuid;
begin
  select user_id into target_user from public.movie_notification_deliveries where id=p_delivery;
  if target_user is null then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('movie-notifications:'||target_user::text,0));
  select * into d from public.movie_notification_deliveries where id=p_delivery for update;
  if not found or d.status <> 'pending' then return; end if;
  select coalesce(notification_delivery,'email') into mode from public."userPreferences" where user_id=d.user_id;
  mode := coalesce(mode,'email');
  wants_email := mode in ('email','both');
  wants_push := mode in ('iphone','both');
  update public.movie_notification_push_deliveries set status='uncertain',last_error='Previous push attempt ended without confirmation'
    where delivery_id=p_delivery and status='sending' and first_attempt_at < now()-interval '30 minutes';
  update public.movie_notification_push_deliveries p set status='suppressed',last_error='Device is no longer registered'
    where p.delivery_id=p_delivery and p.status='pending'
      and not exists (select 1 from public.apns_devices a where a.id=p.device_id and a.active and a.device_token is not null);
  if mode='neither' then
    update public.movie_notification_deliveries set email_status='cancelled',push_status='cancelled',delivery_mode=mode where id=p_delivery;
    update public.movie_notification_push_deliveries set status='suppressed',last_error='Notifications disabled'
      where delivery_id=p_delivery and status='pending';
    update public.movie_notification_deliveries set status='cancelled' where id=p_delivery;
    update public.movie_notification_events set status='suppressed' where delivery_id=p_delivery and status='pending';
    return query select * from public.movie_notification_deliveries where id=p_delivery;
    return;
  end if;
  update public.movie_notification_deliveries set
    email_status=case when wants_email and email_status in ('not_requested','cancelled') and attempts=0 then 'pending'
      when not wants_email and email_status='pending' then 'cancelled' else email_status end,
    push_status=case when wants_push and push_status in ('not_requested','cancelled') then 'pending'
      when not wants_push and push_status='pending' then 'cancelled' else push_status end,
    delivery_mode=mode
    where id=p_delivery;
  if wants_push then
    insert into public.movie_notification_push_deliveries(delivery_id,device_id)
      select p_delivery,id from public.apns_devices where user_id=d.user_id and active and device_token is not null
      on conflict (delivery_id,device_id) do update
        set status='pending',last_error=null,next_attempt_at=null
        where movie_notification_push_deliveries.status='suppressed' and movie_notification_push_deliveries.attempts=0;
  else
    update public.movie_notification_push_deliveries set status='suppressed',last_error='Push notifications disabled'
      where delivery_id=p_delivery and status='pending';
  end if;
  perform public.finish_movie_notification_delivery(p_delivery);
  return query select * from public.movie_notification_deliveries where id=p_delivery;
end;
$$;

create or replace function public.start_movie_notification_delivery(p_delivery uuid,p_snapshot jsonb)
returns setof public.movie_notification_deliveries language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  update public.movie_notification_deliveries set email_status='cancelled',last_error='Unconfirmed email delivery exceeded safe retry window'
    where id=p_delivery and status='pending' and email_status='pending'
      and first_attempt_at < now()-interval '23 hours';
  perform public.finish_movie_notification_delivery(p_delivery);
  return query update public.movie_notification_deliveries set attempts=attempts+1,
    first_attempt_at=coalesce(first_attempt_at,now()),email_snapshot=coalesce(email_snapshot,p_snapshot)
    where id=p_delivery and status='pending' and email_status='pending'
      and exists (select 1 from public."userPreferences" pref
        where pref.user_id=movie_notification_deliveries.user_id
          and pref.notification_delivery in ('email','both')) returning *;
end;
$$;

create or replace function public.complete_movie_notification_delivery(p_delivery uuid,p_resend_id text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  update public.movie_notification_deliveries set email_status='sent',resend_email_id=p_resend_id
    where id=p_delivery and status='pending' and email_status='pending';
  perform public.finish_movie_notification_delivery(p_delivery);
end;
$$;

create function public.start_movie_notification_push_delivery(p_push_delivery uuid,p_payload jsonb)
returns table(push_delivery_id uuid,device_token text,environment text,payload_snapshot jsonb)
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  return query update public.movie_notification_push_deliveries p set status='sending',attempts=p.attempts+1,
    first_attempt_at=coalesce(p.first_attempt_at,now()),payload_snapshot=coalesce(p.payload_snapshot,p_payload)
    from public.movie_notification_deliveries d,public.apns_devices a,public."userPreferences" pref
    where p.id=p_push_delivery and p.delivery_id=d.id and d.status='pending' and d.push_status='pending'
      and pref.user_id=d.user_id and pref.notification_delivery in ('iphone','both')
      and p.device_id=a.id and a.active and a.device_token is not null
      and p.status='pending' and (p.next_attempt_at is null or p.next_attempt_at<=now())
    returning p.id,a.device_token,a.environment,p.payload_snapshot;
end;
$$;

create or replace function public.complete_movie_notification_push_delivery(p_push_delivery uuid,p_apns_id text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare delivery uuid;
begin
  update public.movie_notification_push_deliveries set status='sent',apns_id=p_apns_id,last_error=null
    where id=p_push_delivery and status='sending' returning delivery_id into delivery;
  if delivery is not null then perform public.finish_movie_notification_delivery(delivery); end if;
end;
$$;

create function public.retry_movie_notification_push_delivery(p_push_delivery uuid,p_error text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  update public.movie_notification_push_deliveries set status='pending',last_error=left(p_error,2000),
    next_attempt_at=now()+interval '15 minutes' where id=p_push_delivery and status='sending';
end;
$$;

create function public.resolve_movie_notification_push_delivery(p_push_delivery uuid,p_resolution text,p_error text,p_deactivate_device boolean default false)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare delivery uuid; device uuid;
begin
  if p_resolution not in ('suppressed','uncertain') then raise exception 'Invalid push resolution'; end if;
  update public.movie_notification_push_deliveries set status=p_resolution,last_error=left(p_error,2000)
    where id=p_push_delivery and status='sending' returning delivery_id,device_id into delivery,device;
  if delivery is null then return; end if;
  if p_deactivate_device and device is not null then
    update public.apns_devices set active=false,device_token=null,updated_at=now() where id=device;
  end if;
  perform public.finish_movie_notification_delivery(delivery);
end;
$$;

create function app_auth.register_apns_device(p_token text,p_environment text)
returns void language plpgsql security definer set search_path=pg_catalog,public,app_auth as $$
declare v_user uuid; v_device uuid; v_old_user uuid; delivery uuid;
begin
  v_user := app_auth.current_user_id();
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_environment not in ('development','production') or p_token !~* '^(?:[0-9a-f]{2}){16,64}$' then
    raise exception 'Invalid APNs device registration';
  end if;
  select id,user_id into v_device,v_old_user from public.apns_devices where device_token=p_token for update;
  if v_device is null then
    insert into public.apns_devices(user_id,device_token,environment,active)
      values(v_user,p_token,p_environment,true);
    return;
  end if;
  if v_old_user <> v_user then
    for delivery in select distinct delivery_id from public.movie_notification_push_deliveries
      where device_id=v_device and status in ('pending','sending') loop
      update public.movie_notification_push_deliveries set status='suppressed',last_error='Device signed in to another account'
        where delivery_id=delivery and device_id=v_device and status in ('pending','sending');
      perform public.finish_movie_notification_delivery(delivery);
    end loop;
  end if;
  update public.apns_devices set user_id=v_user,environment=p_environment,active=true,updated_at=now()
    where id=v_device;
end;
$$;

create function app_auth.unregister_apns_device(p_token text)
returns void language plpgsql security definer set search_path=pg_catalog,public,app_auth as $$
declare v_user uuid; v_device uuid; delivery uuid;
begin
  v_user := app_auth.current_user_id();
  if v_user is null then raise exception 'Authentication required'; end if;
  select id into v_device from public.apns_devices
    where user_id=v_user and device_token=p_token for update;
  if v_device is null then return; end if;
  for delivery in select distinct delivery_id from public.movie_notification_push_deliveries
    where device_id=v_device and status in ('pending','sending') loop
    update public.movie_notification_push_deliveries set status='suppressed',last_error='Device signed out'
      where delivery_id=delivery and device_id=v_device and status in ('pending','sending');
    perform public.finish_movie_notification_delivery(delivery);
  end loop;
  update public.apns_devices set active=false,device_token=null,updated_at=now() where id=v_device;
end;
$$;

-- A push attempt is just as externally visible as an email attempt. Preserve
-- the old no-replay behavior when a watch is removed after either channel has
-- started delivery.
create or replace function app_auth.cancel_unwatched_movie_notifications()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare target_user uuid; target_movie bigint; batch record;
begin
  if tg_op='UPDATE' then
    if old.removed_at is not null or new.removed_at is null then return new; end if;
  end if;
  target_user := old.user_id; target_movie := old.tmdb_id;
  if target_movie is null then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('movie-notifications:'||target_user::text,0));
  for batch in
    select distinct d.id,
      (d.attempts>0 or exists (select 1 from public.movie_notification_push_deliveries p
        where p.delivery_id=d.id and p.attempts>0)) as attempted
    from public.movie_notification_deliveries d
    join public.movie_notification_events e on e.delivery_id=d.id
    where e.user_id=target_user and e.tmdb_id=target_movie and e.status='pending' and d.status='pending'
      and not public.movie_notification_is_watched(e.user_id,e.tmdb_id,e.event_type)
  loop
    update public.movie_notification_deliveries set status='cancelled',last_error='Watch removed before delivery confirmation'
      where id=batch.id;
    update public.movie_notification_events set
      status=case when not public.movie_notification_is_watched(user_id,tmdb_id,event_type) then 'cancelled'
        when batch.attempted then 'suppressed' else 'pending' end,delivery_id=null
      where delivery_id=batch.id and status='pending';
  end loop;
  update public.movie_notification_events set status='cancelled'
    where user_id=target_user and tmdb_id=target_movie and status='pending'
      and not public.movie_notification_is_watched(user_id,tmdb_id,event_type);
  return null;
end;
$$;

revoke all on function public.finish_movie_notification_delivery(uuid),
  public.claim_movie_notification_delivery(uuid,uuid),
  public.reconcile_movie_notification_delivery(uuid),
  public.start_movie_notification_delivery(uuid,jsonb),
  public.complete_movie_notification_delivery(uuid,text),
  public.start_movie_notification_push_delivery(uuid,jsonb),
  public.complete_movie_notification_push_delivery(uuid,text),
  public.retry_movie_notification_push_delivery(uuid,text),
  public.resolve_movie_notification_push_delivery(uuid,text,text,boolean),
  app_auth.register_apns_device(text,text),app_auth.unregister_apns_device(text)
  from public,anon,authenticated;
grant execute on function public.claim_movie_notification_delivery(uuid,uuid),
  public.reconcile_movie_notification_delivery(uuid),
  public.start_movie_notification_delivery(uuid,jsonb),
  public.complete_movie_notification_delivery(uuid,text),
  public.start_movie_notification_push_delivery(uuid,jsonb),
  public.complete_movie_notification_push_delivery(uuid,text),
  public.retry_movie_notification_push_delivery(uuid,text),
  public.resolve_movie_notification_push_delivery(uuid,text,text,boolean)
  to service_role;
grant execute on function app_auth.register_apns_device(text,text),
  app_auth.unregister_apns_device(text) to kartiseret_runtime;

commit;
