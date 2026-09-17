import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { LogOut, User } from "lucide-react";
import { z } from "zod";
import "./UserMenu.css";
import { DEFAULT_LOCATION, loadGuestLocation, LOCATION_SIGNUP_METADATA_KEY } from "../prefs/definitions/locations";
import { persistSignupPreferenceDefaults, useUserPreferencesStore } from "../stores/userPreferencesStore";
import { getPasswordResetRedirectUrl } from "../lib/authRoutes";
import { getSupabaseBrowserClient } from "../lib/supabase";
import { OPEN_AUTH_MENU_EVENT } from "../lib/authMenu";

type AuthMode = "login" | "signup" | "forgotPassword";
type UserMenuProps = {
  panelDirection?: "down" | "up";
  triggerTabIndex?: number;
};

const supabase = getSupabaseBrowserClient();
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address.");
const authCredentialsSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter both email and password."),
});

export function UserMenu({
  panelDirection = "down",
  triggerTabIndex,
}: UserMenuProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useUserPreferencesStore((state) => state.user);
  const [isOpen, setIsOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authPending, setAuthPending] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleOutsidePointerDown(event: PointerEvent) {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (!menuRef.current?.contains(target)) {
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    window.addEventListener("pointerdown", handleOutsidePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("pointerdown", handleOutsidePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  useEffect(() => {
    const handleAuthMenuRequest = () => {
      if (!user) {
        setAuthMode("signup");
      }
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
      const { error } = await supabase.auth.resetPasswordForEmail(
        emailResult.data,
        { redirectTo: getPasswordResetRedirectUrl() },
      );

      setAuthPending(false);

      if (error) {
        setAuthError(error.message);
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
      const { data, error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password: validatedPassword,
        options: {
          data: {
            [LOCATION_SIGNUP_METADATA_KEY]: signupLocation,
          },
        },
      });

      if (error) {
        setAuthPending(false);
        setAuthError(error.message);
        return;
      }

      let preferenceInitializationError: string | null = null;

      if (data.session && data.user) {
        preferenceInitializationError = await persistSignupPreferenceDefaults(
          data.user.id,
          signupLocation,
        );
      }

      setAuthPending(false);

      setPassword("");

      if (preferenceInitializationError) {
        setAuthError(preferenceInitializationError);
      }

      setAuthMessage(
        data.session
          ? preferenceInitializationError
            ? "Account created. You are signed in, but default preferences could not be finalized."
            : "Account created. You are signed in."
          : "Account created. Check your email to confirm, then log in.",
      );
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password: validatedPassword,
    });

    setAuthPending(false);

    if (error) {
      setAuthError(error.message);
      return;
    }

    setPassword("");
    setAuthMessage("Signed in.");
  }

  async function handleSignOut() {
    setAuthMessage(null);
    setAuthError(null);
    setLogoutPending(true);
    const { error } = await supabase.auth.signOut();
    setLogoutPending(false);

    if (error) {
      setAuthError(error.message);
      return;
    }

    setAuthMessage("Signed out.");
    setIsOpen(false);
  }

  return (
    <div
      className={`user-menu user-menu--panel-${panelDirection}`}
      ref={menuRef}
    >
      <button
        type="button"
        className={`user-menu-trigger${isOpen ? " is-open" : ""}`}
        tabIndex={triggerTabIndex}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={user ? `Signed in as ${user.email}` : "Sign up or log in"}
        onClick={() => {
          setIsOpen((open) => !open);
        }}
      >
        <User size={20} strokeWidth={2.75} className="app-accent-icon" />
      </button>

      {isOpen ? (
        <div
          className="user-menu-panel"
          role="menu"
          aria-label="User account menu"
        >
          <div className="user-menu-header">
            <p className="user-menu-title">
              {user ? "Account" : "Sign up or log in"}
            </p>
            <p className="user-menu-subtitle">
              {user ? user.email : "Create an account or log in"}
            </p>
          </div>

          {!user ? (
            <form className="user-menu-auth-form" onSubmit={handleAuthSubmit}>
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
                  aria-label="Auth mode"
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
                    Sign up
                  </button>
                </div>
              )}

              <label className="user-menu-field">
                <span>Email</span>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                  }}
                  placeholder="you@example.com"
                  required
                />
              </label>

              {authMode === "forgotPassword" ? (
                <p className="user-menu-form-note">
                  Enter your email and we&apos;ll send a password reset link if
                  an account exists.
                </p>
              ) : (
                <label className="user-menu-field">
                  <span>Password</span>
                  <input
                    type="password"
                    autoComplete={
                      authMode === "signup"
                        ? "new-password"
                        : "current-password"
                    }
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                    }}
                    placeholder="••••••••"
                    minLength={6}
                    required
                  />
                </label>
              )}

              <button
                type="submit"
                className="user-menu-submit"
                disabled={authPending}
              >
                {authPending
                  ? authMode === "signup"
                    ? "Creating..."
                    : authMode === "forgotPassword"
                      ? "Sending..."
                      : "Signing in..."
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
          ) : (
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
                onClick={() => {
                  void handleSignOut();
                }}
                disabled={logoutPending}
              >
                <LogOut
                  size={20}
                  strokeWidth={2.75}
                  className="user-menu-signout-icon"
                />
                {logoutPending ? "Signing out..." : "Sign out"}
              </button>
            </div>
          )}

          {authMessage ? (
            <p className="user-menu-feedback">{authMessage}</p>
          ) : null}
          {authError ? (
            <p className="user-menu-feedback user-menu-feedback--error">
              {authError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
