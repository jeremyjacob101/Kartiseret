import { describe, expect, it, vi } from "vitest";
import { SupabaseIdentityVerifier } from "./identity.js";

const id = "00000000-0000-4000-8000-000000000001";
describe("Supabase token verification boundary", () => {
  it("asks the configured provider to verify the bearer and projects a neutral identity", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id,
          email: "qa@example.test",
          user_metadata: { signup_location: "Haifa", is_admin: true },
          app_metadata: { role: "admin" },
        }),
      ),
    );
    const result = await new SupabaseIdentityVerifier(
      "https://dev.supabase.test",
      "public-key",
      transport,
    ).verify("access-token");
    expect(result).toEqual({
      id,
      email: "qa@example.test",
      signupLocation: "Haifa",
    });
    expect(transport).toHaveBeenCalledWith(
      "https://dev.supabase.test/auth/v1/user",
      expect.objectContaining({
        headers: { apikey: "public-key", Authorization: "Bearer access-token" },
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it.each([401, 403])(
    "rejects invalid or expired sessions (%i)",
    async (status) => {
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("{}", { status }));
      await expect(
        new SupabaseIdentityVerifier(
          "https://dev.supabase.test",
          "key",
          transport,
        ).verify("expired"),
      ).rejects.toMatchObject({ status: 401 });
    },
  );
  it("fails closed on transport outages and malformed provider data", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("private provider detail"));
    await expect(
      new SupabaseIdentityVerifier(
        "https://dev.supabase.test",
        "key",
        transport,
      ).verify("token"),
    ).rejects.toMatchObject({
      status: 503,
      message: "Account verification is temporarily unavailable.",
    });
    transport.mockResolvedValue(
      new Response(JSON.stringify({ id: "fabricated" })),
    );
    await expect(
      new SupabaseIdentityVerifier(
        "https://dev.supabase.test",
        "key",
        transport,
      ).verify("token"),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("ignores malformed optional preference metadata without weakening identity verification", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id,
          email: "qa@example.test",
          user_metadata: { signup_location: null, is_admin: true },
        }),
      ),
    );
    expect(
      await new SupabaseIdentityVerifier(
        "https://dev.supabase.test",
        "key",
        transport,
      ).verify("token"),
    ).toEqual({ id, email: "qa@example.test", signupLocation: undefined });
  });
  it("rejects anonymous sessions and insecure non-local provider URLs", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ id, is_anonymous: true })),
      );
    await expect(
      new SupabaseIdentityVerifier(
        "https://dev.supabase.test",
        "key",
        transport,
      ).verify("token"),
    ).rejects.toMatchObject({ status: 401 });
    expect(
      () => new SupabaseIdentityVerifier("http://dev.example.test", "key"),
    ).toThrow("HTTPS");
  });
});
