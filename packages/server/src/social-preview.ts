import {
  socialPreviewCardDataSchema,
  type SocialPreviewCardData,
} from "@kartiseret/contracts/social-preview";
import { createHash } from "node:crypto";

/** Bump whenever card layout, overlays, fonts, logos, or render output changes. */
export const SOCIAL_PREVIEW_RENDERER_VERSION = "2026-11-card-v1";

export function createSocialPreviewFingerprint(value: unknown): string {
  const data = socialPreviewCardDataSchema.parse(value);
  const canonical = JSON.stringify({
    rendererVersion: SOCIAL_PREVIEW_RENDERER_VERSION,
    data,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export type { SocialPreviewCardData };
