import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from "@kartiseret/contracts/private-data";
import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth/minimal";
import type { Auth, BetterAuthOptions } from "better-auth";
import {
  APIError,
  addOAuthServerContext,
  createAuthMiddleware,
  getAuthoritativeSessionFromCtx,
  getOAuthState,
} from "better-auth/api";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { z } from "zod";
import { account, authSchema, user } from "./schema.js";
import type { AuthMailer } from "./mail.js";
import { createAppleClientSecret } from "./apple.js";
import type { SocialProviderEnvironment } from "./env.js";
import { bearer } from "better-auth/plugins";

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
    plugins: [bearer()],
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
        disableImplicitLinking: true,
        // An explicitly linked Apple account may use a private relay address.
        allowDifferentEmails: true,
        allowUnlinkingAll: false,
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/link-social") return;
        const session = await getAuthoritativeSessionFromCtx(ctx);
        if (!session) {
          throw APIError.from("UNAUTHORIZED", {
            code: "UNAUTHORIZED",
            message: "Sign in before connecting a sign-in method.",
          });
        }
        const freshAge = ctx.context.sessionConfig.freshAge;
        if (
          freshAge > 0 &&
          Date.now() - session.session.createdAt.getTime() >= freshAge * 1_000
        ) {
          throw APIError.from("FORBIDDEN", {
            code: "SESSION_NOT_FRESH",
            message: "Sign in again before connecting a sign-in method.",
          });
        }
        await addOAuthServerContext({ linkingSessionId: session.session.id });
      }),
    },
    databaseHooks: {
      account: {
        delete: {
          before: async (linkedAccount, ctx) => {
            if (ctx?.path !== "/unlink-account") return;
            // Serialize unlinks for this user so two tabs cannot remove both
            // remaining methods after each observed that there were two.
            await database.transaction(async (tx) => {
              await tx
                .select({ id: user.id })
                .from(user)
                .where(eq(user.id, linkedAccount.userId))
                .for("update");
              const remaining = await tx
                .select({ id: account.id })
                .from(account)
                .where(eq(account.userId, linkedAccount.userId))
                .limit(2);
              if (remaining.length < 2) {
                throw APIError.from("BAD_REQUEST", {
                  code: "FAILED_TO_UNLINK_LAST_ACCOUNT",
                  message:
                    "Connect another sign-in method before disconnecting this one.",
                });
              }
              await tx.delete(account).where(eq(account.id, linkedAccount.id));
            });
            return false; // The transaction already performed the unlink.
          },
        },
      },
    },
    user: {
      validateUserInfo: async ({ user: linkingUser, source }, ctx) => {
        if (source.action !== "link-account" || source.method !== "oauth")
          return;
        const state = await getOAuthState();
        const session = await getAuthoritativeSessionFromCtx(ctx);
        if (
          !session ||
          session.user.id !== linkingUser.id ||
          session.session.id !== state?.serverContext?.linkingSessionId
        ) {
          return {
            error: "link_session_changed",
            errorDescription:
              "Sign in again and restart the connection from your account settings.",
          };
        }
      },
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
                    clientId: options.socialProviders.google.iosClientId
                      ? [
                          options.socialProviders.google.clientId,
                          options.socialProviders.google.iosClientId,
                        ]
                      : options.socialProviders.google.clientId,
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
                    ...(options.socialProviders!.apple!.appBundleIdentifier
                      ? {
                          appBundleIdentifier:
                            options.socialProviders!.apple!.appBundleIdentifier,
                        }
                      : {}),
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
