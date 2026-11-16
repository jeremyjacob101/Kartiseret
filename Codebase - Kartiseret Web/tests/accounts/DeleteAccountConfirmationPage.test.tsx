import { DeleteAccountConfirmationPage } from "../../src/components/DeleteAccountConfirmationPage";
import { useUserPreferencesStore } from "../../src/stores/userPreferencesStore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import userEvent from "@testing-library/user-event";

function CurrentPath() {
  const location = useLocation();
  return (
    <output aria-label="Current path">
      {location.pathname + location.search}
    </output>
  );
}

beforeEach(() => {
  useUserPreferencesStore.setState({
    user: { id: "user-a", email: "user@example.com" } as never,
    loading: false,
    error: null,
  });
});

afterEach(() => {
  useUserPreferencesStore.setState({ user: null, loading: true });
  vi.unstubAllGlobals();
});

describe("DeleteAccountConfirmationPage", () => {
  it("does not delete until the signed-in user presses the final confirmation", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        ({
          ok: true,
          redirected: true,
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MemoryRouter
        initialEntries={[
          "/confirm-account-deletion#token=delete-confirm-token",
        ]}
      >
        <DeleteAccountConfirmationPage />
        <CurrentPath />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(/Opening this page did not delete anything/),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Confirm and delete account" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const requestedUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestedUrl.pathname).toBe("/api/auth/delete-user/callback");
    expect(requestedUrl.searchParams.get("token")).toBe("delete-confirm-token");
    expect(requestedUrl.searchParams.get("callbackURL")).toBe(
      `${window.location.origin}/?accountDeleted=1`,
    );
    expect(await screen.findByLabelText("Current path")).toHaveTextContent(
      "/?accountDeleted=1",
    );
  });
});
