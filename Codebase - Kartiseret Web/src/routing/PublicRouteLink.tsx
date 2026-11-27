import { resolvePublicPathForLegacyPath } from "../data/publicRoutes";
import { usePublicRoutePaths } from "./PublicRoutePathsContext";
import { Link, type LinkProps } from "react-router";
import { useEffect, useState } from "react";

type PublicRouteLinkProps = Omit<LinkProps, "to"> & {
  to: string;
};

function splitHash(path: string): { path: string; hash: string } {
  const hashIndex = path.indexOf("#");
  return hashIndex < 0
    ? { path, hash: "" }
    : { path: path.slice(0, hashIndex), hash: path.slice(hashIndex) };
}

export function PublicRouteLink({
  to,
  children,
  className,
  ...props
}: PublicRouteLinkProps) {
  const paths = usePublicRoutePaths();
  const { path: legacyPath, hash } = splitHash(to);
  const candidatePath = paths[legacyPath];
  const mappedPath =
    candidatePath && /^\/[a-z0-9]{8}$/.test(candidatePath)
      ? candidatePath
      : null;
  const [resolution, setResolution] = useState<{
    sourcePath: string;
    status: "pending" | "ready" | "error";
    path: string | null;
  }>({ sourcePath: legacyPath, status: "pending", path: null });

  useEffect(() => {
    if (mappedPath) return;

    if (typeof window === "undefined") return;
    let active = true;
    void resolvePublicPathForLegacyPath(legacyPath)
      .then((path) => {
        if (active)
          setResolution({ sourcePath: legacyPath, status: "ready", path });
      })
      .catch(() => {
        if (active)
          setResolution({
            sourcePath: legacyPath,
            status: "error",
            path: null,
          });
      });

    return () => {
      active = false;
    };
  }, [legacyPath, mappedPath]);

  const currentResolution =
    resolution.sourcePath === legacyPath ? resolution : null;
  const opaquePath = mappedPath ?? currentResolution?.path ?? null;

  if (opaquePath) {
    return (
      <Link className={className} to={`${opaquePath}${hash}`} {...props}>
        {children}
      </Link>
    );
  }

  return (
    <span
      className={className}
      aria-disabled="true"
      data-public-route-pending={
        !currentResolution || currentResolution.status === "pending"
          ? "true"
          : undefined
      }
      data-public-route-unavailable={
        currentResolution?.status === "error" ? "true" : undefined
      }
    >
      {children}
    </span>
  );
}
