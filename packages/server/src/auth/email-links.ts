import type { AuthEmail } from "./mail.js";

const TOKEN_PATTERNS: Record<AuthEmail["kind"], RegExp> = {
  verification: /^[A-Za-z0-9._-]{24,4094}$/,
  reset: /^[A-Za-z0-9_-]{16,256}$/,
  deletion: /^[A-Za-z0-9_-]{16,256}$/,
};
const PATH_PREFIXES: Record<AuthEmail["kind"], string> = {
  verification: "e",
  reset: "r",
  deletion: "d",
};

/** Keep secure email actions in one path segment without query strings or fragments. */
export function getOpaqueEmailActionUrl(
  kind: AuthEmail["kind"],
  token: string,
  origin: string,
): string {
  if (!TOKEN_PATTERNS[kind].test(token)) {
    throw new Error("The secure email action token has an invalid format.");
  }
  const base = new URL(origin);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.protocol !== "https:" &&
      base.hostname !== "localhost" &&
      base.hostname !== "127.0.0.1")
  ) {
    throw new Error("The secure email action origin is invalid.");
  }
  base.pathname = `/${PATH_PREFIXES[kind]}${token}`;
  return base.toString();
}
