import { z } from "zod";
import { ServerConfigurationError } from "../env.js";

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
    env.BETTER_AUTH_URL ??
    (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : undefined);
  if (!rawUrl)
    throw new ServerConfigurationError(
      "BETTER_AUTH_URL is required outside a Vercel deployment.",
    );
  let baseURL: string;
  let trustedOrigins: string[];
  try {
    baseURL = origin(rawUrl);
    trustedOrigins = [
      ...new Set([
        baseURL,
        ...(env.AUTH_TRUSTED_ORIGINS ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
          .map(origin),
        ...(env.VERCEL_ENV === "preview" && env.VERCEL_BRANCH_URL
          ? [origin(`https://${env.VERCEL_BRANCH_URL}`)]
          : []),
      ]),
    ];
  } catch {
    throw new ServerConfigurationError(
      "BETTER_AUTH_URL or AUTH_TRUSTED_ORIGINS contains an invalid origin.",
    );
  }
  const from = env.AUTH_EMAIL_FROM ?? "Kartiseret <notifications@seret.site>";
  if (!from.trim() || /[\r\n]/.test(from))
    throw new ServerConfigurationError("AUTH_EMAIL_FROM is invalid.");
  return {
    baseURL,
    trustedOrigins,
    secret: secrets.data.BETTER_AUTH_SECRET,
    internalSecret: secrets.data.INTERNAL_API_SECRET,
    cookiePrefix: `kartiseret-${env.VERCEL_ENV ?? env.NODE_ENV ?? "development"}`,
    mail: {
      apiKey: env.RESEND_API_KEY,
      from,
    },
  };
}
