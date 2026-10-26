import { describe, expect, it, vi } from "vitest";
import type { ApplicationAuth } from "../auth/auth.js";
import { BetterAuthIdentityVerifier } from "./identity.js";
const user = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "qa@example.test",
  emailVerified: true,
  signupLocation: "Haifa",
};
function setup(value: unknown) {
  const getSession = vi.fn(async (options: unknown) => {
    void options;
    return value;
  });
  const verifier = new BetterAuthIdentityVerifier({
    api: { getSession },
  } as unknown as Pick<ApplicationAuth, "api">);
  return { verifier, getSession };
}
describe("Better Auth verified identity", () => {
  it("projects a verified database session and omits provider or authorization fields", async () => {
    const { verifier, getSession } = setup({
      user: { ...user, isAdmin: true },
      session: { id: "session" },
    });
    expect(await verifier.verify("signed-cookie")).toEqual({
      id: user.id,
      email: user.email,
      signupLocation: "Haifa",
    });
    expect(getSession).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      query: { disableCookieCache: true, disableRefresh: true },
    });
    const options = getSession.mock.calls[0]?.[0] as { headers: Headers };
    expect(options.headers.get("cookie")).toBe("signed-cookie");
  });
  it.each([
    null,
    { user: { ...user, emailVerified: false } },
    { user: { ...user, id: "bad" } },
  ])("rejects absent, unverified and malformed identities", async (value) => {
    await expect(
      setup(value).verifier.verify("invalid-cookie"),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("maps persistence failures to a safe availability error", async () => {
    const { verifier, getSession } = setup(null);
    getSession.mockRejectedValue(new Error("private SQL details"));
    await expect(verifier.verify("cookie")).rejects.toMatchObject({
      status: 503,
      code: "auth_unavailable",
    });
  });
});
