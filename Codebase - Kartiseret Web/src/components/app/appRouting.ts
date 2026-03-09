export type AppPathname = "/" | "/user";

export function normalizePathname(pathname: string): AppPathname {
  return pathname === "/user" ? "/user" : "/";
}

export function subscribeToPathname(onStoreChange: () => void): () => void {
  window.addEventListener("popstate", onStoreChange);
  window.addEventListener("app:navigate", onStoreChange as EventListener);

  return () => {
    window.removeEventListener("popstate", onStoreChange);
    window.removeEventListener("app:navigate", onStoreChange as EventListener);
  };
}

export function getPathnameSnapshot(): AppPathname {
  return normalizePathname(window.location.pathname);
}

export function navigateToPath(path: string, replace = false): void {
  const targetPath = normalizePathname(path);

  if (window.location.pathname === targetPath) {
    return;
  }

  if (replace) {
    window.history.replaceState({}, "", targetPath);
  } else {
    window.history.pushState({}, "", targetPath);
  }

  window.dispatchEvent(new Event("app:navigate"));
}
