// Operator-only; never imported by the application or executed during builds.
import { createDatabase } from "../dist/db/client.js";
const [action, userId] = process.argv.slice(2);
if (
  !["grant", "revoke"].includes(action) ||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    userId ?? "",
  )
) {
  throw new Error(
    "Usage: node packages/server/scripts/set-admin.mjs grant|revoke <trusted-user-uuid>",
  );
}
if (!process.env.MIGRATION_DATABASE_URL)
  throw new Error(
    "An operator MIGRATION_DATABASE_URL is required; runtime DATABASE_URL is never used.",
  );
const database = createDatabase(process.env.MIGRATION_DATABASE_URL, {
  sslCaCertificate: process.env.DATABASE_SSL_CA_CERT,
});
const client = await database.pool.connect();
try {
  await client.query("BEGIN");
  const user = await client.query(
    "SELECT id FROM app_auth.users WHERE id=$1 AND email_verified FOR UPDATE",
    [userId],
  );
  if (user.rowCount !== 1)
    throw new Error(
      "The selected identity must exist and have a verified email.",
    );
  if (action === "grant")
    await client.query(
      "INSERT INTO public.admin_users(user_id) VALUES ($1) ON CONFLICT DO NOTHING",
      [userId],
    );
  else
    await client.query("DELETE FROM public.admin_users WHERE user_id=$1", [
      userId,
    ]);
  await client.query("COMMIT");
  console.log(
    `Administrator membership ${action === "grant" ? "granted" : "revoked"} for ${userId}.`,
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await database.close();
}
