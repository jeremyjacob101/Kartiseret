import { useUserPreferencesStore } from "../../src/stores/userPreferencesStore";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { saveGuestLocation } from "../../src/prefs/definitions/locations";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router";
import { UserMenu } from "../../src/components/UserMenu";
import userEvent from "@testing-library/user-event";

const { authMock } = vi.hoisted(() => ({
  authMock: {
    signIn: { email: vi.fn(), social: vi.fn() },
    signUp: { email: vi.fn() },
    requestPasswordReset: vi.fn(),
    signOut: vi.fn(),
  },
}));

vi.mock("../../src/lib/authClient", () => ({
  getAuthClient: vi.fn(() => authMock),
}));

function PathLabel() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

function renderMenu(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <UserMenu />
      <PathLabel />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  const storageValues = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storageValues.get(key) ?? null,
      setItem: (key: string, value: string) => storageValues.set(key, value),
      removeItem: (key: string) => storageValues.delete(key),
      clear: () => storageValues.clear(),
    },
  });
  authMock.signIn.email.mockResolvedValue({ error: null });
  authMock.signIn.social.mockResolvedValue({ error: null });
  authMock.signUp.email.mockResolvedValue({
    data: { session: null, user: null },
    error: null,
  });
  authMock.requestPasswordReset.mockResolvedValue({ error: null });
  authMock.signOut.mockResolvedValue({ error: null });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { providers: [] }, error: null }),
    })),
  );
  useUserPreferencesStore.setState({
    user: null,
    loading: false,
    error: null,
  });
});

afterEach(() => {
  useUserPreferencesStore.setState({ user: null, loading: true });
  vi.unstubAllGlobals();
});

describe("UserMenu", () => {
  it("opens, closes on escape/outside input, and reports empty credentials", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole("button", { name: "Sign up or log in" }));
    expect(
      screen.getByRole("dialog", { name: /welcome back/i }),
    ).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sign up or log in" }));
    const form = document.querySelector("form.user-menu-auth-form");
    expect(form).not.toBeNull();
    await user.type(screen.getByLabelText("Email address"), "user@example.com");
    fireEvent.submit(form!);
    expect(
      screen.getByText("Enter both email and password."),
    ).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole("dialog").parentElement!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("normalizes login credentials and surfaces authentication failures", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: "Sign up or log in" }));
    await user.type(
      screen.getByLabelText("Email address"),
      "  USER@Example.COM ",
    );
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() =>
      expect(authMock.signIn.email).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "secret123",
      }));
    expect(screen.getByText("Signed in.")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveValue("");

    authMock.signIn.email.mockResolvedValueOnce({
      error: { message: "Invalid credentials" },
    });
    await user.type(screen.getByLabelText("Password"), "wrongpass");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByText("Invalid credentials")).toBeInTheDocument();
  });

  it("requires a name on signup and sends it with the guest location", async () => {
    const user = userEvent.setup();
    saveGuestLocation("Haifa");
    renderMenu();
    await user.click(screen.getByRole("button", { name: "Sign up or log in" }));
    expect(
      screen.queryByLabelText("Name", { exact: true }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Create account" }));
    expect(
      screen.getByRole("link", { name: "Privacy Policy" }),
    ).toHaveAttribute("href", "/privacy");
    expect(
      screen.getByText(/Creating an account is optional/),
    ).toHaveTextContent(
      "You need an account to sync preferences and receive movie alerts.",
    );
    const nameField = screen.getByLabelText("Name", { exact: true });
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    await user.type(screen.getByLabelText("Email address"), "new@example.com");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.type(nameField, "   ");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText("Enter your name.")).toBeInTheDocument();
    expect(authMock.signUp.email).not.toHaveBeenCalled();

    await user.clear(nameField);
    await user.type(nameField, "  Maya Cohen  ");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() =>
      expect(authMock.signUp.email).toHaveBeenCalledWith({
        email: "new@example.com",
        password: "secret123",
        signupLocation: "Haifa",
        name: "Maya Cohen",
        callbackURL: new URL("/?verified=1", window.location.origin).href,
      }));
    expect(
      screen.getByText(
        "Check your email to confirm your account, then log in.",
      ),
    ).toBeInTheDocument();
  });

  it("requests password resets without requiring a password or revealing account existence", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole("button", { name: "Sign up or log in" }));
    await user.click(screen.getByRole("button", { name: "Forgot password?" }));
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(
      screen.getByText(/uses the email address you enter/),
    ).toHaveTextContent("to send a password reset link");
    expect(
      screen.getByRole("link", { name: "Privacy Policy" }),
    ).toHaveAttribute("href", "/privacy");

    await user.type(
      screen.getByLabelText("Email address"),
      " USER@Example.COM ",
    );
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    await waitFor(() =>
      expect(authMock.requestPasswordReset).toHaveBeenCalledWith({
        email: "user@example.com",
        redirectTo: `${window.location.origin}/reset-password`,
      }));
    expect(
      screen.getByText(
        "If an account exists for that email, you’ll receive a reset link.",
      ),
    ).toBeInTheDocument();
  });

  it("routes authenticated users to preferences and keeps the panel on sign-out errors", async () => {
    const user = userEvent.setup();
    useUserPreferencesStore.setState({
      user: { id: "user-a", email: "user@example.com" } as never,
    });
    authMock.signOut.mockResolvedValue({
      error: { message: "Session expired" },
    });
    renderMenu();

    await user.click(
      screen.getByRole("button", { name: "Signed in as user@example.com" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Open User Preferences" }),
    );
    expect(screen.getByTestId("path")).toHaveTextContent("/user");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Signed in as user@example.com" }),
    );
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByText("Session expired")).toBeInTheDocument();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("shows only configured providers and starts Apple sign-in with a safe return URL", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: { providers: ["apple"] }, error: null }),
      })),
    );
    renderMenu();

    await user.click(screen.getByRole("button", { name: "Sign up or log in" }));
    const appleButton = await screen.findByRole("button", {
      name: "Continue with Apple",
    });
    expect(
      screen.queryByRole("button", { name: "Continue with Google" }),
    ).not.toBeInTheDocument();
    await user.click(appleButton);

    await waitFor(() =>
      expect(authMock.signIn.social).toHaveBeenCalledWith({
        provider: "apple",
        callbackURL: `${window.location.origin}/`,
        errorCallbackURL: `${window.location.origin}/?authError=1`,
      }));
  });
});
