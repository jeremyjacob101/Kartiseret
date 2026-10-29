import { describe, expect, it, vi } from "vitest";
import { createResendAuthMailer } from "./mail.js";
describe("account mail transport", () => {
  it("sends account emails to recipients without an allowlist", async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response("{}"));
    const mailer = createResendAuthMailer({
      apiKey: "test",
      from: "Kartiseret <test@example.test>",
      transport,
    });
    await mailer({
      to: "recipient@example.test",
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
    expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toMatchObject({
      to: ["recipient@example.test"],
      text: expect.stringContaining("https://dev.test/verify"),
    });
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
