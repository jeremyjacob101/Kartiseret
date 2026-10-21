import { currentPublicationRevision } from "../data/publicationRevision.js";
import { notifyManager } from "@tanstack/react-query";
import { queryClient } from "../lib/queryClient.js";
import { useSyncExternalStore } from "react";

const subscribe = (notify: () => void) => {
  // Match TanStack's scheduled notifications; observer registration can happen
  // during another component's render and must not synchronously update it.
  const changed = notifyManager.batchCalls(notify);
  return queryClient.getQueryCache().subscribe((event) => {
    const key = event.query.queryKey;
    if (
      key[0] === "movieCatalog" &&
      key[1] === "collections" &&
      key[2] === "nowPlaying" &&
      (event.type === "removed" ||
        (event.type === "updated" && event.action.type === "success"))
    )
      changed();
  });
};
const serverSnapshot = () => undefined;

/** Observe the revision even when a catalog's movie fields are unchanged. */
export function usePublicationRevision() {
  return useSyncExternalStore(
    subscribe,
    currentPublicationRevision,
    serverSnapshot,
  );
}
