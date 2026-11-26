import { describe, expect, it, vi } from "vitest";
import type {
  ApplicationDatabase,
  ApplicationTransaction,
} from "../db/client.js";
import type { PublicDataRepository } from "../public-data/repository.js";
import { ProtectedWorkflows } from "./service.js";

const user = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "qa@example.test",
};
const click = {
  tmdbId: "123",
  title: "Input Movie",
  city: "Jerusalem",
  cinema: "Test Cinema",
  screeningDate: "2026-12-01",
  screeningTime: "19:30",
};

function setup(candidates: object[]) {
  const selectQuery = {
    from: vi.fn(() => selectQuery),
    where: vi.fn(() => selectQuery),
    orderBy: vi.fn(() => selectQuery),
    limit: vi.fn(async () => candidates),
  };
  const insertQuery = {
    values: vi.fn(() => insertQuery),
    onConflictDoUpdate: vi.fn(() => insertQuery),
    returning: vi.fn(async () => [
      {
        tmdbId: 123n,
        title: "Matched Movie",
        city: "Jerusalem",
        cinema: "Test Cinema",
        screeningDate: "2026-12-01",
        screeningTime: "19:30:00",
      },
    ]),
  };
  const deleteQuery = { where: vi.fn(async () => []) };
  const transaction = {
    execute: vi.fn(async () => undefined),
    select: vi.fn(() => selectQuery),
    delete: vi.fn(() => deleteQuery),
    insert: vi.fn(() => insertQuery),
  } as unknown as ApplicationTransaction;
  const db = {
    transaction: (work: (tx: ApplicationTransaction) => Promise<unknown>) =>
      work(transaction),
  } as unknown as ApplicationDatabase;
  const workflows = new ProtectedWorkflows(
    db,
    {} as PublicDataRepository,
    () => new Date("2026-11-26T12:00:00.000Z"),
  );
  return { workflows, transaction, insertQuery };
}

describe("wallet showtime click persistence", () => {
  it("preserves the prior suggestion when a click no longer matches a showtime", async () => {
    const { workflows, transaction } = setup([]);

    const result = await workflows.recordWalletShowtimeClick(user, click);

    expect(result).toBeNull();
    expect(transaction.delete).not.toHaveBeenCalled();
    expect(transaction.insert).not.toHaveBeenCalled();
  });

  it("atomically replaces the suggestion and matches the clicked minute", async () => {
    const { workflows, transaction, insertQuery } = setup([
      {
        tmdbId: 123,
        englishTitle: "  Matched Movie  ",
        dateOfShowing: "2026-12-01",
        showtime: "19:30:00.250000",
        screeningCity: "Jerusalem",
        cinema: "Test Cinema",
        createdAt: new Date("2026-11-26T11:00:00.000Z"),
      },
    ]);

    const result = await workflows.recordWalletShowtimeClick(user, click);

    expect(result).toEqual({ ...click, title: "Matched Movie" });
    expect(transaction.delete).not.toHaveBeenCalled();
    expect(insertQuery.onConflictDoUpdate).toHaveBeenCalledOnce();
    expect(insertQuery.values).toHaveBeenCalledWith(
      expect.objectContaining({
        tmdbId: 123n,
        title: "Matched Movie",
        screeningTime: "19:30",
      }),
    );
  });
});
