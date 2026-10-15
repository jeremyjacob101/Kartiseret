alter table public."allShowtimes"
  add column if not exists snapshot_id uuid;
alter table public."allTheques"
  add column if not exists snapshot_id uuid;
alter table public."allSoons"
  add column if not exists snapshot_id uuid;

create index if not exists all_showtimes_snapshot_id_idx
  on public."allShowtimes" (snapshot_id)
  where snapshot_id is not null;
create index if not exists all_theques_snapshot_id_idx
  on public."allTheques" (snapshot_id)
  where snapshot_id is not null;
create index if not exists all_soons_snapshot_id_idx
  on public."allSoons" (snapshot_id)
  where snapshot_id is not null;

create table public.pipeline_scrape_snapshots (
  snapshot_id uuid not null,
  run_id bigint not null,
  attempt integer not null default 1,
  table_name text not null,
  source_name text not null,
  cinema text not null,
  status text not null default 'running',
  row_count integer not null default 0,
  failure_reason text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint pipeline_scrape_snapshots_pkey primary key (snapshot_id),
  constraint pipeline_scrape_snapshots_attempt_positive check (attempt > 0),
  constraint pipeline_scrape_snapshots_row_count_nonnegative check (row_count >= 0),
  constraint pipeline_scrape_snapshots_table_name_check check (
    table_name in ('allShowtimes', 'allTheques', 'allSoons')
  ),
  constraint pipeline_scrape_snapshots_status_check check (
    status in ('running', 'complete', 'failed')
  )
);

create index pipeline_scrape_snapshots_latest_scope_idx
  on public.pipeline_scrape_snapshots (table_name, cinema, run_id desc, attempt desc, started_at desc);
create index pipeline_scrape_snapshots_cleanup_idx
  on public.pipeline_scrape_snapshots (started_at)
  where status <> 'running';
create index pipeline_scrape_snapshots_running_cleanup_idx
  on public.pipeline_scrape_snapshots (started_at)
  where status = 'running';

comment on table public.pipeline_scrape_snapshots is
  'One source attempt per UUID; only complete manifests authorize snapshot-scoped publication or stale-row removal.';
comment on column public.pipeline_scrape_snapshots.row_count is
  'Raw rows successfully inserted for this attempt; zero is valid only when the scraper explicitly confirmed an empty listing.';

create table public.pipeline_match_checkpoints (
  id uuid not null default gen_random_uuid(),
  category text not null,
  identity_key text not null,
  identity_hash text not null,
  input_fingerprint text not null,
  matching_policy_version integer not null,
  decision text not null,
  tmdb_id bigint,
  imdb_id text,
  match_path text,
  alt_options jsonb not null default '[]'::jsonb,
  reason text,
  run_id bigint not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint pipeline_match_checkpoints_pkey primary key (id),
  constraint pipeline_match_checkpoints_category_check check (
    category in ('nowplayings', 'cinematheques', 'comingsoons')
  ),
  constraint pipeline_match_checkpoints_decision_check check (
    decision in ('matched', 'intentional_skip', 'retryable_failure')
  ),
  constraint pipeline_match_checkpoints_tmdb_id_positive check (tmdb_id is null or tmdb_id > 0),
  constraint pipeline_match_checkpoints_alt_options_array check (jsonb_typeof(alt_options) = 'array'),
  constraint pipeline_match_checkpoints_match_has_tmdb check (
    decision <> 'matched' or tmdb_id is not null
  )
);

create index pipeline_match_checkpoints_lookup_idx
  on public.pipeline_match_checkpoints (category, identity_hash, run_id desc, created_at)
  include (input_fingerprint, decision, tmdb_id, imdb_id, match_path, expires_at);
create index pipeline_match_checkpoints_expiry_idx
  on public.pipeline_match_checkpoints (expires_at);

comment on table public.pipeline_match_checkpoints is
  'Append-only identity decisions. Only matched and intentional_skip rows are reusable; retryable failures are diagnostics and never become permanent no-match results.';
comment on column public.pipeline_match_checkpoints.input_fingerprint is
  'Fingerprint of the existing category group, matching evidence, helper rows, and matching policy version.';

create table public.pipeline_publication_checkpoints (
  category text not null,
  snapshot_id uuid not null references public.pipeline_scrape_snapshots (snapshot_id) on delete cascade,
  input_fingerprint text not null,
  phase text not null default 'in_progress',
  has_unresolved boolean not null default false,
  owner_token uuid,
  owner_run_id bigint,
  generation bigint not null default 0,
  last_error_reason text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint pipeline_publication_checkpoints_pkey primary key (category, snapshot_id),
  constraint pipeline_publication_checkpoints_category_check check (
    category in ('nowplayings', 'cinematheques', 'comingsoons')
  ),
  constraint pipeline_publication_checkpoints_phase_check check (
    phase in ('in_progress', 'prepared', 'screenings_written', 'movies_written', 'stale_rows_deleted', 'published')
  ),
  constraint pipeline_publication_checkpoints_generation_nonnegative check (generation >= 0),
  constraint pipeline_publication_checkpoints_owner_pair check (
    (owner_token is null and owner_run_id is null)
    or (owner_token is not null and owner_run_id is not null)
  )
);

create index pipeline_publication_checkpoints_cleanup_idx
  on public.pipeline_publication_checkpoints (updated_at)
  where phase = 'published' and owner_token is null;

comment on table public.pipeline_publication_checkpoints is
  'Per-source publication progress, separate from identity decisions and raw added flags; phases are replayed idempotently until published.';
comment on column public.pipeline_publication_checkpoints.has_unresolved is
  'A published snapshot with unresolved identity work is eligible for another matching attempt on a later run.';


create table public.pipeline_publication_scope_owners (
  category text not null,
  cinema text not null,
  snapshot_id uuid not null references public.pipeline_scrape_snapshots (snapshot_id) on delete cascade,
  owner_token uuid,
  owner_run_id bigint,
  generation bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint pipeline_publication_scope_owners_pkey primary key (category, cinema),
  constraint pipeline_publication_scope_owners_category_check check (
    category in ('nowplayings', 'cinematheques', 'comingsoons')
  ),
  constraint pipeline_publication_scope_owners_generation_check check (generation >= 0),
  constraint pipeline_publication_scope_owners_owner_pair check (
    (owner_token is null and owner_run_id is null)
    or (owner_token is not null and owner_run_id is not null)
  )
);

create index pipeline_publication_scope_owners_snapshot_idx
  on public.pipeline_publication_scope_owners (snapshot_id);

alter table public.pipeline_scrape_snapshots enable row level security;
alter table public.pipeline_match_checkpoints enable row level security;
alter table public.pipeline_publication_checkpoints enable row level security;
alter table public.pipeline_publication_scope_owners enable row level security;

revoke all on table public.pipeline_scrape_snapshots from public, anon, authenticated;
revoke all on table public.pipeline_match_checkpoints from public, anon, authenticated;
revoke all on table public.pipeline_publication_checkpoints from public, anon, authenticated;
revoke all on table public.pipeline_publication_scope_owners from public, anon, authenticated;
grant select, insert, update, delete on table public.pipeline_scrape_snapshots to service_role;
grant select, insert, update, delete on table public.pipeline_match_checkpoints to service_role;
grant select, insert, update, delete on table public.pipeline_publication_checkpoints to service_role;
grant select, insert, update, delete on table public.pipeline_publication_scope_owners to service_role;

create or replace function public.claim_pipeline_publication_checkpoint(
  p_category text,
  p_cinema text,
  p_snapshot_id uuid,
  p_input_fingerprint text,
  p_run_id bigint,
  p_owner_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_checkpoint public.pipeline_publication_checkpoints%rowtype;
  current_scope public.pipeline_publication_scope_owners%rowtype;
  owner_is_running boolean;
  source_table text;
  resume_phase text;
begin
  source_table := case p_category
    when 'nowplayings' then 'allShowtimes'
    when 'cinematheques' then 'allTheques'
    when 'comingsoons' then 'allSoons'
    else null
  end;
  if source_table is null then
    raise exception 'unsupported publication category';
  end if;

  -- A newer failed or running scrape fences off this older source attempt too.
  if not exists (
    select 1
    from public.pipeline_scrape_snapshots as manifest
    where manifest.snapshot_id = p_snapshot_id
      and manifest.table_name = source_table
      and manifest.cinema = p_cinema
      and manifest.status = 'complete'
      and not exists (
        select 1
        from public.pipeline_scrape_snapshots as newer
        where newer.table_name = manifest.table_name
          and newer.cinema = manifest.cinema
          and (newer.run_id, newer.attempt, newer.started_at) > (manifest.run_id, manifest.attempt, manifest.started_at)
      )
  ) then
    return jsonb_build_object('claimed', false, 'state', 'superseded', 'generation', 0);
  end if;

  insert into public.pipeline_publication_checkpoints (
    category, snapshot_id, input_fingerprint, phase
  ) values (
    p_category, p_snapshot_id, p_input_fingerprint, 'in_progress'
  ) on conflict (category, snapshot_id) do nothing;

  select * into current_checkpoint
  from public.pipeline_publication_checkpoints
  where category = p_category and snapshot_id = p_snapshot_id
  for update;

  if current_checkpoint.phase = 'published'
     and current_checkpoint.input_fingerprint = p_input_fingerprint
     and current_checkpoint.has_unresolved = false then
    return jsonb_build_object(
      'claimed', false,
      'state', 'published',
      'generation', current_checkpoint.generation,
      'phase', current_checkpoint.phase
    );
  end if;

  insert into public.pipeline_publication_scope_owners (
    category, cinema, snapshot_id
  ) values (
    p_category, p_cinema, p_snapshot_id
  ) on conflict (category, cinema) do nothing;

  select * into current_scope
  from public.pipeline_publication_scope_owners
  where category = p_category and cinema = p_cinema
  for update;

  if current_scope.snapshot_id = p_snapshot_id
     and current_scope.owner_token = p_owner_token then
    return jsonb_build_object(
      'claimed', true,
      'state', 'in_progress',
      'generation', current_scope.generation,
      'phase', current_checkpoint.phase
    );
  end if;

  select coalesce(bool_or(run_log.running_now is true), false)
  into owner_is_running
  from public."utilRunLogs" as run_log
  where run_log.run_id = current_scope.owner_run_id;

  if current_scope.snapshot_id = p_snapshot_id
     and current_scope.owner_token is not null
     and owner_is_running then
    return jsonb_build_object(
      'claimed', false,
      'state', 'owned_by_active_run',
      'generation', current_scope.generation
    );
  end if;

  -- A newer complete attempt advances the scope generation. Any older worker
  -- immediately loses authority to advance its own snapshot checkpoint.
  update public.pipeline_publication_scope_owners
  set snapshot_id = p_snapshot_id,
      owner_token = p_owner_token,
      owner_run_id = p_run_id,
      generation = current_scope.generation + 1,
      updated_at = now()
  where category = p_category and cinema = p_cinema;

  resume_phase := 'in_progress';
  if current_checkpoint.input_fingerprint = p_input_fingerprint
     and current_checkpoint.has_unresolved = false
     and current_checkpoint.phase in ('prepared', 'screenings_written', 'movies_written', 'stale_rows_deleted') then
    resume_phase := current_checkpoint.phase;
  end if;

  update public.pipeline_publication_checkpoints
  set input_fingerprint = p_input_fingerprint,
      phase = resume_phase,
      has_unresolved = false,
      owner_token = p_owner_token,
      owner_run_id = p_run_id,
      generation = current_scope.generation + 1,
      last_error_reason = null,
      started_at = now(),
      updated_at = now(),
      completed_at = null
  where category = p_category and snapshot_id = p_snapshot_id;

  return jsonb_build_object(
    'claimed', true,
    'state', 'in_progress',
    'generation', current_scope.generation + 1,
    'phase', resume_phase
  );
end;
$function$;

create or replace function public.assert_pipeline_publication_ownership(
  p_category text,
  p_cinema text,
  p_snapshot_id uuid,
  p_input_fingerprint text,
  p_owner_token uuid,
  p_generation bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  source_table text;
begin
  source_table := case p_category
    when 'nowplayings' then 'allShowtimes'
    when 'cinematheques' then 'allTheques'
    when 'comingsoons' then 'allSoons'
    else null
  end;
  if source_table is null then
    return false;
  end if;

  return exists (
    select 1
    from public.pipeline_publication_scope_owners as scope_claim
    join public.pipeline_publication_checkpoints as checkpoint
      on checkpoint.category = scope_claim.category
     and checkpoint.snapshot_id = scope_claim.snapshot_id
    join public.pipeline_scrape_snapshots as manifest
      on manifest.snapshot_id = scope_claim.snapshot_id
    where scope_claim.category = p_category
      and scope_claim.cinema = p_cinema
      and scope_claim.snapshot_id = p_snapshot_id
      and scope_claim.owner_token = p_owner_token
      and scope_claim.generation = p_generation
      and checkpoint.input_fingerprint = p_input_fingerprint
      and checkpoint.owner_token = p_owner_token
      and checkpoint.generation = p_generation
      and manifest.table_name = source_table
      and manifest.cinema = p_cinema
      and manifest.status = 'complete'
      and not exists (
        select 1
        from public.pipeline_scrape_snapshots as newer
        where newer.table_name = manifest.table_name
          and newer.cinema = manifest.cinema
          and (newer.run_id, newer.attempt, newer.started_at) > (manifest.run_id, manifest.attempt, manifest.started_at)
      )
  );
end;
$function$;

create or replace function public.advance_pipeline_publication_checkpoint(
  p_category text,
  p_cinema text,
  p_snapshot_id uuid,
  p_input_fingerprint text,
  p_owner_token uuid,
  p_generation bigint,
  p_phase text,
  p_has_unresolved boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  updated_count integer;
  source_table text;
begin
  if p_phase not in ('prepared', 'screenings_written', 'movies_written', 'stale_rows_deleted', 'published') then
    raise exception 'unsupported publication phase';
  end if;
  source_table := case p_category
    when 'nowplayings' then 'allShowtimes'
    when 'cinematheques' then 'allTheques'
    when 'comingsoons' then 'allSoons'
    else null
  end;
  if source_table is null then
    raise exception 'unsupported publication category';
  end if;

  if not exists (
    select 1
    from public.pipeline_publication_scope_owners as owner
    where owner.category = p_category
      and owner.cinema = p_cinema
      and owner.snapshot_id = p_snapshot_id
      and owner.owner_token = p_owner_token
      and owner.generation = p_generation
  ) or not exists (
    select 1
    from public.pipeline_scrape_snapshots as manifest
    where manifest.snapshot_id = p_snapshot_id
      and manifest.table_name = source_table
      and manifest.cinema = p_cinema
      and manifest.status = 'complete'
      and not exists (
        select 1
        from public.pipeline_scrape_snapshots as newer
        where newer.table_name = manifest.table_name
          and newer.cinema = manifest.cinema
          and (newer.run_id, newer.attempt, newer.started_at) > (manifest.run_id, manifest.attempt, manifest.started_at)
      )
  ) then
    return false;
  end if;

  update public.pipeline_publication_checkpoints as checkpoint
  set phase = p_phase,
      has_unresolved = checkpoint.has_unresolved or p_has_unresolved,
      updated_at = now(),
      completed_at = case when p_phase = 'published' then now() else null end
  where category = p_category
    and snapshot_id = p_snapshot_id
    and input_fingerprint = p_input_fingerprint
    and owner_token = p_owner_token
    and generation = p_generation
    and case checkpoint.phase
      when 'in_progress' then 0
      when 'prepared' then 1
      when 'screenings_written' then 2
      when 'movies_written' then 3
      when 'stale_rows_deleted' then 4
      when 'published' then 5
      else -1
    end <= case p_phase
      when 'prepared' then 1
      when 'screenings_written' then 2
      when 'movies_written' then 3
      when 'stale_rows_deleted' then 4
      when 'published' then 5
      else -1
    end;

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$function$;

create or replace function public.release_pipeline_publication_checkpoint(
  p_category text,
  p_cinema text,
  p_snapshot_id uuid,
  p_input_fingerprint text,
  p_owner_token uuid,
  p_generation bigint,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  checkpoint_count integer;
  owner_count integer;
begin
  update public.pipeline_publication_checkpoints
  set owner_token = null,
      owner_run_id = null,
      last_error_reason = nullif(left(coalesce(p_reason, ''), 100), ''),
      updated_at = now()
  where category = p_category
    and snapshot_id = p_snapshot_id
    and input_fingerprint = p_input_fingerprint
    and owner_token = p_owner_token
    and generation = p_generation;
  get diagnostics checkpoint_count = row_count;

  update public.pipeline_publication_scope_owners
  set owner_token = null,
      owner_run_id = null,
      updated_at = now()
  where category = p_category
    and cinema = p_cinema
    and snapshot_id = p_snapshot_id
    and owner_token = p_owner_token
    and generation = p_generation;
  get diagnostics owner_count = row_count;
  return checkpoint_count = 1 and owner_count = 1;
end;
$function$;

create or replace function public.cleanup_pipeline_reliability_state(p_limit integer default 250)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  limit_count integer := greatest(1, least(coalesce(p_limit, 250), 1000));
  match_count integer := 0;
  publication_count integer := 0;
  snapshot_count integer := 0;
begin
  update public.pipeline_scrape_snapshots as manifest
  set status = 'failed',
      completed_at = now(),
      failure_reason = 'stale_running_scrape'
  where manifest.status = 'running'
    and manifest.started_at < now() - interval '1 day'
    and not exists (
      select 1
      from public."utilRunLogs" as run_log
      where run_log.run_id = manifest.run_id
        and run_log.running_now is true
    );

  with expired as (
    select id
    from public.pipeline_match_checkpoints
    where expires_at < now()
    order by expires_at
    limit limit_count
  )
  delete from public.pipeline_match_checkpoints as checkpoint
  using expired
  where checkpoint.id = expired.id;
  get diagnostics match_count = row_count;

  with old_publications as (
    select checkpoint.category, checkpoint.snapshot_id
    from public.pipeline_publication_checkpoints as checkpoint
    where checkpoint.phase = 'published'
      and checkpoint.owner_token is null
      and checkpoint.updated_at < now() - interval '90 days'
      and not exists (
        select 1
        from public.pipeline_scrape_snapshots as manifest
        where manifest.snapshot_id = checkpoint.snapshot_id
          and manifest.status = 'complete'
          and not exists (
            select 1
            from public.pipeline_scrape_snapshots as newer
            where newer.table_name = manifest.table_name
              and newer.cinema = manifest.cinema
              and (newer.run_id, newer.attempt, newer.started_at) > (manifest.run_id, manifest.attempt, manifest.started_at)
          )
      )
    order by checkpoint.updated_at
    limit limit_count
  )
  delete from public.pipeline_publication_checkpoints as checkpoint
  using old_publications
  where checkpoint.category = old_publications.category
    and checkpoint.snapshot_id = old_publications.snapshot_id;
  get diagnostics publication_count = row_count;

  with old_snapshots as (
    select manifest.snapshot_id
    from public.pipeline_scrape_snapshots as manifest
    where manifest.status <> 'running'
      and manifest.started_at < now() - interval '90 days'
      and exists (
        select 1
        from public.pipeline_scrape_snapshots as newer
        where newer.table_name = manifest.table_name
          and newer.cinema = manifest.cinema
          and (newer.run_id, newer.attempt, newer.started_at) > (manifest.run_id, manifest.attempt, manifest.started_at)
      )
      and not exists (
        select 1
        from public.pipeline_publication_scope_owners as owner
        join public."utilRunLogs" as run_log on run_log.run_id = owner.owner_run_id
        where owner.snapshot_id = manifest.snapshot_id
          and owner.owner_token is not null
          and run_log.running_now is true
      )
    order by manifest.started_at
    limit limit_count
  )
  delete from public.pipeline_scrape_snapshots as manifest
  using old_snapshots
  where manifest.snapshot_id = old_snapshots.snapshot_id;
  get diagnostics snapshot_count = row_count;

  return jsonb_build_object(
    'match_checkpoints_deleted', match_count,
    'publication_checkpoints_deleted', publication_count,
    'scrape_snapshots_deleted', snapshot_count
  );
end;
$function$;

revoke all on function public.claim_pipeline_publication_checkpoint(text, text, uuid, text, bigint, uuid)
  from public, anon, authenticated;
revoke all on function public.assert_pipeline_publication_ownership(text, text, uuid, text, uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.assert_pipeline_publication_ownership(text, text, uuid, text, uuid, bigint)
  to service_role;
revoke all on function public.advance_pipeline_publication_checkpoint(text, text, uuid, text, uuid, bigint, text, boolean)
  from public, anon, authenticated;
revoke all on function public.release_pipeline_publication_checkpoint(text, text, uuid, text, uuid, bigint, text)
  from public, anon, authenticated;
revoke all on function public.cleanup_pipeline_reliability_state(integer)
  from public, anon, authenticated;
grant execute on function public.claim_pipeline_publication_checkpoint(text, text, uuid, text, bigint, uuid)
  to service_role;
grant execute on function public.advance_pipeline_publication_checkpoint(text, text, uuid, text, uuid, bigint, text, boolean)
  to service_role;
grant execute on function public.release_pipeline_publication_checkpoint(text, text, uuid, text, uuid, bigint, text)
  to service_role;
grant execute on function public.cleanup_pipeline_reliability_state(integer)
  to service_role;
