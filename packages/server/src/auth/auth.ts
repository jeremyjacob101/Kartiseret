import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from "@kartiseret/contracts/private-data";
import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth/minimal";
import type { Auth, BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { z } from "zod";
import { authSchema } from "./schema.js";
import type { AuthMailer } from "./mail.js";

export interface ApplicationAuthOptions {
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
  cookiePrefix: string;
  mailer: AuthMailer;
  backgroundTask?: (promise: Promise<unknown>) => void;
}

function createApplicationAuthOptions(
  database: ReturnType<typeof drizzle>,
  options: ApplicationAuthOptions,
) {
  return {
    appName: "Kartiseret",
    baseURL: options.baseURL,
    basePath: "/api/auth",
    secret: options.secret,
    trustedOrigins: options.trustedOrigins,
    database: drizzleAdapter(database, {
      provider: "pg",
      schema: authSchema,
      schemaName: "app_auth",
      transaction: true,
    }),
    advanced: {
      disableOriginCheck: false,
      disableCSRFCheck: false,
      database: { generateId: () => randomUUID() },
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
      cookiePrefix: options.cookiePrefix,
      useSecureCookies: new URL(options.baseURL).protocol === "https:",
      ...(options.backgroundTask
        ? { backgroundTasks: { handler: options.backgroundTask } }
        : {}),
    },
    user: {
      additionalFields: {
        signupLocation: {
          type: "string",
          required: false,
          input: true,
          validator: { input: z.string().trim().min(1).max(200) },
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) =>
        options.mailer({ to: user.email, url, kind: "reset" }),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) =>
        options.mailer({ to: user.email, url, kind: "verification" }),
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 100 },
    logger: { disabled: true },
  } satisfies BetterAuthOptions;
}

type ApplicationAuthConfiguration = ReturnType<
  typeof createApplicationAuthOptions
>;

export function createApplicationAuth(
  pool: Pool,
  options: ApplicationAuthOptions,
): Auth<ApplicationAuthConfiguration> {
  const database = drizzle(pool, { schema: authSchema });
  return betterAuth(createApplicationAuthOptions(database, options));
}

export type ApplicationAuth = Auth<ApplicationAuthConfiguration>;
