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
- `src/data/applicationSchemas.ts` owns internal model contracts and their inferred types. These schemas support fixtures and future normalized-model ingress, but normal internal mapping is type-checked rather than reparsed.
- Feature-specific recoverable schemas stay beside the boundary that owns their fallback behavior.
- `server/og/schemas.ts` owns server request, database-response, and preview-output contracts.

Do not create a general schema barrel or a second validation library. Direct imports make ownership visible and keep bundling predictable.

## Persistence

Storage keys must be versioned, store only the fields the UI needs, and wrap reads and writes in `try`/`catch`. Stored JSON and cross-tab/custom-event values must be parsed or migrated before use. Database mutation entrypoints validate user-controlled inputs before issuing a write.

## Tests and bundle budget

Runtime validation tests use fixtures only. They must not connect to Supabase or other production services.

`npm run build` creates the production bundle. `npm run bundle:check` then measures the entry module plus every `modulepreload` referenced by `dist/index.html`. The default eager-JavaScript budget is 200 KiB gzip and can be overridden in CI with `EAGER_JS_GZIP_BUDGET_BYTES`.

Use `npm run verify` for the complete local/CI validation sequence.
