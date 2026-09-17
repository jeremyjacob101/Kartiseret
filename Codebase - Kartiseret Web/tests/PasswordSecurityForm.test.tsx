import { PasswordSecurityForm } from "../src/components/PasswordSecurityForm";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: {
    auth: {
      updateUser: vi.fn(),
    },
  },
}));

vi.mock("../src/lib/supabase", () => ({
  getSupabaseBrowserClient: vi.fn(() => supabaseMock),
}));

beforeEach(() => {
  vi.clearAllMocks();
  supabaseMock.auth.updateUser.mockResolvedValue({ error: null });
});

describe("PasswordSecurityForm", () => {
  it("validates matching password fields before calling Supabase", async () => {
    const user = userEvent.setup();
    render(<PasswordSecurityForm />);

    await user.type(screen.getByLabelText("New password"), "secret123");
    await user.type(
      screen.getByLabelText("Confirm new password"),
      "different123",
    );
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Passwords do not match.",
    );
    expect(supabaseMock.auth.updateUser).not.toHaveBeenCalled();
  });

  it("updates a password without sending the current password in recovery mode", async () => {
    const user = userEvent.setup();
    render(<PasswordSecurityForm />);

    await user.type(screen.getByLabelText("New password"), "secret123");
    await user.type(screen.getByLabelText("Confirm new password"), "secret123");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() =>
      expect(supabaseMock.auth.updateUser).toHaveBeenCalledWith({
        password: "secret123",
      }));
    expect(screen.getByRole("status")).toHaveTextContent("Password updated.");
  });

  it("requires and sends the current password for an authenticated change", async () => {
    const user = userEvent.setup();
    render(
      <PasswordSecurityForm
        requireCurrentPassword
        submitLabel="Change password"
      />,
    );

    await user.type(screen.getByLabelText("Current password"), "oldpass");
    await user.type(screen.getByLabelText("New password"), "secret123");
    await user.type(screen.getByLabelText("Confirm new password"), "secret123");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() =>
      expect(supabaseMock.auth.updateUser).toHaveBeenCalledWith({
        current_password: "oldpass",
        password: "secret123",
      }));
  });
});
