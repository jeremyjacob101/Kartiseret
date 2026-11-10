export interface AuthEmail {
  to: string;
  url: string;
  kind: "verification" | "reset";
}
export type AuthMailer = (email: AuthEmail) => Promise<void>;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function renderAccountEmail(kind: AuthEmail["kind"], url: string): string {
  const isVerification = kind === "verification";
  const heading = isVerification ? "One quick step" : "Reset your password";
  const action = isVerification ? "Verify your email" : "Reset password";
  const description = isVerification
    ? "Confirm your email address to finish setting up your Kartiseret account."
    : "We received a request to reset your Kartiseret password. Use the button below to choose a new one.";
  const safeUrl = escapeHtml(url);
  const preheader = isVerification
    ? "Confirm your email and start planning your next cinema trip."
    : "Use this secure link to reset your Kartiseret password.";

  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${action} · Kartiseret</title></head>`,
    '<body style="margin:0;padding:0;background:#f3f0ea;color:#26221e;font-family:Arial,Helvetica,sans-serif;">',
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#f3f0ea;">',
    '<tr><td align="center" style="padding:44px 16px;">',
    '<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:100%;max-width:520px;background:#ffffff;border:1px solid #e5dfd5;border-radius:14px;overflow:hidden;">',
    '<tr><td style="height:5px;background:#c7a35c;font-size:0;line-height:0;">&nbsp;</td></tr>',
    '<tr><td align="center" style="padding:30px 30px 24px;">',
    '<div style="color:#5f3b91;font-size:13px;font-weight:700;letter-spacing:2px;line-height:1.4;">KARTISERET</div>',
    '<div style="margin-top:9px;color:#827b71;font-size:11px;font-weight:700;letter-spacing:1.4px;line-height:1.4;text-transform:uppercase;">ACCOUNT SECURITY</div>',
    `<h1 style="margin:14px 0 12px;color:#24211e;font-size:25px;line-height:1.25;">${heading}</h1>`,
    `<p style="margin:0;color:#645f58;font-size:15px;line-height:1.65;">${description}</p>`,
    "</td></tr>",
    '<tr><td align="center" style="padding:0 30px 24px;">',
    '<table role="presentation" cellpadding="0" cellspacing="0"><tr>',
    `<td align="center" style="border-radius:7px;background:#5f3b91;"><a href="${safeUrl}" style="display:inline-block;padding:14px 24px;border:1px solid #5f3b91;border-radius:7px;color:#ffffff;font-size:14px;font-weight:700;line-height:1.2;text-decoration:none;">${action}</a></td>`,
    "</tr></table>",
    "</td></tr>",
    '<tr><td style="padding:0 30px 24px;">',
    '<p style="margin:0 0 8px;color:#827b71;font-size:12px;line-height:1.5;">If the button does not work, copy this link into your browser:</p>',
    `<p style="margin:0;overflow-wrap:anywhere;word-break:break-word;"><a href="${safeUrl}" style="color:#5f3b91;font-size:12px;line-height:1.6;text-decoration:underline;">${safeUrl}</a></p>`,
    "</td></tr>",
    '<tr><td align="center" style="padding:18px 30px 24px;border-top:1px solid #eee9e1;">',
    '<p style="margin:0;color:#827b71;font-size:12px;line-height:1.6;">If you did not request this email, you can safely ignore it.</p>',
    '<p style="margin:8px 0 0;color:#a19a90;font-size:11px;line-height:1.5;">Kartiseret · Your local guide to the big screen</p>',
    "</td></tr></table></td></tr></table></body></html>",
  ].join("");
}

export function createResendAuthMailer(options: {
  apiKey?: string;
  from: string;
  transport?: typeof fetch;
}): AuthMailer {
  return async ({ to, url, kind }) => {
    if (!options.apiKey) {
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
          html: renderAccountEmail(kind, url),
        }),
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      },
    );
    if (!response.ok) throw new Error("Account email delivery failed.");
  };
}
