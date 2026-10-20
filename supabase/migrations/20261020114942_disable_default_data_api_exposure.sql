-- Disable automatic Data API grants for future public entities created by postgres.
-- Supabase's Data API settings toggle uses these default privileges. Revoke ALL
-- for tables/sequences so ancillary rights do not remain after CRUD is revoked.
-- Existing object grants are unchanged; workers retain their explicit access.
BEGIN;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM public, anon, authenticated, service_role;

COMMIT;
