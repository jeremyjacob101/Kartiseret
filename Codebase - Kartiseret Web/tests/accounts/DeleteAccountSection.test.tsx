import { DeleteAccountSection } from "../../src/components/DeleteAccountSection";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { authMock } = vi.hoisted(() => ({
  authMock: { deleteUser: vi.fn() },
}));

vi.mock("../../src/lib/authClient", () => ({
  getAuthClient: vi.fn(() => authMock),
}));

beforeEach(() => {
  vi.clearAllMocks();
  authMock.deleteUser.mockResolvedValue({ error: null });
});

describe("DeleteAccountSection", () => {
  it("requires the exact confirmation phrase before requesting the email", async () => {
    const user = userEvent.setup();
    render(<DeleteAccountSection />);

    await user.click(screen.getByRole("button", { name: "Delete account" }));
    const submit = screen.getByRole("button", {
      name: "Email me a confirmation link",
    });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText("Type DELETE to confirm"), "delete");
    expect(submit).toBeDisabled();
    expect(authMock.deleteUser).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Type DELETE to confirm"));
    await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(authMock.deleteUser).toHaveBeenCalledOnce();
    expect(authMock.deleteUser).toHaveBeenCalledWith();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Check your email for a link to review and confirm deletion.",
    );
  });

  it("explains when a stale session must sign in again before requesting deletion", async () => {
    const user = userEvent.setup();
    authMock.deleteUser.mockResolvedValueOnce({
      error: { code: "SESSION_EXPIRED", message: "Session expired" },
    });
    render(<DeleteAccountSection />);

    await user.click(screen.getByRole("button", { name: "Delete account" }));
    await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await user.click(
      screen.getByRole("button", { name: "Email me a confirmation link" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "sign out and sign back in with your usual method",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "you do not need a Kartiseret password",
    );
  });
});
