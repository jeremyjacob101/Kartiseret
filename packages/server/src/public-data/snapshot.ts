import type { CatalogRepository } from "../catalog/service.js";
import { HttpError } from "../http-errors.js";

type SnapshotReader = {
  readSnapshot<T>(
    read: (revision: string) => Promise<T>,
    expected?: string,
  ): Promise<T>;
};

/** Immutable fixture repositories have one revision; database repositories must
 * supply a real repeatable-read snapshot. No live schema fallback is provided. */
export function withPublicationSnapshot<T>(
  repository: CatalogRepository,
  read: (revision: string) => Promise<T>,
  expected?: string,
): Promise<T> {
  if (expected !== undefined && !/^(0|[1-9][0-9]{0,18})$/.test(expected))
    throw new HttpError(
      400,
      "invalid_request",
      "The publication revision is invalid.",
    );
  if (
    "readSnapshot" in repository &&
    typeof repository.readSnapshot === "function"
  )
    return (repository as CatalogRepository & SnapshotReader).readSnapshot(
      read,
      expected,
    );
  if (expected !== undefined && expected !== "0")
    throw new HttpError(
      409,
      "publication_changed",
      "Published data changed. Reload the catalog.",
    );
  return read("0");
}
