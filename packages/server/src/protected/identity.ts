import { z } from "zod";
import type { ApplicationIdentity } from "@kartiseret/contracts/private-data";
import type { ApplicationAuth } from "../auth/auth.js";
import { HttpError } from "../http-errors.js";

export type VerifiedIdentity = ApplicationIdentity & {
  signupLocation?: string;
};
export interface IdentityVerifier {
  verify(cookie: string): Promise<VerifiedIdentity>;
}
const identitySchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  emailVerified: z.literal(true),
  signupLocation: z.string().trim().min(1).max(200).nullable().optional(),
});

export class BetterAuthIdentityVerifier implements IdentityVerifier {
  constructor(private readonly auth: Pick<ApplicationAuth, "api">) {}
  async verify(cookie: string): Promise<VerifiedIdentity> {
    try {
      const session = await this.auth.api.getSession({
        headers: new Headers({ cookie }),
        query: { disableCookieCache: true, disableRefresh: true },
      });
      const user = identitySchema.safeParse(session?.user);
      if (!session || !user.success)
        throw new HttpError(
          401,
          "unauthorized",
          "Your session has expired. Please log in again.",
        );
      return {
        id: user.data.id,
        email: user.data.email,
        signupLocation: user.data.signupLocation ?? undefined,
      };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        503,
        "auth_unavailable",
        "Account verification is temporarily unavailable.",
      );
    }
  }
}
