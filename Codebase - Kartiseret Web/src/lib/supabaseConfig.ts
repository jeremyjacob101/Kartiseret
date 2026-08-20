import { z } from "zod";
import { httpUrlSchema, nonEmptyTrimmedStringSchema, parseRuntimeValue } from "../validation/runtime.js";

export const supabaseConfigSchema = z.object({
  url: httpUrlSchema,
  publishableKey: nonEmptyTrimmedStringSchema,
});

export type SupabaseRuntimeConfig = z.infer<typeof supabaseConfigSchema>;

function firstNonEmptyValue(
  values: readonly (string | undefined)[],
): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim());
}

function getConfigCandidate(
  urlValues: readonly (string | undefined)[],
  publishableKeyValues: readonly (string | undefined)[],
): { url: string | undefined; publishableKey: string | undefined } {
  return {
    url: firstNonEmptyValue(urlValues),
    publishableKey: firstNonEmptyValue(publishableKeyValues),
  };
}

export function requireSupabaseConfig(
  urlValues: readonly (string | undefined)[],
  publishableKeyValues: readonly (string | undefined)[],
  context: string,
): SupabaseRuntimeConfig {
  return parseRuntimeValue(
    supabaseConfigSchema,
    getConfigCandidate(urlValues, publishableKeyValues),
    context,
  );
}

export function resolveOptionalSupabaseConfig(
  urlValues: readonly (string | undefined)[],
  publishableKeyValues: readonly (string | undefined)[],
): SupabaseRuntimeConfig | null {
  const candidate = getConfigCandidate(urlValues, publishableKeyValues);

  if (!candidate.url && !candidate.publishableKey) {
    return null;
  }

  return parseRuntimeValue(
    supabaseConfigSchema,
    candidate,
    "optional Supabase configuration",
  );
}
