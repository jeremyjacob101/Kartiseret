import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { UserTicketPasses } from "../../src/components/UserTicketPasses";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const ticketFixtures = vi.hoisted(() => {
  const first = {
    id: "00000000-0000-4000-8000-000000000011",
    tmdbId: null,
    title: "First Movie",
    city: "Jerusalem",
    cinema: "First Cinema",
    screeningDate: "2026-12-01",
    screeningTime: "19:30",
    reminderEnabled: false,
    createdAt: "2026-11-26T10:00:00.000Z",
    updatedAt: "2026-11-26T10:00:00.000Z",
  };
  const second = {
    ...first,
    id: "00000000-0000-4000-8000-000000000012",
    title: "Second Movie",
    cinema: "Second Cinema",
  };
  return {
    tickets: [first, second],
    details: {
      [first.id]: { ...first, qrMessage: "first-secret-qr" },
      [second.id]: { ...second, qrMessage: "second-secret-qr" },
    },
    create: vi.fn(),
  };
});

vi.mock("../../src/data/walletTickets", async () => {
  const { mutationOptions, queryOptions } =
    await import("@tanstack/react-query");
  return {
    walletTicketsQueryOptions: (userId: string | null) =>
      queryOptions({
        queryKey: ["walletTickets", "list", userId],
        queryFn: async () => ticketFixtures.tickets,
      }),
    walletTicketDetailQueryOptions: (
      userId: string | null,
      ticketId: string | null,
    ) =>
      queryOptions({
        queryKey: ["walletTickets", "detail", userId, ticketId],
        queryFn: async () =>
          ticketId
            ? ticketFixtures.details[ticketId]
            : ticketFixtures.details[ticketFixtures.tickets[0]!.id],
      }),
    walletRecentScreeningQueryOptions: (userId: string | null) =>
      queryOptions({
        queryKey: ["walletTickets", "recent", userId],
        queryFn: async () => null,
      }),
    createWalletTicketMutationOptions: () =>
      mutationOptions({
        mutationFn: async (input: unknown) => {
          ticketFixtures.create(input);
          return ticketFixtures.details[ticketFixtures.tickets[0]!.id];
        },
      }),
    updateWalletTicketMutationOptions: () =>
      mutationOptions({
        mutationFn: async ({ ticketId }: { ticketId: string }) =>
          ticketFixtures.details[ticketId],
      }),
    deleteWalletTicketMutationOptions: () =>
      mutationOptions({ mutationFn: async () => ({ removed: true as const }) }),
  };
});

describe("UserTicketPasses", () => {
  it("clears an edit draft when a different ticket is selected", async () => {
    const user = userEvent.setup();
    ticketFixtures.create.mockClear();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <UserTicketPasses userId="00000000-0000-4000-8000-000000000099" />
      </QueryClientProvider>,
    );

    const list = await screen.findByRole("list");
    await user.click(within(list).getByRole("button", { name: /First Movie/ }));
    await user.click(
      await screen.findByRole("button", { name: "Edit ticket" }),
    );
    expect(
      screen.getByRole("heading", { name: "Update ticket details" }),
    ).toBeInTheDocument();

    await user.click(
      within(list).getByRole("button", { name: /Second Movie/ }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Import a ticket screenshot" }),
      ).toBeInTheDocument());
    expect(screen.getByLabelText("Movie or show")).toHaveValue("");
    expect(screen.queryByText(/QR code ready/)).not.toBeInTheDocument();
    expect(
      await screen.findByRole("img", { name: "QR code for Second Movie" }),
    ).toHaveAttribute(
      "src",
      `/api/v1/ticket-passes/${ticketFixtures.tickets[1]!.id}/qr.svg`,
    );

    await user.click(
      screen.getByRole("button", { name: "Save to My Tickets" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose a ticket screenshot and read its QR code first.",
    );
    expect(ticketFixtures.create).not.toHaveBeenCalled();
  });
});
