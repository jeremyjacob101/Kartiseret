BEGIN;

CREATE TABLE app_auth.public_routes (
  code text PRIMARY KEY CHECK (code ~ '^[a-z0-9]{8}$'),
  destination_key text NOT NULL UNIQUE CHECK (length(destination_key) BETWEEN 1 AND 240),
  destination_type text NOT NULL CHECK (
    destination_type IN ('page', 'movie', 'cinema', 'city', 'share')
  ),
  destination_id text NOT NULL CHECK (length(destination_id) BETWEEN 1 AND 240),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT public_routes_share_payload_size CHECK (octet_length(payload::text) <= 8192)
);

CREATE INDEX public_routes_created_at_idx
  ON app_auth.public_routes (created_at);

REVOKE ALL ON TABLE app_auth.public_routes
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE app_auth.public_routes TO kartiseret_runtime;
GRANT UPDATE (destination_key) ON TABLE app_auth.public_routes TO kartiseret_runtime;

ALTER TABLE app_auth.public_routes ENABLE ROW LEVEL SECURITY;
CREATE POLICY server_runtime ON app_auth.public_routes
  FOR ALL TO kartiseret_runtime
  USING (true)
  WITH CHECK (true);

COMMIT;
