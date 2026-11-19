const deliveryProfiles = {
  development: {
    origin: "https://img-dev.seret.site",
    bucket: "kartiseret-artwork-dev",
  },
  production: {
    origin: "https://img.seret.site",
    bucket: "kartiseret-artwork-prod",
  },
} as const;

export const artworkWidths = {
  poster: [185, 342, 780],
  backdrop: [780, 1280],
} satisfies Record<string, readonly number[]>;

export function resolveArtworkDeliveryOrigin(environment: NodeJS.ProcessEnv) {
  const target =
    environment.VERCEL_ENV === "preview"
      ? "development"
      : (environment.VERCEL_ENV ??
        environment.KARTISERET_TARGET ??
        "development");
  if (target !== "development" && target !== "production") return;
  const profile = deliveryProfiles[target];
  const bucket =
    environment.R2_BUCKET ??
    (target === "production"
      ? environment.PROD_R2_BUCKET
      : environment.DEV_R2_BUCKET);
  if (bucket && bucket !== profile.bucket) return;
  if (environment.ARTWORK_DELIVERY_ORIGIN === profile.origin)
    return profile.origin;
}

export function isKartiseretArtworkOrigin(origin: string | undefined): boolean {
  return (
    !origin ||
    origin === "https://seret.site" ||
    origin === "https://www.seret.site" ||
    origin === "https://kartiseret.vercel.app" ||
    origin === "https://kartiseret-dev.vercel.app" ||
    /^https:\/\/kartiseret-[a-z0-9-]+-jeremyjacob-projects\.vercel\.app$/.test(
      origin,
    )
  );
}
