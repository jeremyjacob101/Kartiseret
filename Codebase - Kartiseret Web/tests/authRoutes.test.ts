import { describe, expect, it } from "vitest";
import { getPasswordResetRedirectUrl, PASSWORD_RESET_PATH } from "../src/lib/authRoutes";

describe("auth routes", () => {
  it("builds the exact password reset redirect URL for each app origin", () => {
    expect(PASSWORD_RESET_PATH).toBe("/reset-password");
    expect(getPasswordResetRedirectUrl("https://seret.site")).toBe(
      "https://seret.site/reset-password",
    );
    expect(getPasswordResetRedirectUrl("http://localhost:5173")).toBe(
      "http://localhost:5173/reset-password",
    );
  });
});
