import { useUserPreferencesStore } from "../stores/userPreferencesStore";
import { usePublicRoutePaths } from "../routing/PublicRoutePathsContext";
import { PublicRouteLink } from "../routing/PublicRouteLink";
import { getOpaquePublicPath } from "../data/publicRoutes";
import { useLocation, useNavigate } from "react-router";
import { OPEN_AUTH_MENU_EVENT } from "../lib/authMenu";
import { getAuthClient } from "../lib/authClient";
import { useState } from "react";
import "./DeleteAccountConfirmationPage.css";

export function DeleteAccountConfirmationPage({
  confirmationToken,
}: {
  confirmationToken?: string;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const publicRoutePaths = usePublicRoutePaths();
  const user = useUserPreferencesStore((state) => state.user);
  const loading = useUserPreferencesStore((state) => state.loading);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletionSucceeded, setDeletionSucceeded] = useState(false);
  const [needsManualAppleRevocation, setNeedsManualAppleRevocation] =
    useState(false);
  const token =
    confirmationToken ??
    new URLSearchParams(location.hash.slice(1)).get("token");
  const validToken = Boolean(token && token.length <= 4096);

  async function confirmDeletion() {
    if (!token) return;
    setPending(true);
    setError(null);
    try {
      let manualAppleRevocation = false;
      const result = await getAuthClient().deleteUser({
        token,
        fetchOptions: {
          onSuccess: ({ response }) => {
            manualAppleRevocation =
              response.headers.get("x-kartiseret-apple-revocation") ===
              "manual";
          },
        },
      });
      if (result.error) {
        setError(
          result.error.code === "APPLE_REVOCATION_FAILED"
            ? "Apple access could not be removed right now. Request a new confirmation email and try again."
            : result.error.status === 404
              ? "This link may have expired, or you need to sign in to the account that requested deletion before confirming."
              : "The account could not be deleted. Please sign in and try again.",
        );
        return;
      }
      if (manualAppleRevocation) {
        setNeedsManualAppleRevocation(true);
        return;
      }
      setDeletionSucceeded(true);
      void getOpaquePublicPath("/?accountDeleted=1", publicRoutePaths)
        .then((path) => navigate(path, { replace: true }))
        .catch(() => undefined);
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
        {needsManualAppleRevocation ? (
          <>
            <p className="delete-confirmation-copy" role="status">
              Your Kartiseret account has been deleted. To remove Kartiseret’s
              Apple access, open Settings → [your name] → Sign in with Apple,
              select Kartiseret, then tap Delete.
            </p>
            <PublicRouteLink to="/?accountDeleted=1" replace>
              Done
            </PublicRouteLink>
          </>
        ) : deletionSucceeded ? (
          <>
            <p className="delete-confirmation-copy" role="status">
              Your Kartiseret account has been deleted.
            </p>
            <PublicRouteLink to="/?accountDeleted=1" replace>
              Done
            </PublicRouteLink>
          </>
        ) : !validToken ? (
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
        <PublicRouteLink className="delete-confirmation-link" to="/">
          Return to Kartiseret
        </PublicRouteLink>
      </div>
    </section>
  );
}
