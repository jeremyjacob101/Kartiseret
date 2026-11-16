import { getAuthClient } from "../lib/authClient";
import { useState, type FormEvent } from "react";
import "./DeleteAccountSection.css";

const authClient = getAuthClient();

export function DeleteAccountSection() {
  const [isOpen, setIsOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (confirmation !== "DELETE") {
      setError('Type "DELETE" to confirm account deletion.');
      return;
    }

    setPending(true);
    try {
      const result = await authClient.deleteUser();
      if (result.error) {
        setError(
          result.error.code === "SESSION_EXPIRED"
            ? "For security, sign out and sign back in with your usual method, then request deletion again. Google and Apple work here; you do not need a Kartiseret password."
            : (result.error.message ?? "Account deletion failed."),
        );
        return;
      }

      setIsOpen(false);
      setConfirmation("");
      setMessage("Check your email for a link to review and confirm deletion.");
    } catch {
      setError("The confirmation email could not be sent. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="delete-account-section" aria-label="Delete account">
      <div className="delete-account-header">
        <h2 className="delete-account-title">Delete account</h2>
        <p className="delete-account-description">
          Permanently delete your account and account-linked data stored by
          Kartiseret. This cannot be undone. Backup copies may remain until
          those backups expire.
        </p>
      </div>

      {!isOpen ? (
        <>
          <button
            type="button"
            className="delete-account-open"
            onClick={() => {
              setMessage(null);
              setError(null);
              setIsOpen(true);
            }}
          >
            Delete account
          </button>
          {message ? (
            <p className="delete-account-feedback" role="status">
              {message}
            </p>
          ) : null}
        </>
      ) : (
        <form className="delete-account-form" onSubmit={handleSubmit}>
          <label className="delete-account-field">
            <span>Type DELETE to confirm</span>
            <input
              type="text"
              autoComplete="off"
              value={confirmation}
              onChange={(event) => {
                setConfirmation(event.target.value);
              }}
              required
            />
          </label>
          <div className="delete-account-actions">
            <button
              type="button"
              className="delete-account-cancel"
              disabled={pending}
              onClick={() => {
                setIsOpen(false);
                setConfirmation("");
                setError(null);
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="delete-account-submit"
              disabled={pending || confirmation !== "DELETE"}
            >
              {pending ? "Sending email…" : "Email me a confirmation link"}
            </button>
          </div>
        </form>
      )}

      {error ? (
        <p className="delete-account-feedback" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
