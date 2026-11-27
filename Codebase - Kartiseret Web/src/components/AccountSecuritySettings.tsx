import { loadSocialProviders, type SocialProvider } from "../lib/socialProviders";
import { usePublicRouteLocation } from "../routing/PublicRouteLocation";
import { PasswordSecurityForm } from "./PasswordSecurityForm";
import { getAuthClient } from "../lib/authClient";
import { Link2, Unlink } from "lucide-react";
import { useEffect, useState } from "react";
import "./AccountSecuritySettings.css";

type AccountSecuritySettingsProps = { email: string | null };
type LinkedAccount = { id: string; providerId: string };

const authClient = getAuthClient();
const socialProviderLabels: Record<SocialProvider, string> = {
  google: "Google",
  apple: "Apple",
};
const freshSignInMessage =
  "Sign out and sign back in before changing your sign-in methods.";

export function AccountSecuritySettings({
  email,
}: AccountSecuritySettingsProps) {
  const location = usePublicRouteLocation();
  const [providers, setProviders] = useState<SocialProvider[]>([]);
  const [accounts, setAccounts] = useState<LinkedAccount[] | null>(null);
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void loadSocialProviders(controller.signal).then(setProviders);
    void authClient
      .listAccounts()
      .then(({ data, error: resultError }) => {
        if (controller.signal.aborted) return;
        if (resultError) {
          setError(
            "Your sign-in methods could not be loaded. Refresh and try again.",
          );
          return;
        }
        setAccounts(
          (data ?? []).map((account) => ({
            id: account.id,
            providerId: account.providerId,
          })),
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(
            "Your sign-in methods could not be loaded. Refresh and try again.",
          );
        }
      });
    return () => controller.abort();
  }, []);

  async function connectProvider(provider: SocialProvider) {
    setPendingProvider(provider);
    setError(null);
    setMessage(null);
    const callback = new URL("/user?linked=1", window.location.origin).href;
    const errorCallback = new URL("/user?linkError=1", window.location.origin)
      .href;
    try {
      const result = await authClient.linkSocial({
        provider,
        callbackURL: callback,
        errorCallbackURL: errorCallback,
      });
      if (result.error) {
        setError(
          result.error.code === "SESSION_NOT_FRESH"
            ? freshSignInMessage
            : (result.error.message ??
                "This sign-in method could not be connected."),
        );
      }
    } catch {
      setError("This sign-in method could not be connected. Try again.");
    } finally {
      setPendingProvider(null);
    }
  }

  async function disconnectProvider(account: LinkedAccount) {
    setPendingProvider(account.providerId);
    setError(null);
    setMessage(null);
    try {
      const result = await authClient.unlinkAccount({ accountId: account.id });
      if (result.error) {
        setError(
          result.error.code === "FAILED_TO_UNLINK_LAST_ACCOUNT"
            ? "Connect another sign-in method before disconnecting this one."
            : result.error.code === "SESSION_NOT_FRESH"
              ? freshSignInMessage
              : (result.error.message ??
                "This sign-in method could not be disconnected."),
        );
        return;
      }
      setAccounts(
        (current) => current?.filter((item) => item.id !== account.id) ?? [],
      );
      setMessage(
        `${socialProviderLabels[account.providerId as SocialProvider] ?? "Sign-in method"} disconnected.`,
      );
    } catch {
      setError("This sign-in method could not be disconnected. Try again.");
    } finally {
      setPendingProvider(null);
    }
  }

  const hasPassword = accounts?.some(
    (account) => account.providerId === "credential",
  );
  const linkedCallback = new URLSearchParams(location.search);
  const linked = linkedCallback.get("linked") === "1";
  const linkError = linkedCallback.get("linkError") === "1";
  const linkErrorCode = linkedCallback.get("error");

  return (
    <>
      <section
        className="account-security-section"
        aria-label="Sign-in methods"
      >
        <div className="account-security-header">
          <div>
            <h2 className="account-security-title">Sign-in methods</h2>
            <p className="account-security-description">
              Connect another way to sign in, or remove one you no longer use.
            </p>
          </div>
        </div>

        <div className="account-security-list" aria-live="polite">
          {accounts === null ? (
            <p
              className="account-security-note"
              role={error ? "alert" : "status"}
            >
              {error ?? "Loading sign-in methods…"}
            </p>
          ) : (
            <>
              {hasPassword ? (
                <div className="account-security-row">
                  <span className="account-security-method">
                    Email and password
                  </span>
                  <span className="account-security-status">Connected</span>
                </div>
              ) : null}
              {providers.map((provider) => {
                const account = accounts.find(
                  (item) => item.providerId === provider,
                );
                return (
                  <div className="account-security-row" key={provider}>
                    <span className="account-security-method">
                      {socialProviderLabels[provider]}
                    </span>
                    {account ? (
                      <div className="account-security-actions">
                        <span className="account-security-status">
                          Connected
                        </span>
                        <button
                          type="button"
                          className="account-security-action"
                          disabled={pendingProvider !== null}
                          onClick={() => void disconnectProvider(account)}
                        >
                          <Unlink size={15} aria-hidden="true" />
                          Disconnect
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="account-security-action"
                        disabled={pendingProvider !== null}
                        onClick={() => void connectProvider(provider)}
                      >
                        <Link2 size={15} aria-hidden="true" />
                        {pendingProvider === provider
                          ? "Connecting…"
                          : `Connect ${socialProviderLabels[provider]}`}
                      </button>
                    )}
                  </div>
                );
              })}
              {providers.length === 0 ? (
                <p className="account-security-note">
                  Google and Apple sign-in are not configured for this
                  environment.
                </p>
              ) : null}
            </>
          )}
        </div>

        {linked ? (
          <p className="account-security-feedback" role="status">
            Sign-in method connected.
          </p>
        ) : null}
        {linkError ? (
          <p
            className="account-security-feedback account-security-feedback--error"
            role="alert"
          >
            {linkErrorCode === "account_already_linked_to_different_user"
              ? "This sign-in method is already connected to another Kartiseret account."
              : linkErrorCode === "link_session_changed"
                ? "Sign in again and restart the connection from User Preferences."
                : "The connection failed. Try again while signed in."}
          </p>
        ) : null}
        {message ? (
          <p className="account-security-feedback" role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p
            className="account-security-feedback account-security-feedback--error"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </section>

      {hasPassword ? (
        <PasswordSecurityForm
          description="Update the password used to sign in to Kartiseret."
          requireCurrentPassword
          submitLabel="Change password"
          title="Change password"
        />
      ) : accounts === null ? null : email ? (
        <PasswordSecurityForm
          setupEmail={email}
          description="Add email and password as a backup sign-in method. We’ll email you a secure link to create it."
          title="Add a password"
          submitLabel="Email me a setup link"
        />
      ) : (
        <p className="account-security-note">
          Add a verified email address before setting up a password.
        </p>
      )}
    </>
  );
}
