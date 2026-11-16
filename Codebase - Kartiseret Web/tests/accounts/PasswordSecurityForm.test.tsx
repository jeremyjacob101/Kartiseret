import { PasswordSecurityForm } from "../../src/components/PasswordSecurityForm";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

const { authMock } = vi.hoisted(() => ({
  authMock: {
    resetPassword: vi.fn(),
    changePassword: vi.fn(),
    requestPasswordReset: vi.fn(),
  },
}));

vi.mock("../../src/lib/authClient", () => ({
  getAuthClient: vi.fn(() => authMock),
}));

beforeEach(() => {
  vi.clearAllMocks();
  authMock.resetPassword.mockResolvedValue({ error: null });
  authMock.changePassword.mockResolvedValue({ error: null });
  authMock.requestPasswordReset.mockResolvedValue({ error: null });
});

describe("PasswordSecurityForm", () => {
  it("validates matching password fields before requesting a reset", async () => {
    const user = userEvent.setup();
    render(
      <PasswordSecurityForm
        resetToken="reset-token"
        requireCurrentPassword={false}
      />,
    );

    await user.type(screen.getByLabelText("New password"), "secret123");
    await user.type(
      screen.getByLabelText("Confirm new password"),
      "different123",
    );
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Passwords do not match.",
    );
    expect(authMock.resetPassword).not.toHaveBeenCalled();
  });

  it("updates a password without sending the current password in recovery mode", async () => {
    const user = userEvent.setup();
    render(
      <PasswordSecurityForm
        resetToken="reset-token"
        requireCurrentPassword={false}
      />,
    );

    await user.type(screen.getByLabelText("New password"), "secret123");
    await user.type(screen.getByLabelText("Confirm new password"), "secret123");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() =>
      expect(authMock.resetPassword).toHaveBeenCalledWith({
        newPassword: "secret123",
        token: "reset-token",
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
      expect(authMock.changePassword).toHaveBeenCalledWith({
        currentPassword: "oldpass",
        newPassword: "secret123",
        revokeOtherSessions: true,
      }));
  });

  it("lets a social-only user request a password setup link by email", async () => {
    const user = userEvent.setup();
    render(
      <PasswordSecurityForm
        setupEmail="social@example.com"
        requireCurrentPassword={false}
        submitLabel="Email me a setup link"
        title="Add a password"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Email me a setup link" }),
    );
    await waitFor(() =>
      expect(authMock.requestPasswordReset).toHaveBeenCalledWith({
        email: "social@example.com",
        redirectTo: `${window.location.origin}/reset-password`,
      }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "a secure setup link is on its way",
    );
    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
  });
});
