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
    "http://remote.test",
    "https://user:secret@example.test",
    "https://example.test/path",
    "ftp://localhost",
  ])("rejects unsafe auth origins %s", (value) => {
    expect(() =>
      parseAuthEnvironment({ ...secrets, BETTER_AUTH_URL: value }),
    ).toThrow();
  });
  it("requires separate secrets and an explicit non-Vercel origin", () => {
    expect(() =>
      parseAuthEnvironment({ BETTER_AUTH_URL: "https://seret.site" }),
    ).toThrow();
    expect(() => parseAuthEnvironment(secrets)).toThrow();
  });
});
