import { z } from "zod";

export const socialProviderSchema = z.enum(["google", "apple"]);
export type SocialProvider = z.infer<typeof socialProviderSchema>;

const providersResponseSchema = z.object({
  data: z.object({ providers: z.array(socialProviderSchema) }),
  error: z.null(),
});

export async function loadSocialProviders(
  signal?: AbortSignal,
): Promise<SocialProvider[]> {
  try {
    const response = await fetch("/api/v1/auth/providers", {
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
    if (!response.ok) return [];

    const parsed = providersResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.data.providers : [];
  } catch {
    return [];
  }
}
