import { createWalletTicketMutationOptions, deleteWalletTicketMutationOptions, updateWalletTicketMutationOptions, walletRecentScreeningQueryOptions, walletTicketDetailQueryOptions, walletTicketsQueryOptions } from "../data/walletTickets";
import { useMutation, useQuery } from "@tanstack/react-query";
import { privateApiBlob } from "../data/privateApi";
import { ApiRequestError } from "../data/apiClient";
import { useRef, useState } from "react";
import { Link } from "react-router";
import "./UserTicketPasses.css";

type ScreeningForm = {
  tmdbId: string;
  title: string;
  city: string;
  cinema: string;
  screeningDate: string;
  screeningTime: string;
};

const maxQrPayloadBytes = 2048;

const emptyScreening: ScreeningForm = {
  tmdbId: "",
  title: "",
  city: "",
  cinema: "",
  screeningDate: "",
  screeningTime: "",
};

async function readQrFromImage(file: File): Promise<string> {
  if (file.size > 12 * 1024 * 1024)
    throw new Error("Choose a screenshot smaller than 12 MB.");
  const imageUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error("This image could not be opened."));
      image.src = imageUrl;
    });
    if (image.naturalWidth * image.naturalHeight > 80_000_000) {
      throw new Error(
        "This image is too large to scan safely. Choose a smaller screenshot.",
      );
    }
    const scale = Math.min(
      1,
      2600 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("QR reading is unavailable in this browser.");
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    const { default: jsQR } = await import("jsqr");
    const result = jsQR(pixels.data, width, height, {
      inversionAttempts: "attemptBoth",
    });
    if (!result?.data)
      throw new Error(
        "No readable QR code was found. Retry with a clearer screenshot or use the original ticket.",
      );
    if (new TextEncoder().encode(result.data).byteLength > maxQrPayloadBytes) {
      throw new Error(
        "This QR code contains more data than Kartiseret can safely put on a Wallet pass. Use the original ticket instead.",
      );
    }
    return result.data;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function dateLabel(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(date);
}

export function UserTicketPasses({ userId }: { userId: string | null }) {
  const ticketsQuery = useQuery(walletTicketsQueryOptions(userId));
  const recentQuery = useQuery(walletRecentScreeningQueryOptions(userId));
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const activeTicketQuery = useQuery(
    walletTicketDetailQueryOptions(userId, activeTicketId),
  );
  const createMutation = useMutation(createWalletTicketMutationOptions(userId));
  const updateMutation = useMutation(updateWalletTicketMutationOptions(userId));
  const deleteMutation = useMutation(deleteWalletTicketMutationOptions(userId));
  const [screening, setScreening] = useState<ScreeningForm>(emptyScreening);
  const [qrMessage, setQrMessage] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [isReadingQr, setIsReadingQr] = useState(false);
  const [editingTicketId, setEditingTicketId] = useState<string | null>(null);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [suggestionApplied, setSuggestionApplied] = useState(false);
  const [suggestionWasApplied, setSuggestionWasApplied] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [downloadingTicketId, setDownloadingTicketId] = useState<string | null>(
    null,
  );
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const selectedTicket = activeTicketQuery.data;
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const suggestedScreening = recentQuery.data
    ? {
        tmdbId: recentQuery.data.tmdbId,
        title: recentQuery.data.title,
        city: recentQuery.data.city,
        cinema: recentQuery.data.cinema,
        screeningDate: recentQuery.data.screeningDate,
        screeningTime: recentQuery.data.screeningTime,
      }
    : null;
  const visibleScreening =
    suggestedScreening &&
    !suggestionApplied &&
    !hasInteracted &&
    !editingTicketId
      ? suggestedScreening
      : screening;

  function setField<K extends keyof ScreeningForm>(
    field: K,
    value: ScreeningForm[K],
  ) {
    const base =
      !suggestionApplied && !hasInteracted && suggestedScreening
        ? suggestedScreening
        : screening;
    if (base === suggestedScreening) setSuggestionWasApplied(true);
    setHasInteracted(true);
    setScreening({ ...base, [field]: value });
  }

  async function handleScreenshot(file: File | undefined) {
    if (!file) return;
    setQrError(null);
    setPageError(null);
    setFeedback(null);
    setIsReadingQr(true);
    try {
      const message = await readQrFromImage(file);
      setQrMessage(message);
      setQrError(null);
      setFeedback(
        "QR code read on this device. The screenshot was not uploaded or saved.",
      );
    } catch (error) {
      setQrMessage(null);
      setQrError(
        error instanceof Error
          ? error.message
          : "The QR code could not be read. Retry or use the original ticket.",
      );
    } finally {
      setIsReadingQr(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function saveTicket() {
    setPageError(null);
    setFeedback(null);
    if (!qrMessage) {
      setQrError("Choose a ticket screenshot and read its QR code first.");
      return;
    }
    if (
      !visibleScreening.title.trim() ||
      !visibleScreening.city.trim() ||
      !visibleScreening.cinema.trim() ||
      !visibleScreening.screeningDate ||
      !visibleScreening.screeningTime
    ) {
      setPageError(
        "Complete the movie, city, cinema, show date, and showtime before saving.",
      );
      return;
    }
    const input = {
      tmdbId: visibleScreening.tmdbId.trim() || null,
      title: visibleScreening.title,
      city: visibleScreening.city,
      cinema: visibleScreening.cinema,
      screeningDate: visibleScreening.screeningDate,
      screeningTime: visibleScreening.screeningTime,
      qrMessage,
      reminderEnabled: false,
    };
    try {
      if (editingTicketId) {
        const ticket = await updateMutation.mutateAsync({
          ticketId: editingTicketId,
          patch: {
            ...input,
            reminderEnabled: undefined,
          },
        });
        setActiveTicketId(ticket.id);
        setEditingTicketId(null);
        setFeedback(
          "Ticket updated. Select Update in Apple Wallet to replace the pass.",
        );
      } else {
        const ticket = await createMutation.mutateAsync(input);
        setActiveTicketId(ticket.id);
        setFeedback("Ticket saved to your Kartiseret account.");
      }
      setScreening(emptyScreening);
      setQrMessage(null);
      setHasInteracted(false);
      setSuggestionApplied(true);
      setSuggestionWasApplied(false);
      setQrError(null);
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "Ticket could not be saved.",
      );
    }
  }

  function startEditing() {
    if (!selectedTicket) return;
    setScreening({
      tmdbId: selectedTicket.tmdbId ?? "",
      title: selectedTicket.title,
      city: selectedTicket.city,
      cinema: selectedTicket.cinema,
      screeningDate: selectedTicket.screeningDate,
      screeningTime: selectedTicket.screeningTime,
    });
    setQrMessage(selectedTicket.qrMessage);
    setQrError(null);
    setEditingTicketId(selectedTicket.id);
    setHasInteracted(true);
    setSuggestionApplied(true);
    setSuggestionWasApplied(false);
  }

  function cancelEditing() {
    setEditingTicketId(null);
    setQrMessage(null);
    setQrError(null);
    setScreening(emptyScreening);
    setHasInteracted(false);
    setSuggestionApplied(false);
    setSuggestionWasApplied(false);
  }

  async function downloadPass(ticketId: string) {
    if (!userId) return;
    setDownloadingTicketId(ticketId);
    setPageError(null);
    try {
      const pass = await privateApiBlob(
        `/api/v1/ticket-passes/${ticketId}/pass.pkpass`,
        { userId },
      );
      const url = URL.createObjectURL(pass);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `Kartiseret-Ticket-${ticketId}.pkpass`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setFeedback(
        "Pass downloaded. Open it on your iPhone to add or update it in Apple Wallet.",
      );
    } catch (error) {
      setPageError(
        error instanceof ApiRequestError
          ? error.message
          : "Apple Wallet pass could not be created. Your ticket is still saved below.",
      );
    } finally {
      setDownloadingTicketId(null);
    }
  }

  async function removeTicket(ticketId: string) {
    setPageError(null);
    try {
      await deleteMutation.mutateAsync(ticketId);
      if (activeTicketId === ticketId) setActiveTicketId(null);
      setConfirmDeleteId(null);
      setFeedback("Ticket deleted from your Kartiseret account.");
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "Ticket could not be deleted.",
      );
    }
  }

  if (!userId) {
    return (
      <section className="wallet-ticket-panel">
        <h3>Sign in to save tickets</h3>
        <p>
          Imported tickets are kept in your Kartiseret account so they appear in
          the iPhone app too.
        </p>
        <Link to="/user?tab=account" className="wallet-ticket-button">
          Go to sign in
        </Link>
      </section>
    );
  }

  return (
    <div className="wallet-ticket-workspace">
      <section
        className="wallet-ticket-panel"
        aria-labelledby="wallet-ticket-import-heading"
      >
        <div className="wallet-ticket-panel-heading">
          <div>
            <p className="prefs-setting-label">Kartiseret tickets</p>
            <h3 id="wallet-ticket-import-heading">
              {editingTicketId
                ? "Update ticket details"
                : "Import a ticket screenshot"}
            </h3>
          </div>
          {editingTicketId ? (
            <button
              className="wallet-ticket-button wallet-ticket-button--quiet"
              type="button"
              onClick={cancelEditing}
            >
              Cancel edit
            </button>
          ) : null}
        </div>
        <p className="wallet-ticket-help">
          Choose a screenshot that contains a QR code. Kartiseret reads the code
          on this device and does not upload or keep the image. Check the
          screening details before saving.
        </p>

        <label className="wallet-ticket-upload">
          <span>
            {isReadingQr
              ? "Reading QR code…"
              : qrMessage
                ? "Choose a different screenshot"
                : "Choose ticket screenshot"}
          </span>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            disabled={isReadingQr || isSaving}
            onChange={(event) =>
              void handleScreenshot(event.currentTarget.files?.[0])
            }
          />
        </label>
        {qrMessage ? (
          <p className="wallet-ticket-qr-ready" role="status">
            QR code ready. The QR contents stay in your private ticket record.
          </p>
        ) : null}
        {qrError ? (
          <p className="wallet-ticket-error" role="alert">
            {qrError}
          </p>
        ) : null}

        <div className="wallet-ticket-form-grid">
          <label>
            <span>Movie or show</span>
            <input
              required
              maxLength={200}
              value={visibleScreening.title}
              onChange={(event) => setField("title", event.currentTarget.value)}
              placeholder="Movie title"
            />
          </label>
          <label>
            <span>City</span>
            <input
              required
              maxLength={200}
              value={visibleScreening.city}
              onChange={(event) => setField("city", event.currentTarget.value)}
              placeholder="City"
            />
          </label>
          <label>
            <span>Cinema</span>
            <input
              required
              maxLength={200}
              value={visibleScreening.cinema}
              onChange={(event) =>
                setField("cinema", event.currentTarget.value)
              }
              placeholder="Cinema name"
            />
          </label>
          <label>
            <span>Show date (Israel time)</span>
            <input
              required
              type="date"
              value={visibleScreening.screeningDate}
              onChange={(event) =>
                setField("screeningDate", event.currentTarget.value)
              }
            />
          </label>
          <label>
            <span>Showtime (Israel time)</span>
            <input
              required
              type="time"
              value={visibleScreening.screeningTime}
              onChange={(event) =>
                setField("screeningTime", event.currentTarget.value)
              }
            />
          </label>
        </div>

        {recentQuery.data &&
        (suggestionWasApplied || (!suggestionApplied && !hasInteracted)) &&
        !editingTicketId ? (
          <p className="wallet-ticket-suggestion" role="status">
            Prefilled from your latest Kartiseret showtime click. Review the
            details and correct anything that changed.
          </p>
        ) : recentQuery.data === null && !recentQuery.isPending ? (
          <p className="wallet-ticket-help">
            No recent showtime suggestion is available. Enter the screening
            details above.
          </p>
        ) : recentQuery.isError ? (
          <p className="wallet-ticket-help">
            No recent showtime suggestion is available. Enter the screening
            details above.
          </p>
        ) : null}
        {pageError ? (
          <p className="wallet-ticket-error" role="alert">
            {pageError}
          </p>
        ) : null}
        {feedback ? (
          <p className="wallet-ticket-success" role="status">
            {feedback}
          </p>
        ) : null}

        <div className="wallet-ticket-form-actions">
          <button
            className="wallet-ticket-button"
            type="button"
            disabled={isSaving || isReadingQr}
            onClick={() => void saveTicket()}
          >
            {isSaving
              ? "Saving…"
              : editingTicketId
                ? "Save ticket changes"
                : "Save to My Tickets"}
          </button>
          {qrMessage ? (
            <span className="wallet-ticket-privacy-note">
              Screenshot not uploaded
            </span>
          ) : null}
        </div>
      </section>

      <section
        className="wallet-ticket-list-panel"
        aria-labelledby="wallet-ticket-list-heading"
      >
        <div className="wallet-ticket-panel-heading">
          <div>
            <p className="prefs-setting-label">Your account</p>
            <h3 id="wallet-ticket-list-heading">My Tickets</h3>
          </div>
          <span className="wallet-ticket-count">
            {ticketsQuery.data?.length ?? 0}
          </span>
        </div>
        {ticketsQuery.isPending ? (
          <p className="prefs-alerts-empty" role="status">
            Loading your tickets…
          </p>
        ) : ticketsQuery.isError ? (
          <p className="wallet-ticket-error" role="alert">
            {ticketsQuery.error.message}
          </p>
        ) : !ticketsQuery.data?.length ? (
          <p className="prefs-alerts-empty">
            No tickets saved yet. Import a screenshot to get started.
          </p>
        ) : (
          <ul className="wallet-ticket-list">
            {ticketsQuery.data.map((ticket) => (
              <li key={ticket.id}>
                <button
                  className={`wallet-ticket-list-item${activeTicketId === ticket.id ? " is-selected" : ""}`}
                  type="button"
                  aria-pressed={activeTicketId === ticket.id}
                  onClick={() => {
                    setActiveTicketId(ticket.id);
                    setEditingTicketId(null);
                    setPageError(null);
                    setFeedback(null);
                  }}
                >
                  <span className="wallet-ticket-list-title">
                    {ticket.title}
                  </span>
                  <span>
                    {ticket.cinema} · {ticket.city}
                  </span>
                  <span>
                    {dateLabel(ticket.screeningDate)} · {ticket.screeningTime}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {activeTicketId && activeTicketQuery.isPending ? (
          <p className="prefs-alerts-empty" role="status">
            Opening ticket…
          </p>
        ) : null}
        {activeTicketId && activeTicketQuery.isError ? (
          <p className="wallet-ticket-error" role="alert">
            {activeTicketQuery.error.message}
          </p>
        ) : null}
        {selectedTicket ? (
          <article className="wallet-ticket-detail">
            <div className="wallet-ticket-detail-qr">
              <img
                src={`/api/v1/ticket-passes/${selectedTicket.id}/qr.svg?v=${encodeURIComponent(selectedTicket.updatedAt)}`}
                alt={`QR code for ${selectedTicket.title}`}
                width={240}
                height={240}
              />
            </div>
            <p className="wallet-ticket-help">
              Use this QR from the Kartiseret app or website if Apple Wallet is
              unavailable. For the original ticket, use the cinema’s ticket page
              or email.
            </p>
            <div className="wallet-ticket-detail-actions">
              <button
                className="wallet-ticket-button"
                type="button"
                disabled={downloadingTicketId === selectedTicket.id}
                onClick={() => void downloadPass(selectedTicket.id)}
              >
                {downloadingTicketId === selectedTicket.id
                  ? "Preparing pass…"
                  : "Add or Update in Apple Wallet"}
              </button>
              <button
                className="wallet-ticket-button wallet-ticket-button--quiet"
                type="button"
                onClick={startEditing}
              >
                Edit ticket
              </button>
              {confirmDeleteId === selectedTicket.id ? (
                <div
                  className="wallet-ticket-delete-confirm"
                  role="group"
                  aria-label="Confirm ticket deletion"
                >
                  <span>Delete this ticket?</span>
                  <button
                    type="button"
                    disabled={deleteMutation.isPending}
                    onClick={() => void removeTicket(selectedTicket.id)}
                  >
                    {deleteMutation.isPending ? "Deleting…" : "Confirm delete"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(null)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  className="wallet-ticket-button wallet-ticket-button--danger"
                  type="button"
                  onClick={() => setConfirmDeleteId(selectedTicket.id)}
                >
                  Delete ticket
                </button>
              )}
            </div>
            {selectedTicket.reminderEnabled ? (
              <p className="wallet-ticket-suggestion">
                A 15 minute reminder is enabled in the Kartiseret iPhone app.
              </p>
            ) : null}
          </article>
        ) : null}
      </section>
    </div>
  );
}
