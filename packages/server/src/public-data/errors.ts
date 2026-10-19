export type PublicDataIntegrityKind =
  "orphaned_theater" | "invalid_city_metadata" | "invalid_theater_metadata";

export class PublicDataIntegrityError extends Error {
  constructor(
    readonly kind: PublicDataIntegrityKind,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PublicDataIntegrityError";
  }
}
