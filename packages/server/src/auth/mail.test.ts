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
      html: expect.stringContaining("Verify your email"),
    });
    const request = JSON.parse(String(transport.mock.calls[0][1]?.body));
    expect(request.html).toContain("KARTISERET");
    expect(request.html).toContain("background:#f3f0ea");
    expect(request.html).toContain("https://dev.test/verify");
  });

  it("escapes the account action URL in HTML while preserving its plain text form", async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response("{}"));
    const mailer = createResendAuthMailer({
      apiKey: "test",
      from: "Kartiseret <test@example.test>",
      transport,
    });
    const url = "https://dev.test/reset?token=abc&next=/reset-password";
    await mailer({ to: "recipient@example.test", url, kind: "reset" });
    const request = JSON.parse(String(transport.mock.calls[0][1]?.body));
    expect(request.text).toContain(url);
    expect(request.html).toContain(
      "https://dev.test/reset?token=abc&amp;next=/reset-password",
    );
    expect(request.html).toContain("Reset password");
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
