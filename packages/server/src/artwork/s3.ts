import { createHash, createHmac } from "node:crypto";

const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const hmac = (key: Uint8Array | string, value: string) =>
  createHmac("sha256", key).update(value).digest();

export interface R2ImageStore {
  getObject(key: string): Promise<Response>;
}

export function createR2ImageStore(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): R2ImageStore | null {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const bucket = env.R2_BUCKET?.trim();
  const accessKeyId = env.R2_READ_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_READ_SECRET_ACCESS_KEY?.trim();
  if (![accountId, bucket, accessKeyId, secretAccessKey].some(Boolean))
    return null;
  if (![accountId, bucket, accessKeyId, secretAccessKey].every(Boolean))
    throw new Error("R2 image storage configuration is incomplete");
  if (!/^[a-fA-F0-9]{32}$/.test(accountId!))
    throw new Error("R2 account ID is invalid");
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(bucket!))
    throw new Error("R2 bucket name is invalid");

  const host = `${accountId}.r2.cloudflarestorage.com`;
  const endpoint = `https://${host}`;
  return {
    async getObject(key) {
      const path = `/${encodeURIComponent(bucket!)}/${key
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`;
      const now = new Date();
      const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
      const date = amzDate.slice(0, 8);
      const scope = `${date}/auto/s3/aws4_request`;
      const canonicalHeaders =
        `host:${host}\n` +
        `x-amz-content-sha256:UNSIGNED-PAYLOAD\n` +
        `x-amz-date:${amzDate}\n`;
      const canonicalRequest = [
        "GET",
        path,
        "",
        canonicalHeaders,
        "host;x-amz-content-sha256;x-amz-date",
        "UNSIGNED-PAYLOAD",
      ].join("\n");
      const stringToSign = [
        "AWS4-HMAC-SHA256",
        amzDate,
        scope,
        sha256(canonicalRequest),
      ].join("\n");
      const dateKey = hmac(`AWS4${secretAccessKey!}`, date);
      const regionKey = hmac(dateKey, "auto");
      const serviceKey = hmac(regionKey, "s3");
      const signingKey = hmac(serviceKey, "aws4_request");
      const signature = createHmac("sha256", signingKey)
        .update(stringToSign)
        .digest("hex");
      const authorization =
        `AWS4-HMAC-SHA256 Credential=${accessKeyId!}/${scope}, ` +
        `SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`;
      return fetcher(`${endpoint}${path}`, {
        method: "GET",
        headers: {
          Authorization: authorization,
          "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
          "x-amz-date": amzDate,
        },
        signal: AbortSignal.timeout(10_000),
      });
    },
  };
}
