import { create } from "zustand";
import { normalizeTicketAlertTmdbId } from "../domain/ticketAlerts";
import { guestTicketAlertTokenSchema, ticketAlertEmailSchema, guestTicketAlertsStorageSchema, type StoredGuestTicketAlert } from "../data/ticketAlertSchemas";
import { parseBoundary, safeParseJson } from "../validation/runtime";

export const GUEST_TICKET_ALERT_TOKEN_STORAGE_KEY =
  "kartiseret.ticket-alert-guest-token.v1";
export const GUEST_TICKET_ALERTS_STORAGE_KEY =
  "kartiseret.ticket-alert-guest-subscriptions.v1";

export type GuestTicketAlertReceipt = StoredGuestTicketAlert;

type GuestTicketAlertsStoreState = {
  receipts: Record<string, GuestTicketAlertReceipt>;
  saveReceipt: (tmdbId: string, email: string) => void;
  removeReceipt: (tmdbId: string) => void;
};

export function parseGuestTicketAlertReceipts(
  raw: string | null,
): Record<string, GuestTicketAlertReceipt> {
  return safeParseJson(raw ?? "{}", guestTicketAlertsStorageSchema) ?? {};
}

function readReceipts(): Record<string, GuestTicketAlertReceipt> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    return parseGuestTicketAlertReceipts(
      window.localStorage.getItem(GUEST_TICKET_ALERTS_STORAGE_KEY),
    );
  } catch {
    return {};
  }
}

function persistReceipts(
  receipts: Record<string, GuestTicketAlertReceipt>,
): void {
  try {
    window.localStorage.setItem(
      GUEST_TICKET_ALERTS_STORAGE_KEY,
      JSON.stringify(receipts),
    );
  } catch {
    // A successful RPC still updates this session if storage is unavailable.
  }
}

// These are browser-owned receipts, not a copy of authenticated server rows.
// Network work and pending/error state belong to the ticket-alert mutations.
export const useGuestTicketAlertsStore = create<GuestTicketAlertsStoreState>()((
  set,
  get,
) => ({
  receipts: readReceipts(),
  saveReceipt: (tmdbId, email) => {
    const id = normalizeTicketAlertTmdbId(tmdbId);
    const emailResult = ticketAlertEmailSchema.safeParse(email);
    if (!emailResult.success) {
      throw new Error("Enter a valid email address for this alert.");
    }
    const normalizedEmail = emailResult.data;

    const receipts = {
      ...get().receipts,
      [id]: { email: normalizedEmail, subscribedAt: new Date().toISOString() },
    };
    set({ receipts });
    persistReceipts(receipts);
  },
  removeReceipt: (tmdbId) => {
    const receipts = { ...get().receipts };
    delete receipts[normalizeTicketAlertTmdbId(tmdbId)];
    set({ receipts });
    persistReceipts(receipts);
  },
}));

export function readGuestTicketAlertToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawToken = window.localStorage.getItem(
      GUEST_TICKET_ALERT_TOKEN_STORAGE_KEY,
    );
    if (!rawToken) {
      return null;
    }
    const result = guestTicketAlertTokenSchema.safeParse(rawToken);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function getOrCreateGuestTicketAlertToken(): string {
  if (typeof window === "undefined") {
    throw new Error("Guest ticket alerts require browser storage.");
  }

  let rawToken: string | null;
  try {
    rawToken = window.localStorage.getItem(
      GUEST_TICKET_ALERT_TOKEN_STORAGE_KEY,
    );
  } catch {
    throw new Error("Guest ticket alerts require browser storage.");
  }

  if (rawToken && rawToken.trim()) {
    const existingResult = guestTicketAlertTokenSchema.safeParse(rawToken);
    if (!existingResult.success) {
      throw new Error(
        "Guest ticket alert credentials are invalid in this browser. Clear site storage to continue.",
      );
    }
    return existingResult.data;
  }

  try {
    const token = parseBoundary(
      guestTicketAlertTokenSchema,
      globalThis.crypto.randomUUID(),
      "guest ticket alert token",
    );
    window.localStorage.setItem(GUEST_TICKET_ALERT_TOKEN_STORAGE_KEY, token);
    return token;
  } catch {
    throw new Error("Guest ticket alerts require browser storage.");
  }
}

function handleGuestTicketAlertStorage(event: StorageEvent): void {
  if (event.key === null || event.key === GUEST_TICKET_ALERTS_STORAGE_KEY) {
    useGuestTicketAlertsStore.setState({ receipts: readReceipts() });
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", handleGuestTicketAlertStorage);
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.removeEventListener("storage", handleGuestTicketAlertStorage);
  });
}
