# Runtime validation

Kartiseret uses Zod at trust boundaries and TypeScript inside those boundaries. The goal is consistent runtime safety without repeatedly parsing values that the application has already validated.

## Boundary rule

Parse an unknown value once, immediately when it enters or leaves a trusted part of the application:

- Supabase rows, authentication responses, and mutation inputs
- environment variables and server request data
- URL and router state
- local storage, custom events, and experimental browser APIs
- remote URLs, response headers, and response metadata
- form values before authentication or persistence

Use `parseBoundary(schema, value, context)` when malformed data must stop the operation. Use `schema.safeParse(value)` when invalid input has a normal recovery path such as a form error, fallback value, migration, or HTTP fallback response. Use `safeParseJson(raw, schema)` for optional JSON-backed storage or legacy database fields.

After the boundary parse, use `z.infer`, `z.input`, or `z.output` types and pass the parsed value through internal functions without reparsing it. React props, state, and ordinary typed helpers are not trust boundaries.

## Schema placement

- `src/validation/runtime.ts` owns reusable primitives and the shared parsing helpers.
- `src/data/externalSchemas.ts` owns runtime schemas for external database rows and mutation inputs.
- `src/data/ticketAlertSchemas.ts` owns ticket-alert forms, account rows, guest RPC responses, listing projections, and guest storage. Normalized subscription and listing types are inferred from those schemas.
- `src/data/applicationSchemas.ts` owns internal model contracts and their inferred types. These schemas support fixtures and future normalized-model ingress, but normal internal mapping is type-checked rather than reparsed.
- Feature-specific recoverable schemas stay beside the boundary that owns their fallback behavior.
- `server/og/schemas.ts` owns server request, database-response, and preview-output contracts.

Do not create a general schema barrel or a second validation library. Direct imports make ownership visible and keep bundling predictable.

## Persistence

Storage keys must be versioned, store only the fields the UI needs, and wrap reads and writes in `try`/`catch`. Stored JSON and cross-tab/custom-event values must be parsed or migrated before use. Database mutation entrypoints validate user-controlled inputs before issuing a write.

Guest ticket-alert storage keeps its existing `v1` format. Invalid cached entries are dropped independently so one corrupt entry does not hide valid subscriptions. The separate guest UUID token is a bearer credential, not disposable UI state: validate an existing token, never silently replace a malformed token, and require cryptographically secure randomness and writable storage to create one. A missing or invalid token must not be reported as a confirmed cancellation of a cached subscription.

## Ticket-alert boundary behavior

- Validate account/guest inputs once in the public service entrypoint; private helpers consume the inferred output. The UI passes form values to that boundary instead of maintaining a second email validator. The email schema intentionally matches the checked-in SQL constraint, including international addresses.
- Validate account rows and guest RPC responses before using them. Missing required columns, malformed timestamps, or mismatched response identities stop the operation. Save the server-returned email and creation timestamp only after validating the creation response; remove a cached subscription only after a valid cancellation result.
- Invalid optional ticket URLs may fall back to the other language. Unusable listing rows are skipped, while a malformed page envelope is an error. Count every source row for pagination, including skipped rows, so validation never prematurely stops a full page.
- Use the same showtime/date/ID primitives as the catalog. Alert RPC IDs additionally must fit JavaScript's safe integer range because the RPC arguments are numeric.
- Read signup-location metadata as unknown, parse it once, and fall back to the validated guest location or default. Newly built preferences are already typed internal values and do not need another row parse.
- Use `buildMovieShowtimeSharePath` for relative in-app links. Absolute share URLs continue to require a valid HTTP(S) origin; an empty origin is not a relative-path API.

## Tests and bundle budget

Runtime validation tests use fixtures only. They must not connect to Supabase or other production services. Ticket-alert service tests replace the Supabase module before import, use in-memory storage, and forbid network fetches. They cover validation failures before mutation, malformed RPC responses, token safety, cache recovery, pagination, and relative links. Do not run migrations, send email, or use live account/guest subscriptions to test validation changes.

`npm run build` creates the production bundle. `npm run bundle:check` then measures the entry module plus every `modulepreload` referenced by `dist/index.html`. The default eager-JavaScript budget is 200 KiB gzip and can be overridden in CI with `EAGER_JS_GZIP_BUDGET_BYTES`.

Use `npm run verify` for the complete local/CI validation sequence.
