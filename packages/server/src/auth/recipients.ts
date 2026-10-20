import { createHash, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { z } from "zod";
import { user } from "./schema.js";

const requestSchema = z
  .object({ userIds: z.array(z.string().uuid()).min(1).max(100) })
  .strict();
export function createRecipientRouter(pool: Pool, secret: string) {
  const router = Router();
  const database = drizzle(pool);
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  router.post("/ticket-alert-recipients", async (request, response) => {
    const supplied = createHash("sha256")
      .update(request.headers.authorization ?? "")
      .digest();
    if (!timingSafeEqual(expected, supplied)) {
      response.status(401).json({
        data: null,
        error: {
          code: "unauthorized",
          message: "An internal credential is required.",
        },
      });
      return;
    }
    const input = requestSchema.safeParse(request.body);
    if (!input.success) {
      response.status(400).json({
        data: null,
        error: {
          code: "invalid_request",
          message: "Provide between 1 and 100 valid user IDs.",
        },
      });
      return;
    }
    const data = await database
      .select({
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
      })
      .from(user)
      .where(inArray(user.id, [...new Set(input.data.userIds)]));
    response.json({ data, error: null });
  });
  return router;
}
