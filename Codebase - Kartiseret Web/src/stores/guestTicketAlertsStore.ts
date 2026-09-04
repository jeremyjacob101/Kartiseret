import { create } from "zustand";
import { isValidTicketAlertEmail, normalizeTicketAlertEmail, normalizeTicketAlertTmdbId } from "../domain/ticketAlerts";

export const GUEST_TICKET_ALERT_TOKEN_STORAGE_KEY =
  "kartiseret.ticket-alert-guest-token.v1";
export const GUEST_TICKET_ALERTS_STORAGE_KEY =
  "kartiseret.ticket-alert-guest-subscriptions.v1";

export type GuestTicketAlertReceipt = {
  email: string;
  subscribedAt: string;
};

type GuestTicketAlertsStoreState = {
  receipts: Record<string, GuestTicketAlertReceipt>;
  saveReceipt: (tmdbId: string, email: string) => void;
  removeReceipt: (tmdbId: string) => void;
};

export function parseGuestTicketAlertReceipts(
  raw: string | null,
): Record<string, GuestTicketAlertReceipt> {
  try {
    const parsed: unknown = JSON.parse(raw ?? "{}");

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const receipts: Record<string, GuestTicketAlertReceipt> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        continue;
      }

      const receipt = value as Record<string, unknown>;
      if (
        typeof receipt.email !== "string" ||
        !isValidTicketAlertEmail(receipt.email) ||
        typeof receipt.subscribedAt !== "string" ||
        !receipt.subscribedAt.trim()
      ) {
        continue;
      }

      try {
        receipts[normalizeTicketAlertTmdbId(key)] = {
          email: normalizeTicketAlertEmail(receipt.email),
          subscribedAt: receipt.subscribedAt.trim(),
        };
      } catch {
        // Discard only the invalid entry, not the other saved receipts.
      }
    }

    return receipts;
  } catch {
    return {};
  }
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
    const normalizedEmail = normalizeTicketAlertEmail(email);
    if (!isValidTicketAlertEmail(normalizedEmail)) {
      throw new Error("Enter a valid email address for this alert.");
    }

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
  try {
    return (
      window.localStorage
        .getItem(GUEST_TICKET_ALERT_TOKEN_STORAGE_KEY)
        ?.trim() || null
    );
  } catch {
    return null;
  }
}

export function getOrCreateGuestTicketAlertToken(): string {
  const existingToken = readGuestTicketAlertToken();
  if (existingToken) {
    return existingToken;
  }

  try {
    const token = globalThis.crypto.randomUUID();
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
