import { createWalletTicketMutationOptions, deleteWalletTicketMutationOptions, updateWalletTicketMutationOptions, walletRecentScreeningQueryOptions, walletTicketDetailQueryOptions, walletTicketsQueryOptions } from "../data/walletTickets";
import { MAX_WALLET_TICKET_QR_CODES, walletListedScreeningsResponseSchema, walletTicketDetailResponseSchema } from "@kartiseret/contracts/private-data";
import { privateApiBlob, privateApiResponse } from "../data/privateApi";
import { useMutation, useQuery } from "@tanstack/react-query";
import { decodeQrCodes } from "../lib/walletQrScanner";
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

const emptyScreening: ScreeningForm = {
  tmdbId: "",
  title: "",
  city: "",
  cinema: "",
  screeningDate: "",
  screeningTime: "",
};

async function readQrFromImage(file: File): Promise<string[]> {
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
    return decodeQrCodes(pixels.data, width, height, jsQR);
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
  const [qrMessages, setQrMessages] = useState<string[]>([]);
  const [qrError, setQrError] = useState<string | null>(null);
  const [isReadingQr, setIsReadingQr] = useState(false);
  const [isAppendingQr, setIsAppendingQr] = useState(false);
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
  const addMoreFileInput = useRef<HTMLInputElement>(null);

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

  const [listedCriteria, setListedCriteria] = useState<{
    city: string;
    date: string;
  }>();
  const listedScreenings = useQuery({
    queryKey: ["walletTickets", "listedScreenings", userId, listedCriteria],
    enabled: Boolean(userId && listedCriteria),
    queryFn: async ({ signal }) => {
      if (!userId || !listedCriteria)
        throw new Error("Choose a city and date.");
      const params = new URLSearchParams(listedCriteria);
      const response = await privateApiResponse(
        `/api/v1/ticket-passes/listed-screenings?${params}`,
        walletListedScreeningsResponseSchema,
        { userId, signal },
      );
      return response.data.screenings;
    },
    retry: false,
  });
  const matchingList =
    listedCriteria?.city === visibleScreening.city.trim() &&
    listedCriteria?.date === visibleScreening.screeningDate;

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

  async function decodeScreenshots(files: File[]): Promise<{
    messages: string[];
    failures: string[];
  }> {
    const messages = new Set<string>();
    const failures: string[] = [];
    for (const file of files) {
      try {
        for (const message of await readQrFromImage(file))
          messages.add(message);
      } catch (error) {
        failures.push(
          `${file.name || "Screenshot"}: ${error instanceof Error ? error.message : "QR code could not be read."}`,
        );
      }
    }
    return { messages: [...messages], failures };
  }

  async function handleScreenshots(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    setQrError(null);
    setPageError(null);
    setFeedback(null);
    setIsReadingQr(true);
    try {
      const result = await decodeScreenshots(files);
      const available = MAX_WALLET_TICKET_QR_CODES - qrMessages.length;
      const newMessages = result.messages.filter(
        (message) => !qrMessages.includes(message),
      );
      const accepted = newMessages.slice(0, Math.max(0, available));
      setQrMessages((current) => [...current, ...accepted]);
      const notices = [...result.failures];
      if (newMessages.length > accepted.length) {
        notices.push(
          `A booking can contain up to ${MAX_WALLET_TICKET_QR_CODES} ticket QR codes. Extra codes were left out.`,
        );
      }
      if (accepted.length > 0) {
        setFeedback(
          `${accepted.length} new ticket QR code${accepted.length === 1 ? "" : "s"} read on this device. Screenshots were not uploaded or saved.`,
        );
      } else if (result.messages.length === 0 && notices.length === 0) {
        notices.push(
          "No new ticket QR code was found. Retry with a clearer screenshot or use the original ticket.",
        );
      } else if (result.messages.length > 0 && newMessages.length === 0) {
        setFeedback("Those QR codes are already in this booking.");
      }
      if (notices.length > 0) setQrError(notices.join(" "));
    } finally {
      setIsReadingQr(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function addMoreScreenshots(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (!files.length || !userId || !selectedTicket) return;
    setQrError(null);
    setPageError(null);
    setFeedback(null);
    setIsAppendingQr(true);
    setIsReadingQr(true);
    try {
      const result = await decodeScreenshots(files);
      const existing = new Set(
        selectedTicket.qrCodes.map((code) => code.qrMessage),
      );
      const newMessages = result.messages.filter(
        (message) => !existing.has(message),
      );
      const available =
        MAX_WALLET_TICKET_QR_CODES - selectedTicket.qrCodes.length;
      const accepted = newMessages.slice(0, Math.max(0, available));
      if (accepted.length > 0) {
        const response = await privateApiResponse(
          `/api/v1/ticket-passes/${selectedTicket.id}/qr-codes`,
          walletTicketDetailResponseSchema,
          { method: "POST", userId, body: { qrMessages: accepted } },
        );
        await Promise.all([
          activeTicketQuery.refetch(),
          ticketsQuery.refetch(),
        ]);
        setFeedback(
          `${response.data.ticket.qrCodes.length} ticket QR codes are now saved in this booking.`,
        );
      } else if (newMessages.length === 0 && result.messages.length > 0) {
        setFeedback("Those QR codes are already in this booking.");
      }
      const notices = [...result.failures];
      if (newMessages.length > accepted.length) {
        notices.push(
          `A booking can contain up to ${MAX_WALLET_TICKET_QR_CODES} ticket QR codes. Extra codes were left out.`,
        );
      }
      if (notices.length > 0) setQrError(notices.join(" "));
      if (!result.messages.length && !notices.length) {
        setQrError(
          "No new ticket QR code was found. Retry with a clearer screenshot or use the original ticket.",
        );
      }
    } catch (error) {
      setPageError(
        error instanceof ApiRequestError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Ticket QR codes could not be added. Retry or use the original ticket.",
      );
    } finally {
      setIsReadingQr(false);
      setIsAppendingQr(false);
      if (addMoreFileInput.current) addMoreFileInput.current.value = "";
    }
  }

  async function saveTicket() {
    setPageError(null);
    setFeedback(null);
    if (!editingTicketId && qrMessages.length === 0) {
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
    };
    try {
      if (editingTicketId) {
        const ticket = await updateMutation.mutateAsync({
          ticketId: editingTicketId,
          patch: {
            ...input,
          },
        });
        setActiveTicketId(ticket.id);
        setEditingTicketId(null);
        setFeedback(
          "Ticket updated. Select Update in Apple Wallet to replace the pass.",
        );
      } else {
        const ticket = await createMutation.mutateAsync({
          ...input,
          qrMessages,
          reminderEnabled: false,
        });
        setActiveTicketId(ticket.id);
        setFeedback("Ticket saved to your Kartiseret account.");
      }
      setScreening(emptyScreening);
      setQrMessages([]);
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
    setQrMessages([]);
    setQrError(null);
    setEditingTicketId(selectedTicket.id);
    setHasInteracted(true);
    setSuggestionApplied(true);
    setSuggestionWasApplied(false);
  }

  function cancelEditing() {
    setEditingTicketId(null);
    setQrMessages([]);
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
      const isBundle = (selectedTicket?.qrCodes.length ?? 0) > 1;
      const extension = isBundle ? "pkpasses" : "pkpass";
      const pass = await privateApiBlob(
        `/api/v1/ticket-passes/${ticketId}/${isBundle ? "passes.pkpasses" : "pass.pkpass"}`,
        { userId },
      );
      const url = URL.createObjectURL(pass);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `Kartiseret-Tickets-${ticketId}.${extension}`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setFeedback(
        isBundle
          ? "Ticket bundle downloaded. Open it on your iPhone to review and add the whole family booking to Apple Wallet."
          : "Pass downloaded. Open it on your iPhone to add or update it in Apple Wallet.",
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
      if (editingTicketId === ticketId) cancelEditing();
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
        {!editingTicketId ? (
          <>
            <p className="wallet-ticket-help">
              Choose one or more screenshots. Kartiseret reads every QR code on
              this device and does not upload or keep the images. Check the
              screening details before saving.
            </p>
            <label className="wallet-ticket-upload">
              <span>
                {isReadingQr
                  ? "Reading ticket QR codes…"
                  : qrMessages.length
                    ? "Add or choose more screenshots"
                    : "Choose ticket screenshots"}
              </span>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                disabled={isReadingQr || isSaving}
                onChange={(event) =>
                  void handleScreenshots(event.currentTarget.files)
                }
              />
            </label>
            {qrMessages.length > 0 ? (
              <div className="wallet-ticket-qr-ready" role="status">
                <p>
                  {qrMessages.length} of {MAX_WALLET_TICKET_QR_CODES} ticket QR
                  codes ready. QR contents stay private with this booking.
                </p>
                <ol aria-label="Ticket QR codes to save">
                  {qrMessages.map((_, index) => (
                    <li key={index}>
                      Ticket {index + 1}
                      <button
                        type="button"
                        aria-label={`Remove ticket QR ${index + 1}`}
                        disabled={isSaving || isReadingQr}
                        onClick={() =>
                          setQrMessages((current) =>
                            current.filter(
                              (__, currentIndex) => currentIndex !== index,
                            ))
                        }
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </>
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

        <div className="wallet-ticket-form-actions">
          <button
            type="button"
            className="wallet-ticket-button wallet-ticket-button--quiet"
            disabled={
              !visibleScreening.city.trim() ||
              !visibleScreening.screeningDate ||
              isSaving
            }
            onClick={() => {
              if (matchingList) void listedScreenings.refetch();
              else
                setListedCriteria({
                  city: visibleScreening.city.trim(),
                  date: visibleScreening.screeningDate,
                });
            }}
          >
            Find listed screenings
          </button>
          <span className="wallet-ticket-privacy-note">
            Enter a city and date to look up a screening.
          </span>
        </div>
        {matchingList && listedScreenings.isFetching && (
          <p role="status">Loading screenings…</p>
        )}
        {matchingList && listedScreenings.isError && (
          <p role="status">
            Listings are unavailable. Enter the details manually or retry.
          </p>
        )}
        {matchingList && listedScreenings.data?.length === 0 && (
          <p role="status">No screenings found. Enter the details manually.</p>
        )}
        {matchingList && Boolean(listedScreenings.data?.length) && (
          <label>
            <span>Listed screening</span>
            <select
              value=""
              onChange={(event) => {
                if (!event.currentTarget.value) return;
                const chosen =
                  listedScreenings.data?.[Number(event.currentTarget.value)];
                if (!chosen) return;
                setScreening(chosen);
                setHasInteracted(true);
                setSuggestionApplied(true);
                setSuggestionWasApplied(false);
                setListedCriteria(undefined);
                setFeedback("Review the selected screening before saving.");
              }}
            >
              <option value="">Choose a screening</option>
              {listedScreenings.data?.map((item, index) => (
                <option key={index} value={index}>
                  {item.screeningTime} · {item.title} · {item.cinema}
                </option>
              ))}
            </select>
          </label>
        )}

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
          {qrMessages.length > 0 ? (
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
                    if (editingTicketId) {
                      cancelEditing();
                    }
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
            <div className="wallet-ticket-admissions">
              {selectedTicket.qrCodes.map((code, index) => (
                <div className="wallet-ticket-detail-qr" key={code.id}>
                  {selectedTicket.qrCodes.length > 1 ? (
                    <h4>
                      Ticket {index + 1} of {selectedTicket.qrCodes.length}
                    </h4>
                  ) : null}
                  <img
                    key={`${code.id}-${selectedTicket.updatedAt}`}
                    src={`/api/v1/ticket-passes/${selectedTicket.id}/codes/${code.id}/qr.svg`}
                    alt={`Ticket QR code ${index + 1} for ${selectedTicket.title}`}
                    width={240}
                    height={240}
                  />
                </div>
              ))}
            </div>
            <p className="wallet-ticket-help">
              {selectedTicket.qrCodes.length === 1
                ? "This booking has one ticket QR code."
                : `This booking has ${selectedTicket.qrCodes.length} ticket QR codes. Show the matching code for each person at the cinema.`}
            </p>
            <label className="wallet-ticket-upload">
              <span>
                {isAppendingQr
                  ? "Adding ticket QR codes…"
                  : "Add more ticket screenshots"}
              </span>
              <input
                ref={addMoreFileInput}
                type="file"
                accept="image/*"
                multiple
                disabled={
                  isAppendingQr ||
                  selectedTicket.qrCodes.length >= MAX_WALLET_TICKET_QR_CODES
                }
                onChange={(event) =>
                  void addMoreScreenshots(event.currentTarget.files)
                }
              />
            </label>
            <p className="wallet-ticket-help">
              Use these QR codes from the Kartiseret app or website if Apple
              Wallet is unavailable. For the original ticket, use the cinema’s
              ticket page or email.
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
                  : selectedTicket.qrCodes.length > 1
                    ? "Add all tickets to Apple Wallet"
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
                A 15 minute reminder is enabled. Open Kartiseret on your iPhone
                after changing or deleting a ticket to sync its reminder.
              </p>
            ) : null}
          </article>
        ) : null}
      </section>
    </div>
  );
}
