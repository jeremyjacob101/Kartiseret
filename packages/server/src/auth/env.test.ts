import { describe, expect, it } from "vitest";
import { parseAuthEnvironment } from "./env.js";
const secrets = {
  BETTER_AUTH_SECRET: "test-auth-secret-at-least-32-characters",
  INTERNAL_API_SECRET: "test-internal-secret-at-least-32-characters",
};
describe("auth deployment configuration", () => {
  it("uses exact Preview origins and host-only environment cookies without a mail allowlist", () => {
    expect(
      parseAuthEnvironment({
        ...secrets,
        VERCEL_ENV: "preview",
        VERCEL_URL: "deployment.vercel.app",
        VERCEL_BRANCH_URL: "branch.vercel.app",
      }),
    ).toMatchObject({
      baseURL: "https://deployment.vercel.app",
      trustedOrigins: [
        "https://deployment.vercel.app",
        "https://branch.vercel.app",
      ],
      cookiePrefix: "kartiseret-preview",
      mail: { from: "Kartiseret <notifications@seret.site>" },
    });
    expect(
      parseAuthEnvironment({
        ...secrets,
        VERCEL_ENV: "preview",
        VERCEL_URL: "deployment.vercel.app",
      }).mail,
    ).not.toHaveProperty("allowedRecipients");
  });
  it.each([
    "user:secret@example.test",
    "example.test/path",
    "example.test?x=1",
  ])("rejects unsafe Preview origins %s", (value) => {
    expect(() =>
      parseAuthEnvironment({
        ...secrets,
        VERCEL_ENV: "preview",
        VERCEL_URL: value,
      }),
    ).toThrow();
  });
  it("trusts the production site origins and uses the configured sender in code", () => {
    const config = parseAuthEnvironment({
      ...secrets,
      VERCEL_ENV: "production",
    });
    expect(config.trustedOrigins).toEqual([
      "https://seret.site",
      "https://www.seret.site",
    ]);
    expect(config.baseURL).toBe("https://seret.site");
    expect(config.mail.from).toBe("Kartiseret <notifications@seret.site>");
  });
  it("uses localhost for development and requires the Preview deployment URL", () => {
    expect(parseAuthEnvironment(secrets).baseURL).toBe("http://localhost:5173");
    expect(() =>
      parseAuthEnvironment({ ...secrets, VERCEL_ENV: "preview" }),
    ).toThrow();
    expect(() => parseAuthEnvironment({ VERCEL_ENV: "production" })).toThrow();
  });
});
