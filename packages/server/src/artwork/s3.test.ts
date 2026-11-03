import { describe, expect, it } from "vitest";
import { createR2ImageStore } from "./s3.js";

describe("R2 image reader", () => {
  it("is disabled when no image storage configuration is present", () => {
    expect(createR2ImageStore({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("rejects partial configuration instead of silently using another bucket", () => {
    expect(() =>
      createR2ImageStore({ R2_BUCKET: "dev" } as NodeJS.ProcessEnv),
    ).toThrow("R2 image storage configuration is incomplete");
  });

  it("signs a fixed object read using the read-only app credential", async () => {
    const calls: Array<{ url: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (url, init) => {
      calls.push({ url, init });
      return new Response(null, { status: 404 });
    };
    const store = createR2ImageStore(
      {
        R2_ACCOUNT_ID: "a".repeat(32),
        R2_BUCKET: "kartiseret-artwork-dev",
        R2_READ_ACCESS_KEY_ID: "read-key-id",
        R2_READ_SECRET_ACCESS_KEY: "read-secret",
        R2_ACCESS_KEY_ID: "write-key-id",
        R2_SECRET_ACCESS_KEY: "write-secret",
      } as NodeJS.ProcessEnv,
      fetcher,
    );

    const response = await store!.getObject(
      `artwork/v1/poster/${"a".repeat(64)}/342.webp`,
    );

    expect(response.status).toBe(404);
    const { url, init } = calls[0]!;
    expect(String(url)).toBe(
      `https://${"a".repeat(32)}.r2.cloudflarestorage.com/kartiseret-artwork-dev/artwork/v1/poster/${"a".repeat(64)}/342.webp`,
    );
    expect(init?.method).toBe("GET");
    expect(init?.headers).toMatchObject({
      "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
    });
    expect(new Headers(init?.headers).get("authorization")).toContain(
      "Credential=read-key-id/",
    );
    expect(JSON.stringify(init?.headers)).not.toContain("read-secret");
    expect(JSON.stringify(init?.headers)).not.toContain("write-key-id");
  });
});
