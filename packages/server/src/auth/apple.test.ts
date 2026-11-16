import { generateKeyPairSync } from "node:crypto";
import { jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import { createAppleClientSecret } from "./apple.js";

describe("Apple client secret", () => {
  it("signs a provider secret with the configured web client identity", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    const privateKeyPem = privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    const now = Date.UTC(2026, 10, 16, 12);
    const secret = await createAppleClientSecret(
      {
        clientId: "com.jj.kartiseret.web",
        teamId: "TEAM123456",
        keyId: "KEY1234567",
        privateKey: privateKeyPem,
      },
      now,
    );

    const verified = await jwtVerify(secret, publicKey, {
      audience: "https://appleid.apple.com",
    });
    expect(verified.protectedHeader).toMatchObject({
      alg: "ES256",
      kid: "KEY1234567",
    });
    expect(verified.payload).toMatchObject({
      iss: "TEAM123456",
      sub: "com.jj.kartiseret.web",
      aud: "https://appleid.apple.com",
      iat: Math.floor(now / 1_000),
      exp: Math.floor(now / 1_000) + 180 * 24 * 60 * 60,
    });
  });
});
