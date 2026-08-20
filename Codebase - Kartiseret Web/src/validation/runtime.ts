import { z } from "zod";

const MOVIE_CODE_PATTERN = /^[0-9A-Za-z]{3}$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

function isRealIsoDate(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value);

  if (!match) {
    return false;
  }

  const year = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const day = Number.parseInt(match[3] ?? "", 10);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function hasUrlProtocol(value: string, protocols: readonly string[]): boolean {
  try {
    const parsedUrl = new URL(value);
    return (
      protocols.includes(parsedUrl.protocol) &&
      !parsedUrl.username &&
      !parsedUrl.password
    );
  } catch {
    return false;
  }
}

export const nonEmptyTrimmedStringSchema = z.string().trim().min(1);

export const movieCodeSchema = z
  .string()
  .regex(MOVIE_CODE_PATTERN, "Expected a three-character movie code.");

export const tmdbIdSchema = z
  .union([
    z.string().trim().regex(POSITIVE_INTEGER_PATTERN),
    z.number().int().positive().safe(),
  ])
  .transform(String);

export const isoDateStringSchema = z
  .string()
  .regex(ISO_DATE_PATTERN, "Expected an ISO date in YYYY-MM-DD format.")
  .refine(isRealIsoDate, "Expected a real calendar date.");

export const longitudeLatitudeSchema = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);

export const httpUrlSchema = z
  .string()
  .trim()
  .url()
  .refine(
    (value) => hasUrlProtocol(value, ["http:", "https:"]),
    "Expected an HTTP or HTTPS URL.",
  );

export const httpsUrlSchema = httpUrlSchema.refine(
  (value) => hasUrlProtocol(value, ["https:"]),
  "Expected an HTTPS URL.",
);

export function formatValidationIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "value";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export function parseRuntimeValue<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
  context: string,
): z.output<Schema> {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new Error(
      `Invalid ${context} runtime data: ${formatValidationIssues(result.error)}`,
      { cause: result.error },
    );
  }

  return result.data;
}

export function parseJsonWithSchema<Schema extends z.ZodType>(
  rawValue: string,
  schema: Schema,
): z.output<Schema> | null {
  try {
    const parsedValue: unknown = JSON.parse(rawValue);
    const result = schema.safeParse(parsedValue);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function getFirstValidationMessage(
  result: z.ZodSafeParseError<unknown>,
  fallback: string,
): string {
  return result.error.issues[0]?.message ?? fallback;
}
