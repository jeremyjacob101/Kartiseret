import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveGuestLocation } from "../src/prefs/definitions/locations";
import { useUserPreferencesStore } from "../src/stores/userPreferencesStore";
import { UserMenu } from "../src/components/UserMenu";

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: {
    auth: {
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

vi.mock("../src/lib/supabase", () => ({
  getSupabaseBrowserClient: vi.fn(() => supabaseMock),
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
  supabaseMock.auth.signInWithPassword.mockResolvedValue({ error: null });
  supabaseMock.auth.signUp.mockResolvedValue({
    data: { session: null, user: null },
    error: null,
  });
  supabaseMock.auth.signOut.mockResolvedValue({ error: null });
  useUserPreferencesStore.setState({
    user: null,
    loading: false,
    error: null,
  });
});

afterEach(() => {
  useUserPreferencesStore.setState({ user: null, loading: true });
});

describe("UserMenu", () => {
  it("opens, closes on escape/outside input, and reports empty credentials", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole("button", { name: "Sign up or log in" }));
    expect(
      screen.getByRole("menu", { name: "User account menu" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sign up or log in" }));
    const form = document.querySelector("form.user-menu-auth-form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    expect(
      screen.getByText("Enter both email and password."),
    ).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("normalizes login credentials and surfaces authentication failures", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: "Sign up or log in" }));
    await user.type(screen.getByLabelText("Email"), "  USER@Example.COM ");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() =>
      expect(supabaseMock.auth.signInWithPassword).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "secret123",
      }));
    expect(screen.getByText("Signed in.")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveValue("");

    supabaseMock.auth.signInWithPassword.mockResolvedValueOnce({
      error: { message: "Invalid credentials" },
    });
    await user.type(screen.getByLabelText("Password"), "wrongpass");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByText("Invalid credentials")).toBeInTheDocument();
  });

  it("sends the guest location as signup metadata and supports the mode toggle", async () => {
    const user = userEvent.setup();
    saveGuestLocation("Haifa");
    renderMenu();
    await user.click(screen.getByRole("button", { name: "Sign up or log in" }));
    await user.click(screen.getByRole("tab", { name: "Sign up" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() =>
      expect(supabaseMock.auth.signUp).toHaveBeenCalledWith({
        email: "new@example.com",
        password: "secret123",
        options: { data: { signup_location: "Haifa" } },
      }));
    expect(
      screen.getByText(
        "Account created. Check your email to confirm, then log in.",
      ),
    ).toBeInTheDocument();
  });

  it("routes authenticated users to preferences and keeps the panel on sign-out errors", async () => {
    const user = userEvent.setup();
    useUserPreferencesStore.setState({
      user: { id: "user-a", email: "user@example.com" } as never,
    });
    supabaseMock.auth.signOut.mockResolvedValue({
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
});
