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
    env.VERCEL_ENV === "production"
      ? "https://seret.site"
      : env.VERCEL_ENV === "preview"
        ? env.VERCEL_URL && `https://${env.VERCEL_URL}`
        : "http://localhost:5173";
  if (!rawUrl)
    throw new ServerConfigurationError(
      "VERCEL_URL is required for Preview deployments.",
    );
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
    mail: {
      apiKey: env.RESEND_API_KEY,
      from: "Kartiseret <notifications@seret.site>",
    },
  };
}
