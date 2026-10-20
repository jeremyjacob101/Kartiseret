-- Read-only postflight for api_only_catalog_access.
-- Expected: RLS enabled on every row; browser access/SELECT policies false or
-- zero; kartiseret_api can read the six API tables; service_role can still read
-- all tables for the worker and maintenance jobs.
WITH expected_access(table_name, api_reads) AS (
  VALUES
    ('allShowtimes', false),
    ('allSoons', false),
    ('allTheques', false),
    ('cities', true),
    ('finalMovies', true),
    ('finalShowtimes', true),
    ('finalSoons', true),
    ('finalThequeMovies', false),
    ('finalTheques', false),
    ('movieCodes', true),
    ('tableFixes', false),
    ('tableSkips', false),
    ('theaters', true),
    ('utilAvgTime', false),
    ('utilRunLogs', false)
)
SELECT expected_access.table_name,
       expected_access.api_reads,
       relation.relrowsecurity AS rls_enabled,
       has_table_privilege('anon', format('public.%I', expected_access.table_name), 'SELECT')
         OR has_any_column_privilege('anon', format('public.%I', expected_access.table_name), 'SELECT') AS anon_select,
       has_table_privilege('authenticated', format('public.%I', expected_access.table_name), 'SELECT')
         OR has_any_column_privilege('authenticated', format('public.%I', expected_access.table_name), 'SELECT') AS authenticated_select,
       (has_table_privilege('anon', format('public.%I', expected_access.table_name), 'INSERT')
         OR has_table_privilege('anon', format('public.%I', expected_access.table_name), 'UPDATE')
         OR has_table_privilege('anon', format('public.%I', expected_access.table_name), 'DELETE')
         OR has_table_privilege('anon', format('public.%I', expected_access.table_name), 'TRUNCATE')
         OR has_table_privilege('anon', format('public.%I', expected_access.table_name), 'REFERENCES')
         OR has_table_privilege('anon', format('public.%I', expected_access.table_name), 'TRIGGER')
         OR has_table_privilege('anon', format('public.%I', expected_access.table_name), 'MAINTAIN')) AS anon_other_privileges,
       (has_table_privilege('authenticated', format('public.%I', expected_access.table_name), 'INSERT')
         OR has_table_privilege('authenticated', format('public.%I', expected_access.table_name), 'UPDATE')
         OR has_table_privilege('authenticated', format('public.%I', expected_access.table_name), 'DELETE')
         OR has_table_privilege('authenticated', format('public.%I', expected_access.table_name), 'TRUNCATE')
         OR has_table_privilege('authenticated', format('public.%I', expected_access.table_name), 'REFERENCES')
         OR has_table_privilege('authenticated', format('public.%I', expected_access.table_name), 'TRIGGER')
         OR has_table_privilege('authenticated', format('public.%I', expected_access.table_name), 'MAINTAIN')) AS authenticated_other_privileges,
       has_table_privilege('kartiseret_api', format('public.%I', expected_access.table_name), 'SELECT') AS api_role_select,
       has_table_privilege('service_role', format('public.%I', expected_access.table_name), 'SELECT') AS service_role_select,
       (
         SELECT count(*)
         FROM pg_policies policy
         WHERE policy.schemaname = 'public'
           AND policy.tablename = expected_access.table_name
           AND policy.cmd = 'SELECT'
           AND policy.roles && ARRAY['public'::name, 'anon'::name, 'authenticated'::name]
       ) AS browser_select_policy_count,
       (
         SELECT count(*)
         FROM pg_policies policy
         WHERE policy.schemaname = 'public'
           AND policy.tablename = expected_access.table_name
           AND policy.cmd = 'SELECT'
           AND 'kartiseret_runtime'::name = ANY(policy.roles)
       ) AS runtime_select_policy_count
FROM expected_access
JOIN pg_class relation ON relation.oid = to_regclass(format('public.%I', expected_access.table_name))
ORDER BY expected_access.table_name;

-- Expected: zero. This covers the postgres defaults used by the Dashboard's
-- automatic exposure switch, without changing Supabase-managed role defaults.
SELECT count(*) AS default_data_api_grants_remaining
FROM pg_default_acl defaults
JOIN pg_namespace namespace ON namespace.oid = defaults.defaclnamespace
JOIN pg_roles owner_role ON owner_role.oid = defaults.defaclrole
CROSS JOIN LATERAL aclexplode(defaults.defaclacl) privilege
JOIN pg_roles grantee ON grantee.oid = privilege.grantee
WHERE namespace.nspname = 'public'
  AND owner_role.rolname = 'postgres'
  AND defaults.defaclobjtype IN ('r', 'f', 'S')
  AND grantee.rolname IN ('anon', 'authenticated', 'service_role');

-- The concurrent dataflow checkpoint migration remains service-only.
-- Expected: two rows, RLS true, browser/runtime SELECT false, worker CRUD true.
SELECT relation.relname AS table_name,
       relation.relrowsecurity AS rls_enabled,
       has_table_privilege('anon', relation.oid, 'SELECT') AS anon_select,
       has_table_privilege('authenticated', relation.oid, 'SELECT') AS authenticated_select,
       has_table_privilege('kartiseret_api', relation.oid, 'SELECT') AS api_select,
       has_table_privilege('service_role', relation.oid, 'SELECT')
         AND has_table_privilege('service_role', relation.oid, 'INSERT')
         AND has_table_privilege('service_role', relation.oid, 'UPDATE')
         AND has_table_privilege('service_role', relation.oid, 'DELETE') AS worker_crud
FROM pg_class relation
JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = 'public'
  AND relation.relname IN ('pipeline_scrape_snapshots', 'pipeline_publication_checkpoints')
ORDER BY relation.relname;
