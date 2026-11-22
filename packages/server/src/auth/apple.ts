import { decodeJwt, importPKCS8, SignJWT } from "jose";
import { z } from "zod";

export interface AppleClientSecretOptions {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
}

export async function createAppleClientSecret(
  options: AppleClientSecretOptions,
  now = Date.now(),
): Promise<string> {
  const key = await importPKCS8(options.privateKey, "ES256");
  const issuedAt = Math.floor(now / 1_000);

  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: options.keyId })
    .setIssuer(options.teamId)
    .setSubject(options.clientId)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 180 * 24 * 60 * 60)
    .sign(key);
}

async function postToApple(
  endpoint: "token" | "revoke",
  options: AppleClientSecretOptions,
  fields: Record<string, string>,
) {
  return fetch(`https://appleid.apple.com/auth/${endpoint}`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
    body: new URLSearchParams({
      ...fields,
      client_id: options.clientId,
      client_secret: await createAppleClientSecret(options),
    }),
  });
}

export async function exchangeNativeAppleCode(
  options: AppleClientSecretOptions,
  code: string,
  verifiedIdentityToken: string,
) {
  const identity = decodeJwt(verifiedIdentityToken);
  if (identity.aud !== options.clientId || !identity.sub) {
    throw new Error("Unexpected native Apple identity.");
  }
  const response = await postToApple("token", options, {
    code,
    grant_type: "authorization_code",
  });
  if (!response.ok) throw new Error("Apple code exchange failed.");
  const tokens = z
    .object({ id_token: z.string().min(1), refresh_token: z.string().min(1) })
    .parse(await response.json());
  // The exchanged token comes directly from Apple's TLS endpoint. Better Auth
  // already verified the original identity token before reaching this hook.
  const exchangedIdentity = decodeJwt(tokens.id_token);
  if (
    exchangedIdentity.iss !== "https://appleid.apple.com" ||
    exchangedIdentity.sub !== identity.sub ||
    exchangedIdentity.aud !== identity.aud
  ) {
    throw new Error(
      "Apple authorization code belongs to a different identity.",
    );
  }
  return tokens.refresh_token;
}

export async function revokeAppleRefreshToken(
  options: AppleClientSecretOptions,
  token: string,
) {
  const response = await postToApple("revoke", options, {
    token,
    token_type_hint: "refresh_token",
  });
  if (!response.ok) throw new Error("Apple token revocation failed.");
}
