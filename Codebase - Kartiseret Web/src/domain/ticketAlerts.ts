export function normalizeTicketAlertEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidTicketAlertEmail(value: string): boolean {
  const email = normalizeTicketAlertEmail(value);
  return (
    email.length <= 320 &&
    /^[^\s@<>()"'\\]+@[^\s@<>()"'\\]+\.[^\s@<>()"'\\]+$/.test(email)
  );
}

export function normalizeTicketAlertTmdbId(value: string): string {
  const trimmed = value.trim();
  const id = Number(trimmed);

  if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(id) || id <= 0) {
    throw new Error("This movie cannot be used for ticket alerts.");
  }

  return String(id);
}
