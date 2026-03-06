import { useEffect, useRef, useState, type FormEvent } from "react";
import { LogOut, User } from "lucide-react";
import { getSupabaseBrowserClient } from "../lib/supabase";
import { loadGuestLocation } from "../prefs/locations";
import { useRatingSourcesContext } from "../prefs/ratingSourcesStore";

type AuthMode = "login" | "signup";
type UserMenuProps = {
  currentPath: string;
  onNavigate: (path: string) => void;
};

const supabase = getSupabaseBrowserClient();

export function UserMenu({ currentPath, onNavigate }: UserMenuProps) {
  const { user } = useRatingSourcesContext();
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

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthMessage(null);
    setAuthError(null);

    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail || !password) {
      setAuthError("Enter both email and password.");
      return;
    }

    setAuthPending(true);

    if (authMode === "signup") {
      const guestLocation = loadGuestLocation();
      const { data, error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: guestLocation
          ? {
              data: {
                signup_location: guestLocation,
              },
            }
          : undefined,
      });

      setAuthPending(false);

      if (error) {
        setAuthError(error.message);
        return;
      }

      setPassword("");
      setAuthMessage(
        data.session
          ? "Account created. You are signed in."
          : "Account created. Set Confirm Email OFF for instant sign-in.",
      );
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
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
    <div className="user-menu" ref={menuRef}>
      <button
        type="button"
        className={`user-menu-trigger${isOpen ? " is-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={user ? `Signed in as ${user.email}` : "Sign up or log in"}
        onClick={() => {
          setIsOpen((open) => !open);
        }}
      >
        <User size={20} strokeWidth={2.75} color="#a66ae3"/>
      </button>

      {isOpen ? (
        <div className="user-menu-panel" role="menu" aria-label="User account menu">
          <div className="user-menu-header">
            <p className="user-menu-title">{user ? "Account" : "Auth testing"}</p>
            <p className="user-menu-subtitle">
              {user ? user.email : "Create an account or log in"}
            </p>
          </div>

          {!user ? (
            <form className="user-menu-auth-form" onSubmit={handleAuthSubmit}>
              <div className="user-menu-auth-toggle" role="tablist" aria-label="Auth mode">
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

              <label className="user-menu-field">
                <span>Password</span>
                <input
                  type="password"
                  autoComplete={
                    authMode === "signup" ? "new-password" : "current-password"
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

              <button type="submit" className="user-menu-submit" disabled={authPending}>
                {authPending
                  ? authMode === "signup"
                    ? "Creating..."
                    : "Signing in..."
                  : authMode === "signup"
                    ? "Create account"
                    : "Log in"}
              </button>
            </form>
          ) : (
            <div className="user-menu-authenticated">
              <button
                type="button"
                className="user-menu-nav-button"
                onClick={() => {
                  onNavigate(currentPath === "/user" ? "/" : "/user");
                  setIsOpen(false);
                }}
              >
                {currentPath === "/user" ? "Back to Home" : "Open User Preferences"}
              </button>

              <button
                type="button"
                className="user-menu-signout"
                onClick={() => {
                  void handleSignOut();
                }}
                disabled={logoutPending}
              >
                <LogOut size={20} strokeWidth={2.75} color="#a66ae3"/>
                {logoutPending ? "Signing out..." : "Sign out"}
              </button>
            </div>
          )}

          {authMessage ? <p className="user-menu-feedback">{authMessage}</p> : null}
          {authError ? (
            <p className="user-menu-feedback user-menu-feedback--error">{authError}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
