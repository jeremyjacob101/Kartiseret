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
import { createAppleClientSecret } from "./apple.js";
import type { SocialProviderEnvironment } from "./env.js";

export interface ApplicationAuthOptions {
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
  cookiePrefix: string;
  mailer: AuthMailer;
  socialProviders?: SocialProviderEnvironment;
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
    trustedOrigins: [
      ...options.trustedOrigins,
      ...(options.socialProviders?.apple ? ["https://appleid.apple.com"] : []),
    ],
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
    account: {
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        allowDifferentEmails: true,
        allowUnlinkingAll: false,
      },
    },
    user: {
      deleteUser: {
        enabled: true,
        sendDeleteAccountVerification: async ({ user, token }) => {
          const url = new URL("/confirm-account-deletion", options.baseURL);
          url.hash = new URLSearchParams({ token }).toString();
          await options.mailer({
            to: user.email,
            url: url.href,
            kind: "deletion",
          });
        },
      },
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
    ...(options.socialProviders &&
    (options.socialProviders.google || options.socialProviders.apple)
      ? {
          socialProviders: {
            ...(options.socialProviders.google
              ? {
                  google: {
                    clientId: options.socialProviders.google.clientId,
                    clientSecret: options.socialProviders.google.clientSecret,
                    requireEmailVerification: true,
                  },
                }
              : {}),
            ...(options.socialProviders.apple
              ? {
                  apple: async () => ({
                    clientId: options.socialProviders!.apple!.clientId,
                    clientSecret: await createAppleClientSecret(
                      options.socialProviders!.apple!,
                    ),
                    requireEmailVerification: true,
                  }),
                }
              : {}),
          },
        }
      : {}),
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
