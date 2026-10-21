begin;

-- The owner explicitly chose to restart ticket-alert settings during this
-- overhaul. Keep all catalog and account records intact.
delete from public.ticket_alert_subscriptions;

alter table public.ticket_alert_subscriptions
  add column criteria_overrides jsonb not null default '{}'::jsonb
  check (jsonb_typeof(criteria_overrides) = 'object');

create table public.ticket_alert_preferences (
  user_id uuid primary key references app_auth.users (id) on delete cascade,
  cities text[],
  filter_exclusions jsonb not null default
    '{"showType":[],"screenFormat":[],"screeningTech":[],"dubLanguage":[]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ticket_alert_preferences_cities_check check (
    cities is null or (
      cities <@ array[
        'Afula','Ashdod','Ashkelon','Ayalon','Beer Sheva','Carmiel',
        'Chadera','Even Yehuda','Givatayim','Glilot','Haifa','Herziliya',
        'Jerusalem','Kfar Saba','Kiryat Bialik','Kiryat Ono','Modiin',
        'Nahariya','Netanya','Omer','Petach Tikvah','Raanana',
        'Ramat Hasharon','Rehovot','Rishon Letzion','Tel Aviv',
        'Zichron Yaakov','Holon'
      ]::text[]
      and array_position(cities, null) is null
    )
  ),
  constraint ticket_alert_preferences_filter_exclusions_check check (
    jsonb_typeof(filter_exclusions) = 'object'
    and filter_exclusions ?& array['showType','screenFormat','screeningTech','dubLanguage']
    and filter_exclusions - array['showType','screenFormat','screeningTech','dubLanguage']::text[] = '{}'::jsonb
    and jsonb_typeof(filter_exclusions->'showType') = 'array'
    and jsonb_typeof(filter_exclusions->'screenFormat') = 'array'
    and jsonb_typeof(filter_exclusions->'screeningTech') = 'array'
    and jsonb_typeof(filter_exclusions->'dubLanguage') = 'array'
  )
);

comment on table public.ticket_alert_preferences is
  'Account-wide defaults for one-shot ticket alert city and showtime filters; NULL cities means every city.';
comment on column public.ticket_alert_preferences.filter_exclusions is
  'Unchecked values keyed by the existing showtime filter groups; empty arrays mean every value is eligible.';
comment on column public.ticket_alert_subscriptions.criteria_overrides is
  'Sparse per-title overrides. Missing fields inherit ticket_alert_preferences.';

alter table public.ticket_alert_preferences enable row level security;

revoke all on public.ticket_alert_preferences from public, anon, authenticated;
revoke all on public.ticket_alert_subscriptions from public, anon, authenticated;
grant select, insert, update on public.ticket_alert_preferences to kartiseret_runtime;
grant select (user_id, tmdb_id, created_at, notified_at, delivery_title,
  delivery_date, criteria_overrides), insert (user_id, tmdb_id),
  update (criteria_overrides), delete on public.ticket_alert_subscriptions
  to kartiseret_runtime;

create policy api_own_select on public.ticket_alert_preferences
  for select to kartiseret_runtime
  using (user_id = (select app_auth.current_user_id()));
create policy api_own_insert on public.ticket_alert_preferences
  for insert to kartiseret_runtime
  with check (user_id = (select app_auth.current_user_id()));
create policy api_own_update on public.ticket_alert_preferences
  for update to kartiseret_runtime
  using (user_id = (select app_auth.current_user_id()))
  with check (user_id = (select app_auth.current_user_id()));
create policy api_own_update on public.ticket_alert_subscriptions
  for update to kartiseret_runtime
  using (user_id = (select app_auth.current_user_id()))
  with check (user_id = (select app_auth.current_user_id()));

commit;
