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

comment on table public.pipeline_scrape_snapshots is
  'One source attempt per UUID; only complete manifests authorize snapshot-scoped publication or stale-row removal.';
comment on column public.pipeline_scrape_snapshots.row_count is
  'Raw rows successfully inserted for this attempt; zero is valid only when the scraper explicitly confirmed an empty listing.';

create table public.pipeline_publication_checkpoints (
  category text not null,
  snapshot_id uuid not null references public.pipeline_scrape_snapshots (snapshot_id) on delete cascade,
  input_fingerprint text not null,
  phase text not null default 'in_progress',
  has_unresolved boolean not null default false,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint pipeline_publication_checkpoints_pkey primary key (category, snapshot_id),
  constraint pipeline_publication_checkpoints_category_check check (
    category in ('nowplayings', 'cinematheques', 'comingsoons')
  ),
  constraint pipeline_publication_checkpoints_phase_check check (
    phase in ('in_progress', 'prepared', 'screenings_written', 'movies_written', 'stale_rows_deleted', 'published')
  )
);

comment on table public.pipeline_publication_checkpoints is
  'Per-source publication progress, independent of TMDb match results and raw added flags; phases are replayed idempotently until published.';
comment on column public.pipeline_publication_checkpoints.has_unresolved is
  'A published snapshot with unresolved identity work is eligible for another matching attempt on a later run.';


alter table public.pipeline_scrape_snapshots enable row level security;
alter table public.pipeline_publication_checkpoints enable row level security;

revoke all on table public.pipeline_scrape_snapshots from public, anon, authenticated;
revoke all on table public.pipeline_publication_checkpoints from public, anon, authenticated;
grant select, insert, update, delete on table public.pipeline_scrape_snapshots to service_role;
grant select, insert, update, delete on table public.pipeline_publication_checkpoints to service_role;

create or replace function public.claim_pipeline_publication_checkpoint(
  p_category text,
  p_cinema text,
  p_snapshot_id uuid,
  p_input_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_checkpoint public.pipeline_publication_checkpoints%rowtype;
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

  -- Only the latest complete source attempt may publish or remove stale rows.
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
    return jsonb_build_object('claimed', false, 'state', 'superseded');
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
      'phase', current_checkpoint.phase
    );
  end if;

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
      started_at = now(),
      updated_at = now(),
      completed_at = null
  where category = p_category and snapshot_id = p_snapshot_id;

  return jsonb_build_object(
    'claimed', true,
    'state', 'in_progress',
    'phase', resume_phase
  );
end;
$function$;


create or replace function public.advance_pipeline_publication_checkpoint(
  p_category text,
  p_cinema text,
  p_snapshot_id uuid,
  p_input_fingerprint text,
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




revoke all on function public.claim_pipeline_publication_checkpoint(text, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.advance_pipeline_publication_checkpoint(text, text, uuid, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_pipeline_publication_checkpoint(text, text, uuid, text)
  to service_role;
grant execute on function public.advance_pipeline_publication_checkpoint(text, text, uuid, text, text, boolean)
  to service_role;
