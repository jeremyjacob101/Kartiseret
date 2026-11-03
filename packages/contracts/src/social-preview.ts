import { isoDateStringSchema, tmdbIdSchema } from "./runtime.js";
import { z } from "zod";

export const SOCIAL_PREVIEW_VERSION = "v1";

export const socialPreviewFingerprintSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/);

export const socialPreviewCardDataSchema = z.object({
  tmdbId: tmdbIdSchema,
  title: z.string().trim().min(1).max(300),
  posterUrl: z.string().max(4_096),
  backdropUrl: z.string().max(4_096),
  isComingSoon: z.boolean(),
  year: z.number().int().positive().nullable(),
  releaseDate: isoDateStringSchema.nullable(),
  runtime: z.number().positive().nullable(),
  genres: z.array(z.string().trim().min(1).max(80)).max(3),
  imdbRating: z.number().positive().nullable(),
  rtCriticRating: z.number().positive().nullable(),
  rtCriticVotes: z.number().positive().nullable(),
  rtAudienceRating: z.number().positive().nullable(),
  rtAudienceVotes: z.number().positive().nullable(),
  lbRating: z.number().positive().nullable(),
});

export function socialPreviewImagePath(fingerprint: string): string | null {
  const parsed = socialPreviewFingerprintSchema.safeParse(fingerprint);
  if (!parsed.success) return null;
  return `/api/images/social/${SOCIAL_PREVIEW_VERSION}/${parsed.data}/card.jpg`;
}

export function socialPreviewImageUrl(
  origin: string,
  fingerprint: string,
): string | null {
  const path = socialPreviewImagePath(fingerprint);
  if (!path) return null;
  try {
    const base = new URL(origin);
    if (
      !["http:", "https:"].includes(base.protocol) ||
      base.username ||
      base.password
    ) {
      return null;
    }
    return new URL(path, base.origin).toString();
  } catch {
    return null;
  }
}

export type SocialPreviewCardData = z.infer<typeof socialPreviewCardDataSchema>;
