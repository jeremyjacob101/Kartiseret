import { isoDateStringSchema, tmdbIdSchema } from "./runtime.js";
import { z } from "zod";

const envelope = <Schema extends z.ZodType>(data: Schema) =>
  z.object({ data, error: z.null() });

export const homepageHighlightLabelSchema = z.enum([
  "kids",
  "sci-fi",
  "marvel",
]);
export type HomepageHighlightLabel = z.infer<
  typeof homepageHighlightLabelSchema
>;

const homepageTmdbIdSchema = tmdbIdSchema.refine(
  (value) => BigInt(value) <= 2_147_483_647n,
  "Movie ID exceeds the catalog range.",
);

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export const homepageMovieHighlightSchema = z
  .object({
    tmdbId: homepageTmdbIdSchema,
    startsOn: isoDateStringSchema,
    endsOn: isoDateStringSchema,
    priority: z.number().int().min(-100).max(100),
    label: homepageHighlightLabelSchema.nullable(),
    enabled: z.boolean(),
  })
  .strict()
  .refine((value) => value.startsOn <= value.endsOn, {
    path: ["endsOn"],
    message: "End date must be on or after the start date.",
  });
export type HomepageMovieHighlight = z.infer<
  typeof homepageMovieHighlightSchema
>;
export const homepageMovieIdSchema = homepageTmdbIdSchema;

const homepageCtaHrefSchema = z
  .string()
  .trim()
  .max(2048)
  .nullable()
  .refine((value) => {
    if (value === null) return true;
    if (value.startsWith("/")) {
      return (
        !value.startsWith("//") &&
        !value.includes("\\") &&
        !hasControlCharacters(value)
      );
    }
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "Use a site path or an HTTPS link.");

const homepagePromotionFields = {
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(280),
  startsOn: isoDateStringSchema,
  endsOn: isoDateStringSchema,
  priority: z.number().int().min(-100).max(100),
  ctaLabel: z.string().trim().min(1).max(60).nullable(),
  ctaHref: homepageCtaHrefSchema,
  enabled: z.boolean(),
};

const homepagePromotionRules = {
  date: {
    path: ["endsOn"],
    message: "End date must be on or after the start date.",
  },
  cta: {
    path: ["ctaHref"],
    message: "CTA text and destination must be set together.",
  },
};

export const homepagePromotionSchema = z
  .object({ id: z.string().uuid(), ...homepagePromotionFields })
  .strict()
  .refine((value) => value.startsOn <= value.endsOn, {
    path: ["endsOn"],
    message: "End date must be on or after the start date.",
  })
  .refine(
    (value) =>
      (value.ctaLabel === null && value.ctaHref === null) ||
      (value.ctaLabel !== null && value.ctaHref !== null),
    homepagePromotionRules.cta,
  );
export type HomepagePromotion = z.infer<typeof homepagePromotionSchema>;

export const homepagePromotionUpsertSchema = z
  .object({ id: z.string().uuid().optional(), ...homepagePromotionFields })
  .strict()
  .refine((value) => value.startsOn <= value.endsOn, {
    ...homepagePromotionRules.date,
  })
  .refine(
    (value) =>
      (value.ctaLabel === null && value.ctaHref === null) ||
      (value.ctaLabel !== null && value.ctaHref !== null),
    homepagePromotionRules.cta,
  );
export type HomepagePromotionUpsert = z.infer<
  typeof homepagePromotionUpsertSchema
>;

export const homepageWeeklyLineupSchema = z
  .object({
    weekStart: isoDateStringSchema,
    nowPlayingIds: z.array(homepageTmdbIdSchema).max(40),
    comingSoonIds: z.array(homepageTmdbIdSchema).max(40),
  })
  .strict();
export type HomepageWeeklyLineup = z.infer<typeof homepageWeeklyLineupSchema>;

export const homepageFeaturedResponseSchema = envelope(
  z.object({
    lineup: homepageWeeklyLineupSchema.nullable(),
    highlights: z.array(homepageMovieHighlightSchema),
    promotions: z.array(homepagePromotionSchema),
  }),
);
export type HomepageFeaturedResponse = z.infer<
  typeof homepageFeaturedResponseSchema
>;

export const homepageAdminDataResponseSchema = envelope(
  z.object({
    highlights: z.array(homepageMovieHighlightSchema),
    promotions: z.array(homepagePromotionSchema),
  }),
);

export const homepageMovieHighlightUpsertSchema = homepageMovieHighlightSchema;
export const homepageMovieHighlightResponseSchema = envelope(
  z.object({ highlight: homepageMovieHighlightSchema }),
);
export const homepagePromotionResponseSchema = envelope(
  z.object({ promotion: homepagePromotionSchema }),
);
export const homepageRemovedResponseSchema = envelope(
  z.object({ removed: z.literal(true) }),
);
