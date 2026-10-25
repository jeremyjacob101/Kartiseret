import { DeleteAccountSection } from "../src/components/DeleteAccountSection";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router";
import userEvent from "@testing-library/user-event";

const { authMock } = vi.hoisted(() => ({
  authMock: { deleteUser: vi.fn() },
}));

vi.mock("../src/lib/authClient", () => ({
  getAuthClient: vi.fn(() => authMock),
}));

function CurrentPath() {
  return <output aria-label="Current path">{useLocation().pathname}</output>;
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.deleteUser.mockResolvedValue({ error: null });
});

describe("DeleteAccountSection", () => {
  it("requires the exact confirmation phrase and current password", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/preferences"]}>
        <DeleteAccountSection />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Delete account" }));
    const submit = screen.getByRole("button", {
      name: "Permanently delete account",
    });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText("Type DELETE to confirm"), "delete");
    await user.type(screen.getByLabelText("Current password"), "secret123");
    expect(submit).toBeDisabled();
    expect(authMock.deleteUser).not.toHaveBeenCalled();
  });

  it("submits with the password, reports errors, and returns home after success", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/preferences"]}>
        <DeleteAccountSection />
        <CurrentPath />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Delete account" }));
    await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await user.type(screen.getByLabelText("Current password"), "secret123");
    authMock.deleteUser.mockResolvedValueOnce({
      error: { message: "The password is incorrect." },
    });
    await user.click(
      screen.getByRole("button", { name: "Permanently delete account" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The password is incorrect.",
    );
    expect(authMock.deleteUser).toHaveBeenLastCalledWith({
      password: "secret123",
    });

    await user.type(screen.getByLabelText("Current password"), "secret123");
    await user.click(
      screen.getByRole("button", { name: "Permanently delete account" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Current path")).toHaveTextContent("/"));
    expect(authMock.deleteUser).toHaveBeenLastCalledWith({
      password: "secret123",
    });
  });
});
