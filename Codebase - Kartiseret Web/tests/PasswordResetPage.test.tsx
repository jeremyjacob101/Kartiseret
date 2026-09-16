import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PasswordResetPage } from "../src/components/PasswordResetPage";

const { supabaseMock, storeState } = vi.hoisted(() => ({
  supabaseMock: {
    auth: {
      updateUser: vi.fn(),
    },
  },
  storeState: {
    user: null as unknown,
    loading: false,
  },
}));

vi.mock("../src/lib/supabase", () => ({
  getSupabaseBrowserClient: vi.fn(() => supabaseMock),
}));

vi.mock("../src/stores/userPreferencesStore", () => ({
  useUserPreferencesStore: (selector: (state: typeof storeState) => unknown) =>
    selector(storeState),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <PasswordResetPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseMock.auth.updateUser.mockResolvedValue({ error: null });
  storeState.user = null;
  storeState.loading = false;
});

describe("PasswordResetPage", () => {
  it("does not expose a password form without an authenticated recovery session", () => {
    renderPage();

    expect(
      screen.getByRole("heading", {
        name: "This reset link is invalid or expired",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  it("allows an authenticated recovery session to set a new password", async () => {
    const user = userEvent.setup();
    storeState.user = { id: "user-a", email: "user@example.com" };
    renderPage();

    await user.type(screen.getByLabelText("New password"), "secret123");
    await user.type(screen.getByLabelText("Confirm new password"), "secret123");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() =>
      expect(supabaseMock.auth.updateUser).toHaveBeenCalledWith({
        password: "secret123",
      }));
    expect(
      screen.getByText("Password updated. You can now return to Kartiseret."),
    ).toBeInTheDocument();
  });

  it("does not wait for preference synchronization once Auth has a user", () => {
    storeState.user = { id: "user-a", email: "user@example.com" };
    storeState.loading = true;
    renderPage();

    expect(screen.getByLabelText("New password")).toBeInTheDocument();
    expect(
      screen.queryByText("Checking your reset link..."),
    ).not.toBeInTheDocument();
  });
});
