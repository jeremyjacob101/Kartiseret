import { describe, expect, it, vi } from "vitest";
import { createResendAuthMailer } from "./mail.js";
describe("account mail transport", () => {
  it("bounds delivery, uses text URLs and rejects recipients outside the Preview allowlist", async () => {
    const transport = vi.fn(async () => new Response("{}"));
    const mailer = createResendAuthMailer({
      apiKey: "test",
      from: "Kartiseret <test@example.test>",
      allowedRecipients: ["allowed@example.test"],
      transport,
    });
    await expect(
      mailer({
        to: "blocked@example.test",
        url: "https://dev.test/reset?token=sensitive",
        kind: "reset",
      }),
    ).rejects.toThrow("not configured");
    expect(transport).not.toHaveBeenCalled();
    await mailer({
      to: "allowed@example.test",
      url: "https://dev.test/verify",
      kind: "verification",
    });
    expect(transport).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it("does not expose provider response details", async () => {
    const mailer = createResendAuthMailer({
      apiKey: "test",
      from: "test@example.test",
      transport: async () =>
        new Response("private provider details", { status: 500 }),
    });
    await expect(
      mailer({
        to: "test@example.test",
        url: "https://dev.test/reset",
        kind: "reset",
      }),
    ).rejects.toThrow("Account email delivery failed.");
  });
});
