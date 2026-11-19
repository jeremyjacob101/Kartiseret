import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from "@kartiseret/contracts/private-data";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Apple, ArrowUpRight, Clapperboard, LogOut, User, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { createPortal } from "react-dom";
import { z } from "zod";
import "./UserMenu.css";
import { DEFAULT_LOCATION, loadGuestLocation } from "../prefs/definitions/locations";
import { loadSocialProviders, type SocialProvider } from "../lib/socialProviders";
import { useUserPreferencesStore } from "../stores/userPreferencesStore";
import { getPasswordResetRedirectUrl } from "../lib/authRoutes";
import { OPEN_AUTH_MENU_EVENT } from "../lib/authMenu";
import { getAuthClient } from "../lib/authClient";

type AuthMode = "login" | "signup" | "forgotPassword";
type UserMenuProps = {
  panelDirection?: "down" | "up";
  triggerTabIndex?: number;
};

const authClient = getAuthClient();
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address.");
const authCredentialsSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter both email and password."),
});

const providerLabels: Record<SocialProvider, string> = {
  google: "Google",
  apple: "Apple",
};

function GoogleMark() {
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      className="user-menu-brand-icon"
    >
      <path
        fill="#4285f4"
        d="M47.5 24.55c0-1.57-.14-3.09-.4-4.55H24v9.02h13.22a11.3 11.3 0 0 1-4.9 7.42v6.03h7.95c4.65-4.29 7.23-10.61 7.23-17.92Z"
      />
      <path
        fill="#34a853"
        d="M24 48c6.65 0 12.23-2.2 16.3-5.96l-7.96-6.03c-2.2 1.48-5.02 2.35-8.34 2.35-6.43 0-11.87-4.33-13.82-10.15H2v6.22A24 24 0 0 0 24 48Z"
      />
      <path
        fill="#fbbc05"
        d="M10.18 28.21A14.4 14.4 0 0 1 9.42 24c0-1.46.26-2.87.76-4.21v-6.22H2A24 24 0 0 0 0 24c0 3.87.93 7.54 2.58 10.78l7.6-5.93Z"
      />
      <path
        fill="#ea4335"
        d="M24 9.64c3.62 0 6.86 1.24 9.42 3.68l7.06-7.06C36.22 2.4 30.65 0 24 0A24 24 0 0 0 2 13.57l8.18 6.22C12.13 13.97 17.57 9.64 24 9.64Z"
      />
    </svg>
  );
}

function getAuthErrorMessage(code?: string | null, message?: string | null) {
  const normalized = code?.toLowerCase();
  if (normalized === "account_not_linked") {
    return "Sign in to your existing Kartiseret account using your original method, then connect this provider in User Preferences.";
  }
  if (normalized === "social_account_already_linked") {
    return "That provider is already attached to a Kartiseret account. Sign in with your linked method.";
  }
  return (
    message ?? "The account request could not be completed. Please try again."
  );
}

function getAccentForegroundColor(): string {
  if (typeof document === "undefined") return "#fff";
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--main-app-color")
    .trim();
  const match = /^#?([\da-f]{6})$/i.exec(value);
  if (!match?.[1]) return "#fff";
  const channels = [0, 2, 4].map(
    (offset) => Number.parseInt(match[1]!.slice(offset, offset + 2), 16) / 255,
  );
  const luminance = channels.reduce((sum, channel, index) => {
    const linear =
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    return sum + linear * [0.2126, 0.7152, 0.0722][index]!;
  }, 0);
  const whiteContrast = 1.05 / (luminance + 0.05);
  const darkContrast = (luminance + 0.05) / (0.012 + 0.05);
  return whiteContrast >= darkContrast ? "#fff" : "#211b27";
}

export function UserMenu({
  panelDirection = "down",
  triggerTabIndex,
}: UserMenuProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useUserPreferencesStore((state) => state.user);
  const callback = new URLSearchParams(
    location.pathname === "/" ? location.search : "",
  );
  const verified = callback.get("verified") === "1";
  const oauthError = callback.get("error");
  const accountDeleted = callback.get("accountDeleted") === "1";
  const verificationError = callback.has("error") || callback.has("authError");
  const [isOpen, setIsOpen] = useState(
    verified || verificationError || accountDeleted,
  );
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authPending, setAuthPending] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<SocialProvider | null>(
    null,
  );
  const [socialProviders, setSocialProviders] = useState<SocialProvider[]>([]);
  const [logoutPending, setLogoutPending] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(
    accountDeleted
      ? "Your Kartiseret account has been deleted."
      : verified
        ? "Email confirmed. You can now log in."
        : null,
  );
  const [authError, setAuthError] = useState<string | null>(
    oauthError === "account_not_linked"
      ? getAuthErrorMessage(oauthError)
      : verificationError
        ? "This sign-in link could not be completed. Check the link or sign in with your original method."
        : null,
  );
  const menuRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void loadSocialProviders(controller.signal).then(setSocialProviders);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    if (!user) {
      const previousFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      const firstFocusable =
        dialogRef.current?.querySelector<HTMLElement>("input:not(:disabled)") ??
        dialogRef.current?.querySelector<HTMLElement>("button:not(:disabled)");
      firstFocusable?.focus();

      function handleDialogKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape") {
          setIsOpen(false);
          return;
        }
        if (event.key !== "Tab" || !dialogRef.current) return;
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), a[href]",
          ),
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
      document.addEventListener("keydown", handleDialogKeyDown);
      return () => {
        document.removeEventListener("keydown", handleDialogKeyDown);
        document.body.style.overflow = previousOverflow;
        previousFocus?.focus();
      };
    }

    function handleOutsidePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && !menuRef.current?.contains(target)) {
        setIsOpen(false);
      }
    }
    function handleMenuEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    window.addEventListener("pointerdown", handleOutsidePointerDown);
    window.addEventListener("keydown", handleMenuEscape);
    return () => {
      window.removeEventListener("pointerdown", handleOutsidePointerDown);
      window.removeEventListener("keydown", handleMenuEscape);
    };
  }, [isOpen, user]);

  useEffect(() => {
    const handleAuthMenuRequest = () => {
      if (!user) setAuthMode("login");
      setAuthMessage(null);
      setAuthError(null);
      setIsOpen(true);
    };
    window.addEventListener(OPEN_AUTH_MENU_EVENT, handleAuthMenuRequest);
    return () => {
      window.removeEventListener(OPEN_AUTH_MENU_EVENT, handleAuthMenuRequest);
    };
  }, [user]);

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthMessage(null);
    setAuthError(null);

    const emailResult = emailSchema.safeParse(email);
    if (!emailResult.success) {
      setAuthError(
        emailResult.error.issues[0]?.message ?? "Enter a valid email address.",
      );
      return;
    }

    if (authMode === "forgotPassword") {
      setAuthPending(true);
      const { error } = await authClient.requestPasswordReset({
        email: emailResult.data,
        redirectTo: getPasswordResetRedirectUrl(),
      });
      setAuthPending(false);
      if (error) {
        setAuthError(getAuthErrorMessage(error.code, error.message));
        return;
      }
      setPassword("");
      setAuthMessage(
        "If an account exists for that email, you’ll receive a reset link.",
      );
      return;
    }

    const credentials = authCredentialsSchema.safeParse({
      email: emailResult.data,
      password,
    });
    if (!credentials.success) {
      setAuthError(
        credentials.error.issues[0]?.message ?? "Enter valid credentials.",
      );
      return;
    }
    const { email: trimmedEmail, password: validatedPassword } =
      credentials.data;
    setAuthPending(true);

    if (authMode === "signup") {
      const signupLocation = loadGuestLocation() ?? DEFAULT_LOCATION;
      if (validatedPassword.length < PASSWORD_MIN_LENGTH) {
        setAuthPending(false);
        setAuthError("Password must be between 8 and 128 characters.");
        return;
      }
      const { error } = await authClient.signUp.email({
        name: "Kartiseret member",
        email: trimmedEmail,
        password: validatedPassword,
        signupLocation,
        callbackURL: new URL("/?verified=1", window.location.origin).href,
      });
      setAuthPending(false);
      if (error) {
        setAuthError(getAuthErrorMessage(error.code, error.message));
        return;
      }
      setPassword("");
      setAuthMessage("Check your email to confirm your account, then log in.");
      return;
    }

    const { error } = await authClient.signIn.email({
      email: trimmedEmail,
      password: validatedPassword,
    });
    setAuthPending(false);
    if (error) {
      setAuthError(getAuthErrorMessage(error.code, error.message));
      return;
    }
    setPassword("");
    setAuthMessage("Signed in.");
  }

  async function handleSocialSignIn(provider: SocialProvider) {
    setAuthMessage(null);
    setAuthError(null);
    setPendingProvider(provider);
    const callbackURL = new URL(window.location.href);
    callbackURL.searchParams.delete("error");
    callbackURL.searchParams.delete("authError");
    const errorCallbackURL = new URL(callbackURL.href);
    errorCallbackURL.searchParams.set("authError", "1");
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: callbackURL.href,
        errorCallbackURL: errorCallbackURL.href,
      });
      if (result.error) {
        setAuthError(
          getAuthErrorMessage(result.error.code, result.error.message),
        );
      }
    } catch {
      setAuthError(
        "The provider sign-in could not be started. Please try again.",
      );
    } finally {
      setPendingProvider(null);
    }
  }

  async function handleSignOut() {
    setAuthMessage(null);
    setAuthError(null);
    setLogoutPending(true);
    const { error } = await authClient.signOut();
    setLogoutPending(false);
    if (error) {
      setAuthError(getAuthErrorMessage(error.code, error.message));
      return;
    }
    setAuthMessage("Signed out.");
    setIsOpen(false);
  }

  const authDialog =
    isOpen && !user && typeof document !== "undefined"
      ? createPortal(
          <div
            className="user-menu-scrim"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setIsOpen(false);
            }}
          >
            <div
              ref={dialogRef}
              className="user-menu-dialog"
              style={
                {
                  "--auth-accent-foreground": getAccentForegroundColor(),
                } as CSSProperties
              }
              role="dialog"
              aria-modal="true"
              aria-labelledby="user-menu-dialog-title"
              aria-describedby="user-menu-dialog-description"
              tabIndex={-1}
            >
              <header className="user-menu-dialog-header">
                <div className="user-menu-brand">
                  <span className="user-menu-brand-mark">
                    <Clapperboard
                      size={19}
                      strokeWidth={2.1}
                      aria-hidden="true"
                    />
                  </span>
                  <span className="user-menu-brand-copy">
                    <strong>KARTISERET</strong>
                    <span>YOUR CINEMA, YOUR WAY</span>
                  </span>
                </div>
                <button
                  type="button"
                  className="user-menu-close"
                  aria-label="Close sign in"
                  onClick={() => setIsOpen(false)}
                >
                  <X size={19} aria-hidden="true" />
                </button>
              </header>

              <div className="user-menu-dialog-heading">
                <p className="user-menu-dialog-kicker">
                  {authMode === "signup"
                    ? "Join the community"
                    : "Welcome to Kartiseret"}
                </p>
                <h2 id="user-menu-dialog-title">
                  {authMode === "forgotPassword"
                    ? "Reset your password"
                    : authMode === "signup"
                      ? "Create your account"
                      : "Welcome back"}
                </h2>
                <p id="user-menu-dialog-description">
                  {authMode === "forgotPassword"
                    ? "We’ll email you a secure link to choose a new password."
                    : authMode === "signup"
                      ? "Save the cinemas, films, and showtimes you care about."
                      : "Sign in to pick up where your next movie night begins."}
                </p>
              </div>

              {authMode !== "forgotPassword" && socialProviders.length > 0 ? (
                <div
                  className="user-menu-social-options"
                  aria-label="Social sign-in"
                >
                  {socialProviders.map((provider) => (
                    <button
                      type="button"
                      key={provider}
                      className={`user-menu-social-button user-menu-social-button--${provider}`}
                      disabled={pendingProvider !== null || authPending}
                      onClick={() => void handleSocialSignIn(provider)}
                    >
                      {provider === "google" ? (
                        <GoogleMark />
                      ) : (
                        <Apple size={19} strokeWidth={2.1} aria-hidden="true" />
                      )}
                      <span>
                        {pendingProvider === provider
                          ? `Opening ${providerLabels[provider]}…`
                          : `Continue with ${providerLabels[provider]}`}
                      </span>
                      <ArrowUpRight size={16} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              ) : null}

              {authMode !== "forgotPassword" && socialProviders.length > 0 ? (
                <div className="user-menu-or-divider" aria-hidden="true">
                  <span />
                  <small>OR CONTINUE WITH EMAIL</small>
                  <span />
                </div>
              ) : null}

              {!user ? (
                <form
                  className="user-menu-auth-form"
                  onSubmit={handleAuthSubmit}
                >
                  {authMode === "forgotPassword" ? (
                    <button
                      type="button"
                      className="user-menu-back-link"
                      onClick={() => {
                        setAuthMode("login");
                        setAuthMessage(null);
                        setAuthError(null);
                      }}
                    >
                      Back to log in
                    </button>
                  ) : (
                    <div
                      className="user-menu-auth-toggle"
                      role="tablist"
                      aria-label="Account action"
                    >
                      <button
                        type="button"
                        className={`user-menu-mode${authMode === "login" ? " is-active" : ""}`}
                        role="tab"
                        aria-selected={authMode === "login"}
                        onClick={() => {
                          setAuthMode("login");
                          setAuthMessage(null);
                          setAuthError(null);
                        }}
                      >
                        Log in
                      </button>
                      <button
                        type="button"
                        className={`user-menu-mode${authMode === "signup" ? " is-active" : ""}`}
                        role="tab"
                        aria-selected={authMode === "signup"}
                        onClick={() => {
                          setAuthMode("signup");
                          setAuthMessage(null);
                          setAuthError(null);
                        }}
                      >
                        Create account
                      </button>
                    </div>
                  )}

                  <label className="user-menu-field">
                    <span>Email address</span>
                    <input
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                      required
                    />
                  </label>

                  {authMode === "forgotPassword" ? (
                    <p className="user-menu-form-note">
                      Enter your email and we&apos;ll send a reset link if an
                      account exists.
                    </p>
                  ) : (
                    <label className="user-menu-field">
                      <span>Password</span>
                      <input
                        minLength={
                          authMode === "signup" ? PASSWORD_MIN_LENGTH : 1
                        }
                        maxLength={PASSWORD_MAX_LENGTH}
                        type="password"
                        autoComplete={
                          authMode === "signup"
                            ? "new-password"
                            : "current-password"
                        }
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="At least 8 characters"
                        required
                      />
                    </label>
                  )}

                  <button
                    type="submit"
                    className="user-menu-submit"
                    disabled={authPending || pendingProvider !== null}
                  >
                    {authPending
                      ? authMode === "signup"
                        ? "Creating account…"
                        : authMode === "forgotPassword"
                          ? "Sending link…"
                          : "Signing in…"
                      : authMode === "signup"
                        ? "Create account"
                        : authMode === "forgotPassword"
                          ? "Send reset link"
                          : "Log in"}
                  </button>

                  {authMode === "login" ? (
                    <button
                      type="button"
                      className="user-menu-forgot-link"
                      onClick={() => {
                        setAuthMode("forgotPassword");
                        setPassword("");
                        setAuthMessage(null);
                        setAuthError(null);
                      }}
                    >
                      Forgot password?
                    </button>
                  ) : null}
                </form>
              ) : null}

              {authMessage ? (
                <p className="user-menu-feedback" role="status">
                  {authMessage}
                </p>
              ) : null}
              {authError ? (
                <p
                  className="user-menu-feedback user-menu-feedback--error"
                  role="alert"
                >
                  {authError}
                </p>
              ) : null}
              <p className="user-menu-dialog-footer">
                Your account keeps your Kartiseret preferences in sync.
              </p>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      className={`user-menu user-menu--panel-${panelDirection}`}
      ref={menuRef}
    >
      <button
        type="button"
        className={`user-menu-trigger${isOpen ? " is-open" : ""}`}
        tabIndex={triggerTabIndex}
        aria-haspopup={user ? "menu" : "dialog"}
        aria-expanded={isOpen}
        aria-label={user ? `Signed in as ${user.email}` : "Sign up or log in"}
        onClick={() => {
          setAuthError(null);
          setAuthMessage(null);
          setIsOpen((open) => !open);
        }}
      >
        <User size={20} strokeWidth={2.75} className="app-accent-icon" />
      </button>

      {isOpen && user ? (
        <div
          className="user-menu-panel"
          role="menu"
          aria-label="User account menu"
        >
          <div className="user-menu-header">
            <p className="user-menu-title">Account</p>
            <p className="user-menu-subtitle">{user.email}</p>
          </div>
          <div className="user-menu-authenticated">
            <button
              type="button"
              className="user-menu-nav-button"
              onClick={() => {
                navigate(location.pathname === "/user" ? "/" : "/user");
                setIsOpen(false);
              }}
            >
              {location.pathname === "/user"
                ? "Back to Home"
                : "Open User Preferences"}
            </button>
            <button
              type="button"
              className="user-menu-signout"
              onClick={() => void handleSignOut()}
              disabled={logoutPending}
            >
              <LogOut size={18} className="user-menu-signout-icon" />
              {logoutPending ? "Signing out…" : "Sign out"}
            </button>
          </div>
          {authError ? (
            <p
              className="user-menu-feedback user-menu-feedback--error"
              role="alert"
            >
              {authError}
            </p>
          ) : null}
          {authMessage ? (
            <p className="user-menu-feedback" role="status">
              {authMessage}
            </p>
          ) : null}
        </div>
      ) : null}

      {authDialog}
    </div>
  );
}
