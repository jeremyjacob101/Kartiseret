export interface AuthEmail {
  to: string;
  url: string;
  kind: "verification" | "reset";
}
export type AuthMailer = (email: AuthEmail) => Promise<void>;

export function createResendAuthMailer(options: {
  apiKey?: string;
  from: string;
  allowedRecipients?: readonly string[];
  transport?: typeof fetch;
}): AuthMailer {
  return async ({ to, url, kind }) => {
    if (
      !options.apiKey ||
      (options.allowedRecipients &&
        !options.allowedRecipients.includes(to.toLowerCase()))
    ) {
      throw new Error(
        "Account email delivery is not configured for this recipient.",
      );
    }
    const action =
      kind === "verification"
        ? "Verify your Kartiseret email"
        : "Reset your Kartiseret password";
    const response = await (options.transport ?? fetch)(
      "https://api.resend.com/emails",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: options.from,
          to: [to],
          subject: action,
          text: `${action}\n\n${url}\n\nIf you did not request this email, you can ignore it.`,
        }),
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      },
    );
    if (!response.ok) throw new Error("Account email delivery failed.");
  };
}
