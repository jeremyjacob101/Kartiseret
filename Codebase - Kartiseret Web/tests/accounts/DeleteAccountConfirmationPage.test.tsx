import { DeleteAccountConfirmationPage } from "../../src/components/DeleteAccountConfirmationPage";
import { useUserPreferencesStore } from "../../src/stores/userPreferencesStore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import userEvent from "@testing-library/user-event";

const { deleteUser } = vi.hoisted(() => ({ deleteUser: vi.fn() }));
vi.mock("../../src/lib/authClient", () => ({
  getAuthClient: () => ({ deleteUser }),
}));

function CurrentPath() {
  const location = useLocation();
  return (
    <output aria-label="Current path">
      {location.pathname + location.search}
    </output>
  );
}

beforeEach(() => {
  deleteUser.mockReset();
  deleteUser.mockResolvedValue({ data: { success: true }, error: null });
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
    expect(deleteUser).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Confirm and delete account" }),
    );

    await waitFor(() =>
      expect(deleteUser).toHaveBeenCalledExactlyOnceWith({
        token: "delete-confirm-token",
        fetchOptions: { onSuccess: expect.any(Function) },
      }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByLabelText("Current path")).toHaveTextContent(
      "/?accountDeleted=1",
    );
  });

  it("shows Apple settings instructions after deleting a legacy account", async () => {
    deleteUser.mockImplementationOnce(async ({ fetchOptions }) => {
      fetchOptions.onSuccess({
        response: new Response(null, {
          headers: { "x-kartiseret-apple-revocation": "manual" },
        }),
      });
      return { data: { success: true }, error: null };
    });
    render(
      <MemoryRouter initialEntries={["/confirm-account-deletion#token=legacy"]}>
        <DeleteAccountConfirmationPage />
      </MemoryRouter>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm and delete account" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      /account has been deleted.*Sign in with Apple/,
    );
    expect(screen.getByRole("link", { name: "Done" })).toHaveAttribute(
      "href",
      "/?accountDeleted=1",
    );
  });
});
