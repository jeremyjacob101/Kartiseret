import { PasswordResetPage } from "../src/components/PasswordResetPage";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

const { resetPassword } = vi.hoisted(() => ({ resetPassword: vi.fn() }));
vi.mock("../src/lib/authClient", () => ({
  getAuthClient: () => ({ resetPassword }),
}));
function renderPage(path = "/reset-password") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PasswordResetPage />
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  resetPassword.mockResolvedValue({ error: null });
});
describe("token-based password recovery", () => {
  it.each(["/reset-password", "/reset-password?error=INVALID_TOKEN"])(
    "rejects missing/expired reset links without consulting an existing session",
    (path) => {
      renderPage(path);
      expect(
        screen.getByRole("heading", {
          name: "This reset link is invalid or expired",
        }),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    },
  );
  it("uses the reset token while signed out and surfaces a consumed-token error", async () => {
    resetPassword.mockResolvedValue({
      error: { message: "Invalid or expired token" },
    });
    const user = userEvent.setup();
    renderPage("/reset-password?token=single-use-reset");
    await user.type(screen.getByLabelText("New password"), "new-secret123");
    await user.type(
      screen.getByLabelText("Confirm new password"),
      "new-secret123",
    );
    await user.click(screen.getByRole("button", { name: "Update password" }));
    await waitFor(() =>
      expect(resetPassword).toHaveBeenCalledWith({
        token: "single-use-reset",
        newPassword: "new-secret123",
      }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Invalid or expired token",
    );
  });
});
