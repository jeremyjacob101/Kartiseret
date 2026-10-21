import { queryClient } from "../lib/queryClient.js";
import { ApiRequestError } from "./apiClient.js";

const revisions = new WeakMap<object, string>();

export function tagPublication<T extends object>(
  value: T,
  revision: string,
): T {
  revisions.set(value, revision);
  return value;
}
export function publicationOf(value: object): string | undefined {
  return revisions.get(value);
}
export function currentPublicationRevision(): string | undefined {
  return queryClient.getQueryData<{ publicationRevision?: string }>([
    "movieCatalog",
    "collections",
    "nowPlaying",
  ])?.publicationRevision;
}
export function assertPublication(
  value: object,
  expected = currentPublicationRevision(),
): void {
  const revision = publicationOf(value);
  if (revision !== undefined && expected !== undefined && revision !== expected)
    throw new ApiRequestError(
      409,
      "publication_changed",
      "Published data changed. Reload the catalog.",
    );
}
export async function refreshPublicationCollections(): Promise<void> {
  const collections = queryClient
    .getQueryCache()
    .findAll({ queryKey: ["movieCatalog", "collections"] });
  await Promise.all(
    collections.map((query) =>
      queryClient.fetchQuery({
        ...query.options,
        queryKey: query.queryKey,
        staleTime: 0,
      })),
  );
}
