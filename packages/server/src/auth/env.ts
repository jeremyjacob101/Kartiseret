import { z } from "zod";
import { ServerConfigurationError } from "../env.js";

export type SocialProviderId = "google" | "apple";

export interface SocialProviderEnvironment {
  google?: { clientId: string; clientSecret: string };
  apple?: {
    clientId: string;
    teamId: string;
    keyId: string;
    privateKey: string;
  };
}

function origin(value: string): string {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  ) {
    throw new ServerConfigurationError(
      "Authentication origins must be HTTPS origins, or explicit local development origins.",
    );
  }
  return url.origin;
}
export function parseAuthEnvironment(env: Record<string, string | undefined>) {
  const secrets = z
    .object({
      BETTER_AUTH_SECRET: z.string().min(32),
      INTERNAL_API_SECRET: z.string().min(32),
    })
    .safeParse(env);
  if (!secrets.success)
    throw new ServerConfigurationError(
      "BETTER_AUTH_SECRET and INTERNAL_API_SECRET must each contain at least 32 characters.",
    );
  const rawUrl =
    env.VERCEL_ENV === "production"
      ? "https://seret.site"
      : env.VERCEL_ENV === "preview"
        ? env.VERCEL_URL && `https://${env.VERCEL_URL}`
        : "http://localhost:5173";
  if (!rawUrl)
    throw new ServerConfigurationError(
      "VERCEL_URL is required for Preview deployments.",
    );

  const googleValues = [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET].map(
    (value) => value?.trim() || undefined,
  );
  const appleValues = [
    env.APPLE_CLIENT_ID,
    env.APPLE_TEAM_ID,
    env.APPLE_KEY_ID,
    env.APPLE_PRIVATE_KEY,
  ].map((value) => value?.trim() || undefined);
  const hasGoogle = googleValues.some(Boolean);
  const hasApple = appleValues.some(Boolean);
  if (hasGoogle && googleValues.some((value) => !value)) {
    throw new ServerConfigurationError(
      "Google sign-in requires both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    );
  }
  if (hasApple && appleValues.some((value) => !value)) {
    throw new ServerConfigurationError(
      "Apple sign-in requires APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, and APPLE_PRIVATE_KEY.",
    );
  }

  const applePrivateKey = appleValues[3]?.replace(/\\n/g, "\n");
  if (
    applePrivateKey &&
    (!applePrivateKey.startsWith("-----BEGIN PRIVATE KEY-----") ||
      !applePrivateKey.trimEnd().endsWith("-----END PRIVATE KEY-----"))
  ) {
    throw new ServerConfigurationError(
      "APPLE_PRIVATE_KEY must contain the complete PKCS#8 .p8 private key.",
    );
  }
  let baseURL: string;
  let trustedOrigins: string[];
  try {
    baseURL = origin(rawUrl);
    trustedOrigins = [
      ...new Set([
        baseURL,
        ...(env.VERCEL_ENV === "production"
          ? ["https://seret.site", "https://www.seret.site"]
          : []),
        ...(env.VERCEL_ENV === "preview" && env.VERCEL_BRANCH_URL
          ? [origin(`https://${env.VERCEL_BRANCH_URL}`)]
          : []),
      ]),
    ];
  } catch {
    throw new ServerConfigurationError(
      "VERCEL_URL or VERCEL_BRANCH_URL contains an invalid origin.",
    );
  }
  return {
    baseURL,
    trustedOrigins,
    secret: secrets.data.BETTER_AUTH_SECRET,
    internalSecret: secrets.data.INTERNAL_API_SECRET,
    cookiePrefix: `kartiseret-${env.VERCEL_ENV ?? env.NODE_ENV ?? "development"}`,
    socialProviders: {
      ...(googleValues[0] && googleValues[1]
        ? {
            google: {
              clientId: googleValues[0],
              clientSecret: googleValues[1],
            },
          }
        : {}),
      ...(appleValues[0] && appleValues[1] && appleValues[2] && applePrivateKey
        ? {
            apple: {
              clientId: appleValues[0],
              teamId: appleValues[1],
              keyId: appleValues[2],
              privateKey: applePrivateKey,
            },
          }
        : {}),
    } satisfies SocialProviderEnvironment,
    socialProviderIds: [
      ...(hasGoogle ? (["google"] as const) : []),
      ...(hasApple ? (["apple"] as const) : []),
    ],
    mail: {
      apiKey: env.RESEND_API_KEY,
      from: "Kartiseret <notifications@seret.site>",
    },
  };
}
