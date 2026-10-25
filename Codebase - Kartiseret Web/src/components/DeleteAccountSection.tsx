import { getAuthClient } from "../lib/authClient";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import "./DeleteAccountSection.css";

const authClient = getAuthClient();

export function DeleteAccountSection() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (confirmation !== "DELETE") {
      setError('Type "DELETE" to confirm account deletion.');
      return;
    }

    if (!password) {
      setError("Enter your current password to continue.");
      return;
    }

    setPending(true);
    try {
      const result = await authClient.deleteUser({ password });
      if (result.error) {
        setError(result.error.message ?? "Account deletion failed.");
        return;
      }

      navigate("/", { replace: true });
    } catch {
      setError("Account deletion failed. Please try again.");
    } finally {
      setPending(false);
      setPassword("");
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
        <button
          type="button"
          className="delete-account-open"
          onClick={() => {
            setIsOpen(true);
          }}
        >
          Delete account
        </button>
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
          <label className="delete-account-field">
            <span>Current password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
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
                setPassword("");
                setError(null);
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="delete-account-submit"
              disabled={pending || confirmation !== "DELETE" || !password}
            >
              {pending ? "Deleting..." : "Permanently delete account"}
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
