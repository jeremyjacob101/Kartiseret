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

function renderSettings(path = "/user") {
  return render(
    <MemoryRouter initialEntries={[path]}>
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
  it("asks the user to sign in again when their session is too old to link Apple", async () => {
    const user = userEvent.setup();
    authMock.linkSocial.mockResolvedValueOnce({
      error: { code: "SESSION_NOT_FRESH" },
    });
    renderSettings();
    await user.click(
      await screen.findByRole("button", { name: "Connect Apple" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sign out and sign back in before changing your sign-in methods.",
    );
  });

  it("explains when the provider is already linked to another account", async () => {
    renderSettings(
      "/user?linkError=1&error=account_already_linked_to_different_user",
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This sign-in method is already connected to another Kartiseret account.",
    );
  });

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
