import { ticketAlertEmailSchema, ticketAlertMovieIdSchema } from "../data/ticketAlertSchemas";

export function normalizeTicketAlertEmail(value: string): string {
  const result = ticketAlertEmailSchema.safeParse(value);
  return result.success ? result.data : value.trim().toLowerCase();
}

export function isValidTicketAlertEmail(value: string): boolean {
  return ticketAlertEmailSchema.safeParse(value).success;
}

export function normalizeTicketAlertTmdbId(value: string): string {
  const result = ticketAlertMovieIdSchema.safeParse(value);
  if (!result.success) {
    throw new Error("This movie cannot be used for ticket alerts.", {
      cause: result.error,
    });
  }

  return String(result.data);
}
