import { useEffect, useRef, useState, type FormEvent } from "react";
import { LogOut, User } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import "./UserMenu.css";
import { getSupabaseBrowserClient } from "../lib/supabase";
import { DEFAULT_LOCATION, loadGuestLocation, LOCATION_SIGNUP_METADATA_KEY } from "../prefs/definitions/locations";
import { DEFAULT_RATING_SOURCES } from "../prefs/definitions/ratingSources";
import { DEFAULT_SITE_COLOR } from "../prefs/definitions/siteColor";
import { useUserPreferencesContext } from "../prefs/useUserPreferences";
import { useI18n } from "../i18n/I18nContext";
import { LOCALE_SIGNUP_METADATA_KEY } from "../i18n/locale";

type AuthMode = "login" | "signup";
type UserMenuProps = {
  panelDirection?: "down" | "up";
  triggerTabIndex?: number;
};

const supabase = getSupabaseBrowserClient();
const PREFERENCES_TABLE = "userPreferences";

async function persistSignupPreferenceDefaults(
  userId: string,
  location: string,
): Promise<string | null> {
  const { error } = await supabase.from(PREFERENCES_TABLE).upsert(
    {
      user_id: userId,
      rating_sources: [...DEFAULT_RATING_SOURCES],
      location,
      site_color: DEFAULT_SITE_COLOR,
    },
    { onConflict: "user_id" },
  );

  return error?.message ?? null;
}

export function UserMenu({
  panelDirection = "down",
  triggerTabIndex,
}: UserMenuProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { locale, t } = useI18n();
  const { user } = useUserPreferencesContext();
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
      setAuthError(t("account.error.required"));
      return;
    }

    setAuthPending(true);

    if (authMode === "signup") {
      const signupLocation = loadGuestLocation() ?? DEFAULT_LOCATION;
      const { data, error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: {
          data: {
            [LOCATION_SIGNUP_METADATA_KEY]: signupLocation,
            [LOCALE_SIGNUP_METADATA_KEY]: locale,
          },
        },
      });

      if (error) {
        console.error("Could not create account.", error);
        setAuthPending(false);
        setAuthError(t("account.error.signup"));
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
        console.error(
          "Could not save signup preference defaults.",
          preferenceInitializationError,
        );
        setAuthError(t("account.error.preferenceDefaults"));
      }

      setAuthMessage(
        data.session
          ? preferenceInitializationError
            ? t("account.createdPartial")
            : t("account.created")
          : t("account.createdConfirm"),
      );
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    setAuthPending(false);

    if (error) {
      console.error("Could not sign in.", error);
      setAuthError(t("account.error.login"));
      return;
    }

    setPassword("");
    setAuthMessage(t("account.signedIn"));
  }

  async function handleSignOut() {
    setAuthMessage(null);
    setAuthError(null);
    setLogoutPending(true);
    const { error } = await supabase.auth.signOut();
    setLogoutPending(false);

    if (error) {
      console.error("Could not sign out.", error);
      setAuthError(t("account.error.signout"));
      return;
    }

    setAuthMessage(t("account.signedOut"));
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
        aria-label={
          user
            ? t("account.signedInAs", { email: user.email ?? "" })
            : t("account.open")
        }
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
          aria-label={t("account.menu")}
        >
          <div className="user-menu-header">
            <p className="user-menu-title">
              {user ? t("account.title") : t("account.authTesting")}
            </p>
            <p className="user-menu-subtitle" dir={user ? "ltr" : "auto"}>
              {user ? user.email : t("account.createOrLogin")}
            </p>
          </div>

          {!user ? (
            <form className="user-menu-auth-form" onSubmit={handleAuthSubmit}>
              <div
                className="user-menu-auth-toggle"
                role="tablist"
                aria-label={t("account.authMode")}
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
                  {t("account.login")}
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
                  {t("account.signup")}
                </button>
              </div>

              <label className="user-menu-field">
                <span>{t("account.email")}</span>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                  }}
                  placeholder="you@example.com"
                  dir="ltr"
                  required
                />
              </label>

              <label className="user-menu-field">
                <span>{t("account.password")}</span>
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
                  dir="ltr"
                  minLength={6}
                  required
                />
              </label>

              <button
                type="submit"
                className="user-menu-submit"
                disabled={authPending}
              >
                {authPending
                  ? authMode === "signup"
                    ? t("account.creating")
                    : t("account.signingIn")
                  : authMode === "signup"
                    ? t("account.create")
                    : t("account.login")}
              </button>
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
                  ? t("account.backHome")
                  : t("account.openPreferences")}
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
                {logoutPending ? t("account.signingOut") : t("account.signOut")}
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
