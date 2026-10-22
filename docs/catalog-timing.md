# Catalog request timings

The root `tsconfig.json` is shared by Vercel's API compiler and `npm run
api:typecheck`. It keeps the deployment compiler aligned with CI's strict checking
and modern Node.js library definitions. The frontend and server packages retain
their own existing compiler configurations.

Production emits one JSON `catalog_timing` line for each request to
`/api/v1/catalog/now-playing` or `/api/v1/catalog/coming-soon`. Search Vercel runtime
logs for that event. Other routes do not emit these timing records.

Each record contains a generated request ID, a process-local instance ID, catalog
mode, HTTP status, completion outcome, response duration and named stage timings
(milliseconds, call count and failure count). No query strings, SQL, parameters,
cookies, account identifiers, database URLs or error messages are recorded.
Vercel's normal log envelope supplies its platform request ID and region.

| Field/stage          | Meaning                                                                                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `firstApiRequest`    | First API dispatch in this module instance; not a platform cold-start flag. An auth request can initialize the app before the catalog.                                                                      |
| `moduleAgeMs`        | Elapsed time since the timing module evaluated, at request entry.                                                                                                                                           |
| `dispatcherImportMs` | Evaluation interval from the first timing import until the dispatcher module body runs. Excludes platform provisioning and work before that import; repeated as instance metadata, not a per-request stage. |
| `runtime_init`       | Synchronous production app composition, only when it occurs in this catalog request.                                                                                                                        |
| `db_checkout`        | Drizzle's pool checkout, including queueing, a new connection when needed, and driver scheduling.                                                                                                           |
| `db_connect`         | Successful new PostgreSQL connection setup (including TLS/authentication), nested inside checkout. Absent for a reused connection, or when checkout fails before a client is returned.                      |
| `snapshot`           | Existing publication transaction elapsed at response completion, including checkout, BEGIN, reads and response work. Usually still in flight when the response finishes.                                    |
| `revision_read`      | Publication revision query round trip.                                                                                                                                                                      |
| `movie_rows`         | Catalog row read, including its driver mapping.                                                                                                                                                             |
| `movie_codes`        | Code lookup duration, including all existing chunks; count is lookup calls.                                                                                                                                 |
| `response_json`      | Existing Express JSON serialization/send call; excludes later platform compression and network delivery.                                                                                                    |

Timings **overlap; do not add every stage together**. On successful new checkouts,
`db_checkout - db_connect` measures non-connection checkout time (queueing plus
driver scheduling), not pure queue time. Query timings include network waits and
driver work, not just PostgreSQL execution. BEGIN/COMMIT are not separately measured.

`responseFinishedMs` ends at Node's response `finish` event, or `close`/a synchronous
dispatch throw (see `outcome`). Logging happens immediately at response completion,
without waiting for the
transaction's existing post-response commit or keeping the function alive. An
unresolved stage has `inFlight` set to its active call count; its `ms` is elapsed
time so far, and `errors: 0` does not establish success. A later commit/rollback is
not captured by that record. This also permits logging an aborted request while
its query remains unresolved. Logging failures are swallowed. These logs cannot measure browser scripts,
posters, or Vercel
startup before application JavaScript begins. No response headers are added.
