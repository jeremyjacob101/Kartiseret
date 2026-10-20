import { PasswordSecurityForm } from "./PasswordSecurityForm";
import { Link, useSearchParams } from "react-router";
import "./PasswordResetPage.css";

export function PasswordResetPage() {
  const [query] = useSearchParams();
  const token = query.get("token");
  const hasToken = Boolean(
    token && token.length <= 4096 && !query.has("error"),
  );

  return (
    <section className="password-reset-page" aria-label="Password reset">
      <div className="password-reset-page-header">
        <p className="section-kicker">Account</p>
        <h1 className="section-title">Password reset</h1>
      </div>

      <div className="password-reset-page-card">
        {hasToken ? (
          <PasswordSecurityForm
            resetToken={token ?? undefined}
            requireCurrentPassword={false}
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
                Request a new reset link from the login menu.
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
