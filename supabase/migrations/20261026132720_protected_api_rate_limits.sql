BEGIN;

CREATE TABLE app_auth.protected_rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL CHECK (count > 0),
  reset_at timestamptz NOT NULL
);
CREATE INDEX protected_rate_limits_reset_at_idx
  ON app_auth.protected_rate_limits (reset_at);

REVOKE ALL ON TABLE app_auth.protected_rate_limits
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE app_auth.protected_rate_limits
  TO kartiseret_runtime;
ALTER TABLE app_auth.protected_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY server_runtime ON app_auth.protected_rate_limits
  FOR ALL TO kartiseret_runtime
  USING (true)
  WITH CHECK (true);

COMMIT;
