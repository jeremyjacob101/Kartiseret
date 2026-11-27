import { movieShowtimeShareStateSchema } from "@kartiseret/contracts/showtime-links";
import { requestApiResponse, getApiResponse } from "./apiClient.js";
import { z } from "zod";

const opaquePathResponseSchema = z.object({
  data: z.object({ path: z.string().regex(/^\/[a-z0-9]{8}$/) }),
  error: z.null(),
});

export type PublicShowtimeShare = z.input<typeof movieShowtimeShareStateSchema>;

export async function createPublicShowtimeSharePath(
  state: PublicShowtimeShare,
): Promise<string> {
  const payload = movieShowtimeShareStateSchema.parse(state);
  const response = await requestApiResponse(
    "/api/v1/public-routes/shares",
    opaquePathResponseSchema,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  return response.data.path;
}

export async function resolvePublicPathForLegacyPath(
  path: string,
): Promise<string> {
  const response = await getApiResponse(
    `/api/v1/public-routes/legacy?path=${encodeURIComponent(path)}`,
    opaquePathResponseSchema,
  );
  return response.data.path;
}

/** Resolve an internal destination without ever falling back to its readable path. */
export async function getOpaquePublicPath(
  path: string,
  knownPaths: Readonly<Record<string, string>> = {},
): Promise<string> {
  const knownPath = knownPaths[path];
  if (knownPath && /^\/[a-z0-9]{8}$/.test(knownPath)) return knownPath;
  return resolvePublicPathForLegacyPath(path);
}
