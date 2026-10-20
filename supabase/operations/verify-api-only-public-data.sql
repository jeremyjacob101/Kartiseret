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
