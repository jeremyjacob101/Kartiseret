const legacyEmailActionPaths = new Map([
  ["/unsubscribe/letterboxd", { prefix: "u", pattern: /^[A-Za-z0-9_-]{43}$/ }],
  [
    "/confirm-account-deletion",
    { prefix: "d", pattern: /^[A-Za-z0-9_-]{16,256}$/ },
  ],
]);

/** Convert old fragment email actions into the current one-segment link form. */
export function resolveLegacyEmailActionPath(
  pathname: string,
  hash: string,
): string | null {
  const action = legacyEmailActionPaths.get(pathname);
  if (!action) return null;
  const token = new URLSearchParams(
    hash.startsWith("#") ? hash.slice(1) : hash,
  ).get("token");
  return token && action.pattern.test(token)
    ? `/${action.prefix}${token}`
    : null;
}
