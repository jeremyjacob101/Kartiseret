import { useUserPreferencesStore } from "../stores/userPreferencesStore";
import { Link, useLocation, useNavigate } from "react-router";
import { OPEN_AUTH_MENU_EVENT } from "../lib/authMenu";
import { useState } from "react";
import "./DeleteAccountConfirmationPage.css";

export function DeleteAccountConfirmationPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useUserPreferencesStore((state) => state.user);
  const loading = useUserPreferencesStore((state) => state.loading);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = new URLSearchParams(location.hash.slice(1)).get("token");
  const validToken = Boolean(token && token.length <= 4096);

  async function confirmDeletion() {
    if (!token) return;
    setPending(true);
    setError(null);
    try {
      const callbackURL = new URL("/?accountDeleted=1", window.location.origin);
      const endpoint = new URL(
        "/api/auth/delete-user/callback",
        window.location.origin,
      );
      endpoint.searchParams.set("token", token);
      endpoint.searchParams.set("callbackURL", callbackURL.href);
      const response = await fetch(endpoint.href, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok || !response.redirected) {
        setError(
          response.status === 404
            ? "This link may have expired, or you need to sign in to the account that requested deletion before confirming."
            : "The account could not be deleted. Please sign in and try again.",
        );
        return;
      }
      navigate("/?accountDeleted=1", { replace: true });
    } catch {
      setError("The account could not be deleted. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className="delete-confirmation-page"
      aria-label="Confirm account deletion"
    >
      <div className="delete-confirmation-card">
        <p className="section-kicker">Account security</p>
        <h1 className="delete-confirmation-title">Delete your account?</h1>
        {!validToken ? (
          <p className="delete-confirmation-copy" role="alert">
            This confirmation link is invalid or expired. Request a new one from
            User Preferences.
          </p>
        ) : (
          <>
            <p className="delete-confirmation-copy">
              This permanently deletes your Kartiseret account and
              account-linked data. Opening this page did not delete anything.
            </p>
            {loading ? (
              <p className="delete-confirmation-copy" role="status">
                Checking your sign-in…
              </p>
            ) : user ? (
              <>
                <p className="delete-confirmation-account">
                  Signed in as <strong>{user.email}</strong>
                </p>
                <button
                  type="button"
                  className="delete-confirmation-submit"
                  disabled={pending}
                  onClick={() => void confirmDeletion()}
                >
                  {pending ? "Deleting account…" : "Confirm and delete account"}
                </button>
              </>
            ) : (
              <>
                <p className="delete-confirmation-copy">
                  Sign in to the account that requested deletion in this
                  browser, then return to this email link to confirm.
                </p>
                <button
                  type="button"
                  className="delete-confirmation-secondary"
                  onClick={() => {
                    window.dispatchEvent(new Event(OPEN_AUTH_MENU_EVENT));
                  }}
                >
                  Sign in
                </button>
              </>
            )}
            {error ? (
              <p className="delete-confirmation-error" role="alert">
                {error}
              </p>
            ) : null}
          </>
        )}
        <Link className="delete-confirmation-link" to="/">
          Return to Kartiseret
        </Link>
      </div>
    </section>
  );
}
