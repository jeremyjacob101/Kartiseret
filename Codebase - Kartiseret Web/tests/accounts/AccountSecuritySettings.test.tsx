import { AccountSecuritySettings } from "../../src/components/AccountSecuritySettings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

const { authMock } = vi.hoisted(() => ({
  authMock: {
    listAccounts: vi.fn(),
    linkSocial: vi.fn(),
    unlinkAccount: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    changePassword: vi.fn(),
  },
}));

vi.mock("../../src/lib/authClient", () => ({
  getAuthClient: vi.fn(() => authMock),
}));

function renderSettings() {
  return render(
    <MemoryRouter initialEntries={["/user"]}>
      <AccountSecuritySettings email="social@example.com" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.listAccounts.mockResolvedValue({
    data: [{ id: "google-account", providerId: "google" }],
    error: null,
  });
  authMock.linkSocial.mockResolvedValue({ error: null });
  authMock.unlinkAccount.mockResolvedValue({ error: null });
  authMock.requestPasswordReset.mockResolvedValue({ error: null });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: { providers: ["google", "apple"] },
        error: null,
      }),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AccountSecuritySettings", () => {
  it("connects providers and keeps the last sign-in method attached", async () => {
    const user = userEvent.setup();
    authMock.unlinkAccount.mockResolvedValueOnce({
      error: { code: "FAILED_TO_UNLINK_LAST_ACCOUNT" },
    });
    renderSettings();

    await screen.findByText("Connected");
    await user.click(screen.getByRole("button", { name: "Connect Apple" }));
    await waitFor(() =>
      expect(authMock.linkSocial).toHaveBeenCalledWith({
        provider: "apple",
        callbackURL: `${window.location.origin}/user?linked=1`,
        errorCallbackURL: `${window.location.origin}/user?linkError=1`,
      }));

    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Connect another sign-in method before disconnecting this one.",
    );
    expect(authMock.unlinkAccount).toHaveBeenCalledWith({
      accountId: "google-account",
    });
    expect(
      screen.getByRole("button", { name: "Email me a setup link" }),
    ).toBeInTheDocument();
  });
});
