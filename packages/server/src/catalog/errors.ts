export class CatalogDatabaseError extends Error {
  constructor(cause: unknown) {
    super("The catalog database query failed.", { cause });
    this.name = "CatalogDatabaseError";
  }
}

export class CatalogDataIntegrityError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "CatalogDataIntegrityError";
  }
}
