# PostgreSQL publication publisher

The Python pipeline can publish prepared categories through a verified PostgreSQL
session. It bulk-stages the same canonical parts used by the REST path, then runs
the existing category publication algorithm in one bounded transaction. The
normal REST entrypoint remains available during rollout.

## Provision after the additive migration

Apply the migration before configuring the runner secrets. It creates two
`NOLOGIN` roles:

- `kartiseret_publisher` can write/read publication staging rows, create
  temporary tables, and execute the direct publisher entrypoint. It has no
  receipt-update RLS policy, so it cannot mark a publication as applied.
- `kartiseret_publication_executor` owns the validated security-definer
  implementation. It has explicit access to the publication, raw, final,
  checkpoint, snapshot, manual matching evidence, revision, and movie-code
  objects required by that implementation. It has no login, superuser,
  `BYPASSRLS`, role-management, schema-creation, or authentication-table access.

Provision a dedicated login with a generated password in Supabase SQL Editor or
your controlled database administration process. Do not use the project
`postgres`, `service_role`, or API login:

```sql
CREATE ROLE kartiseret_publisher_login
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD 'use-a-new-generated-secret';
GRANT kartiseret_publisher TO kartiseret_publisher_login
  WITH INHERIT FALSE, SET TRUE;
```

Use the **direct database endpoint** or **Supavisor session mode** on port 5432.
Do not use transaction-pooler port 6543. The connection user is
`kartiseret_publisher_login` for direct connections; Supavisor may require the
project reference suffix in the user name. Copy the full Supabase database CA
certificate from Database Settings → SSL Configuration.

Store the connection URL and CA PEM as GitHub Actions secrets in each repository
environment used by `Run Main`, `Daily Sweep`, and `Daily Orphan Movie Cleanup`:

- `PUBLICATION_DATABASE_URL`
- `PUBLICATION_DATABASE_SSL_CA_CERT`

Use the same names in local runner environment files. The URL must use verified
TLS; the application enforces `sslmode=verify-full`, checks the host name, and
requires port 5432. Never commit either value. Missing URL keeps the REST path;
an invalid configured URL or certificate fails the run without falling back.

## Rollout and rollback

1. Apply the additive migration.
2. Provision the login and verify that it can connect with the supplied CA and
   `SET ROLE kartiseret_publisher`.
3. Add the two secrets to the runner environment.
4. Run a controlled category pipeline and check its publication phase metrics
   and final applied receipt before enabling scheduled runs.

Rollback by removing `PUBLICATION_DATABASE_URL` and
`PUBLICATION_DATABASE_SSL_CA_CERT` from the runner environment. Python then uses
the existing REST publication path. The additive schema and roles can remain in
place while the issue is investigated. If the database login is suspected to
be compromised, revoke its membership and rotate or drop the login separately.

The implementation records staging, SQL phase, and transaction/commit
acknowledgement durations, row/part counts, publication identity, and SQLSTATE.
It does not include credentials or row payloads. A production speed claim still
requires measurement on the hosted runner and Supabase compute used in rollout.
