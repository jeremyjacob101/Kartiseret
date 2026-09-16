export type VercelRequest = {
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
};

export type VercelResponse = {
  status(statusCode: number): VercelResponse;
  setHeader(
    name: string,
    value: string | number | readonly string[],
  ): VercelResponse;
  send(body: unknown): VercelResponse;
};
