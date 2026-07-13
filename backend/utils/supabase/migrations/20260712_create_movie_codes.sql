begin;

create or replace function public.encode_base62_3(input_value integer)
returns text
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
declare
    alphabet constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    remaining integer := input_value;
    result text := '';
begin
    if input_value < 0 or input_value >= 238328 then
        raise exception 'movie code value % is outside the 3-character base62 range', input_value;
    end if;

    for position in 1..3 loop
        result := substr(alphabet, (remaining % 62) + 1, 1) || result;
        remaining := remaining / 62;
    end loop;

    return result;
end;
$$;

create table if not exists public.movie_codes (
    code_number integer generated always as identity (
        start with 0
        increment by 1
        minvalue 0
        maxvalue 238327
        cache 1
    ) primary key,
    tmdb_id bigint not null unique,
    movie_code text generated always as (public.encode_base62_3(code_number)) stored,
    created_at timestamptz not null default timezone('utc', now()),
    constraint movie_codes_tmdb_id_positive check (tmdb_id > 0),
    constraint movie_codes_movie_code_format check (movie_code ~ '^[0-9A-Za-z]{3}$'),
    constraint movie_codes_movie_code_unique unique (movie_code)
);

alter table public.movie_codes enable row level security;

create or replace function public.ensure_movie_code(p_tmdb_id bigint)
returns table (tmdb_id bigint, movie_code text)
language plpgsql
security definer
set search_path = ''
as $$
begin
    if p_tmdb_id is null or p_tmdb_id <= 0 then
        raise exception 'tmdb_id must be a positive integer';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(p_tmdb_id);

    return query
    select code.tmdb_id, code.movie_code
    from public.movie_codes code
    where code.tmdb_id = p_tmdb_id;

    if found then
        return;
    end if;

    insert into public.movie_codes (tmdb_id)
    values (p_tmdb_id);

    return query
    select code.tmdb_id, code.movie_code
    from public.movie_codes code
    where code.tmdb_id = p_tmdb_id;
end;
$$;

create or replace function public.ensure_movie_codes(p_tmdb_ids bigint[])
returns table (tmdb_id bigint, movie_code text)
language plpgsql
security definer
set search_path = ''
as $$
begin
    return query
    select assigned.tmdb_id, assigned.movie_code
    from (
        select distinct incoming.tmdb_id
        from unnest(coalesce(p_tmdb_ids, array[]::bigint[])) as incoming(tmdb_id)
        where incoming.tmdb_id > 0
        order by incoming.tmdb_id
    ) ids
    cross join lateral public.ensure_movie_code(ids.tmdb_id) assigned;
end;
$$;

revoke all on function public.ensure_movie_code(bigint) from public;
revoke all on function public.ensure_movie_codes(bigint[]) from public;
grant execute on function public.ensure_movie_code(bigint) to service_role;
grant execute on function public.ensure_movie_codes(bigint[]) to service_role;

with tmdb_ids as (
    select distinct trim(tmdb_id::text)::bigint as tmdb_id
    from public."finalMovies"
    where tmdb_id is not null and trim(tmdb_id::text) ~ '^[0-9]+$'

    union

    select distinct trim(tmdb_id::text)::bigint as tmdb_id
    from public."finalSoons"
    where tmdb_id is not null and trim(tmdb_id::text) ~ '^[0-9]+$'
), grouped_tmdb_ids as (
    select array_agg(tmdb_id order by tmdb_id) as ids
    from tmdb_ids
)
select assigned.tmdb_id, assigned.movie_code
from grouped_tmdb_ids
cross join lateral public.ensure_movie_codes(grouped_tmdb_ids.ids) assigned;

commit;
