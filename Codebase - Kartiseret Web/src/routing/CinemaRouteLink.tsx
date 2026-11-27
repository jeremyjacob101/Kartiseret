import { usePublicRoutePaths } from "./PublicRoutePathsContext";
import { requestApiResponse } from "../data/apiClient.js";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { z } from "zod";

const cinemaRouteResponseSchema = z.object({
  data: z.object({ path: z.string().regex(/^\/[a-z0-9]{8}$/) }),
  error: z.null(),
});

export function CinemaRouteLink({
  cinemaId,
  className,
  children,
}: {
  cinemaId: string;
  className?: string;
  children: ReactNode;
}) {
  const routePaths = usePublicRoutePaths();
  const candidatePath = routePaths[`/__cinema/${cinemaId}`];
  const routePath =
    candidatePath && /^\/[a-z0-9]{8}$/.test(candidatePath)
      ? candidatePath
      : null;
  const routeQuery = useQuery({
    queryKey: ["public-route", "cinema", cinemaId],
    queryFn: async () => {
      const response = await requestApiResponse(
        `/api/v1/public-routes/cinema/${encodeURIComponent(cinemaId)}`,
        cinemaRouteResponseSchema,
        { method: "GET" },
      );
      return response.data.path;
    },
    staleTime: 5 * 60_000,
    gcTime: 60 * 60_000,
    enabled: !routePath,
    retry: false,
  });
  const href = routePath ?? routeQuery.data;

  return href ? (
    <Link className={className} to={href}>
      {children}
    </Link>
  ) : (
    <span className={className}>{children}</span>
  );
}
