import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from "@kartiseret/contracts/private-data";
import { randomUUID } from "node:crypto";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
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
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { z } from "zod";
import { account, authSchema, user } from "./schema.js";
import type { AuthMailer } from "./mail.js";
import { getOpaqueEmailActionUrl } from "./email-links.js";
import {
  createAppleClientSecret,
  exchangeNativeAppleCode,
  revokeAppleRefreshToken,
} from "./apple.js";
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
  getSecretConfig: () => Promise<Parameters<typeof symmetricDecrypt>[0]["key"]>,
) {
  const apple = options.socialProviders?.apple;
  const manualAppleRevocation = new WeakSet<Request>();

  async function nativeAppleTokenData(
    accountData: { providerId?: string; idToken?: string | null },
    body: unknown,
    secretConfig: Parameters<typeof symmetricEncrypt>[0]["key"],
  ) {
    if (accountData.providerId !== "apple" || !accountData.idToken) return;
    const parsed = z
      .object({
        additionalData: z.object({
          appleAuthorizationCode: z.string().min(1).max(4096),
        }),
      })
      .safeParse(body);
    if (!parsed.success) return; // Older native builds have no code.
    try {
      if (!apple?.appBundleIdentifier) throw new Error("Apple App ID missing.");
      const token = await exchangeNativeAppleCode(
        { ...apple, clientId: apple.appBundleIdentifier },
        parsed.data.additionalData.appleAuthorizationCode,
        accountData.idToken,
      );
      return {
        data: {
          appleNativeRefreshToken: await symmetricEncrypt({
            key: secretConfig,
            data: token,
          }),
        },
      };
    } catch {
      throw APIError.from("BAD_REQUEST", {
        code: "APPLE_AUTHORIZATION_FAILED",
        message: "Apple sign-in could not be completed. Please try again.",
      });
    }
  }

  async function revokeAppleAccountTokens(linked: typeof account.$inferSelect) {
    const credentials = [
      {
        token: linked.appleNativeRefreshToken,
        clientId: apple?.appBundleIdentifier,
      },
      { token: linked.refreshToken, clientId: apple?.clientId },
    ].filter(({ token }) => token !== null);
    if (!credentials.length) return false;
    try {
      const key = await getSecretConfig();
      await Promise.all(
        credentials.map(async ({ clientId, token }) => {
          if (!apple || !clientId || !token)
            throw new Error("Missing Apple credentials.");
          await revokeAppleRefreshToken(
            { ...apple, clientId },
            await symmetricDecrypt({ key, data: token }),
          );
        }),
      );
      return true;
    } catch {
      throw APIError.from("SERVICE_UNAVAILABLE", {
        code: "APPLE_REVOCATION_FAILED",
        message: "Apple access could not be revoked. Please try again.",
      });
    }
  }

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
      additionalFields: {
        appleNativeRefreshToken: {
          type: "string",
          required: false,
          input: false,
          returned: false,
        },
      },
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
      after: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path === "/delete-user" &&
          ctx.request &&
          manualAppleRevocation.has(ctx.request)
        ) {
          ctx.setHeader("x-kartiseret-apple-revocation", "manual");
        }
      }),
    },
    databaseHooks: {
      account: {
        create: {
          before: async (data, ctx) => {
            if (ctx?.path === "/sign-in/social") {
              return nativeAppleTokenData(
                data,
                ctx.body,
                ctx.context.secretConfig,
              );
            }
          },
        },
        update: {
          before: async (data, ctx) => {
            if (ctx?.path === "/sign-in/social") {
              return nativeAppleTokenData(
                data,
                ctx.body,
                ctx.context.secretConfig,
              );
            }
          },
        },
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
              if (linkedAccount.providerId === "apple") {
                const [currentAccount] = await tx
                  .select()
                  .from(account)
                  .where(eq(account.id, linkedAccount.id))
                  .for("update");
                if (currentAccount)
                  await revokeAppleAccountTokens(currentAccount);
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
        beforeDelete: async (deletingUser, request) => {
          const appleAccounts = await database
            .select()
            .from(account)
            .where(
              and(
                eq(account.userId, deletingUser.id),
                eq(account.providerId, "apple"),
              ),
            );
          const results = await Promise.all(
            appleAccounts.map(revokeAppleAccountTokens),
          );
          if (request && results.includes(false))
            manualAppleRevocation.add(request);
        },
        sendDeleteAccountVerification: async ({ user, token }) => {
          await options.mailer({
            to: user.email,
            url: getOpaqueEmailActionUrl("deletion", token, options.baseURL),
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
      sendResetPassword: async ({ user, token }) =>
        options.mailer({
          to: user.email,
          url: getOpaqueEmailActionUrl("reset", token, options.baseURL),
          kind: "reset",
        }),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, token }) =>
        options.mailer({
          to: user.email,
          url: getOpaqueEmailActionUrl("verification", token, options.baseURL),
          kind: "verification",
        }),
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
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
  const auth: ApplicationAuth = betterAuth(
    createApplicationAuthOptions(
      database,
      options,
      async () => (await auth.$context).secretConfig,
    ),
  );
  return auth;
}

export type ApplicationAuth = Auth<ApplicationAuthConfiguration>;
