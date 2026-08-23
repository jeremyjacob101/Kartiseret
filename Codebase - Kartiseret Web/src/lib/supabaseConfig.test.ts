import { describe, expect, it } from "vitest";
import { requireSupabaseConfig, resolveOptionalSupabaseConfig } from "./supabaseConfig.js";
import { adminUserRowSchema, supabaseUserIdentitySchema } from "./supabaseSchemas.js";

describe("Supabase environment validation", () => {
  it("selects and trims the first non-empty values", () => {
    expect(
      requireSupabaseConfig(
        [undefined, "  https://example.supabase.co  "],
        ["  publishable-key  "],
        "test config",
      ),
    ).toEqual({
      url: "https://example.supabase.co",
      publishableKey: "publishable-key",
    });
  });

  it("allows an entirely absent optional configuration", () => {
    expect(resolveOptionalSupabaseConfig([undefined], [undefined])).toBeNull();
  });

  it("rejects partial and invalid configurations", () => {
    expect(() =>
      resolveOptionalSupabaseConfig(
        ["https://example.supabase.co"],
        [undefined],
      )).toThrow(/Invalid optional Supabase configuration boundary data/);
    expect(() =>
      requireSupabaseConfig(
        ["not-a-url"],
        ["publishable-key"],
        "test config",
      )).toThrow(/Invalid test config boundary data/);
  });
});

describe("Supabase authentication response schemas", () => {
  it("accepts UUID user identities and rejects malformed ids", () => {
    const user = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      email: "viewer@example.com",
      app_metadata: {},
    };
    expect(supabaseUserIdentitySchema.safeParse(user).success).toBe(true);
    expect(
      supabaseUserIdentitySchema.safeParse({ ...user, id: "not-a-uuid" })
        .success,
    ).toBe(false);
  });

  it("validates admin lookup rows", () => {
    expect(
      adminUserRowSchema.safeParse({
        user_id: "550e8400-e29b-41d4-a716-446655440000",
      }).success,
    ).toBe(true);
    expect(adminUserRowSchema.safeParse({ user_id: 42 }).success).toBe(false);
  });
});
