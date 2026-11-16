import { importPKCS8, SignJWT } from "jose";

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
