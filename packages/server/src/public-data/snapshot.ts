import type { CatalogRepository } from "../catalog/service.js";
import { HttpError } from "../http-errors.js";
import {
  createPublicDataPreparationSnapshot,
  hasPublicDataPreparationSnapshot,
} from "./preparation-cache.js";
import type { PublicDataSnapshotMetadata } from "./repository.js";

type SnapshotReader = {
  readSnapshot<T>(
    read: (
      revision: string,
      metadata: PublicDataSnapshotMetadata,
    ) => Promise<T>,
    expected?: string,
  ): Promise<T>;
};

/** Immutable fixture repositories have one revision; database repositories must
 * supply a real repeatable-read snapshot. No live schema fallback is provided. */
export async function withPublicationSnapshot<T>(
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
  ) {
    const reader = repository as CatalogRepository & SnapshotReader;
    if (hasPublicDataPreparationSnapshot(repository))
      return reader.readSnapshot((revision) => read(revision), expected);

    let preparationSnapshot:
      ReturnType<typeof createPublicDataPreparationSnapshot> | undefined;
    try {
      const result = await reader.readSnapshot((revision, metadata) => {
        preparationSnapshot = createPublicDataPreparationSnapshot(
          repository,
          revision,
          metadata,
        );
        return preparationSnapshot.run(() => read(revision));
      }, expected);
      preparationSnapshot?.commit();
      return result;
    } catch (error) {
      preparationSnapshot?.discard();
      throw error;
    }
  }
  if (expected !== undefined && expected !== "0")
    throw new HttpError(
      409,
      "publication_changed",
      "Published data changed. Reload the catalog.",
    );
  return read("0");
}
