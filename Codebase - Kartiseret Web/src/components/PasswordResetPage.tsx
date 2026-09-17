import { useUserPreferencesStore } from "../stores/userPreferencesStore";
import { PasswordSecurityForm } from "./PasswordSecurityForm";
import { useShallow } from "zustand/react/shallow";
import { Link } from "react-router";
import "./PasswordResetPage.css";

export function PasswordResetPage() {
  const { user, loading } = useUserPreferencesStore(
    useShallow((state) => ({
      user: state.user,
      loading: state.loading,
    })),
  );
  const isCheckingSession = !user && loading;

  return (
    <section className="password-reset-page" aria-label="Password reset">
      <div className="password-reset-page-header">
        <p className="section-kicker">Account</p>
        <h1 className="section-title">
          {isCheckingSession ? "Checking your reset link" : "Password reset"}
        </h1>
      </div>

      <div className="password-reset-page-card">
        {isCheckingSession ? (
          <p className="password-reset-page-note" role="status">
            Checking your reset link...
          </p>
        ) : user ? (
          <PasswordSecurityForm
            description="Choose a new password for your Kartiseret account."
            successMessage="Password updated. You can now return to Kartiseret."
            title="Create a new password"
            variant="embedded"
          />
        ) : (
          <>
            <div className="password-reset-page-copy">
              <h2 className="password-reset-page-title">
                This reset link is invalid or expired
              </h2>
              <p className="password-reset-page-note">
                Request a new reset link from the login menu and open it from
                the same browser.
              </p>
            </div>
            <Link className="password-reset-page-link" to="/">
              Return to Home
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
