import { z } from "zod";
import type { ApplicationIdentity } from "@kartiseret/contracts/private-data";
import { HttpError } from "../http-errors.js";

/** Provider details stay inside the adapter; feature services accept this identity. */
export type VerifiedIdentity = ApplicationIdentity & {
  signupLocation?: string;
};
export interface IdentityVerifier {
  verify(accessToken: string): Promise<VerifiedIdentity>;
}
const providerUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().nullable().optional(),
  is_anonymous: z.boolean().optional(),
  user_metadata: z
    .object({
      signup_location: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .optional()
        .catch(undefined),
    })
    .passthrough()
    .optional()
    .catch(undefined),
});

/** Supabase's authenticated /user endpoint validates the token with the provider.
 * No local decoding, editable metadata authorization, or service-role key is used. */
export class SupabaseIdentityVerifier implements IdentityVerifier {
  private readonly userUrl: string;
  constructor(
    url: string,
    private readonly publishableKey: string,
    private readonly transport: typeof fetch = fetch,
  ) {
    const origin = new URL(url);
    if (
      origin.protocol !== "https:" &&
      !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)
    ) {
      throw new Error("Supabase authentication requires HTTPS.");
    }
    this.userUrl = new URL("/auth/v1/user", origin).href;
  }
  async verify(accessToken: string): Promise<VerifiedIdentity> {
    let response: Response;
    try {
      response = await this.transport(this.userUrl, {
        headers: {
          apikey: this.publishableKey,
          Authorization: `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
    } catch {
      throw new HttpError(
        503,
        "auth_unavailable",
        "Account verification is temporarily unavailable.",
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(
        401,
        "unauthorized",
        "Your session has expired. Please log in again.",
      );
    }
    if (!response.ok)
      throw new HttpError(
        503,
        "auth_unavailable",
        "Account verification is temporarily unavailable.",
      );
    const body: unknown = await response.json().catch(() => null);
    const user = providerUserSchema.safeParse(body);
    if (!user.success || user.data.is_anonymous)
      throw new HttpError(
        401,
        "unauthorized",
        "A valid account session is required.",
      );
    return {
      id: user.data.id,
      email: user.data.email ?? null,
      signupLocation: user.data.user_metadata?.signup_location,
    };
  }
}
