import { ticketAlertMovieIdSchema } from "../data/ticketAlertSchemas";

export function normalizeTicketAlertTmdbId(value: string): string {
  const result = ticketAlertMovieIdSchema.safeParse(value);
  if (!result.success) {
    throw new Error("This movie cannot be used for ticket alerts.", {
      cause: result.error,
    });
  }

  return String(result.data);
}
