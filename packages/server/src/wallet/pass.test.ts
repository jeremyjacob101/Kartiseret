import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { generateWalletPass } from "./pass.js";

it("signs an event pass with a stable serial, the original QR and a relevance window", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kartiseret-wallet-test-"));
  try {
    const keyPath = join(dir, "key.pem");
    const certPath = join(dir, "cert.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-subj",
        "/CN=Local Wallet Test",
        "-days",
        "1",
        "-keyout",
        keyPath,
        "-out",
        certPath,
      ],
      { stdio: "ignore" },
    );
    const certificate = readFileSync(certPath).toString("base64");
    const id = "00000000-0000-4000-8000-000000000001";
    const pass = await generateWalletPass(
      {
        id,
        tmdbId: null,
        title: "Test Movie",
        city: "Jerusalem",
        cinema: "Test Cinema",
        screeningDate: "2026-12-01",
        screeningTime: "20:00",
        qrMessage: "test-payload",
        reminderEnabled: false,
        createdAt: "2026-11-26T10:00:00Z",
        updatedAt: "2026-11-26T10:00:00Z",
      },
      {
        KARTISERET_WALLET_PASS_TYPE_IDENTIFIER: "pass.site.seret.tickets",
        KARTISERET_WALLET_TEAM_IDENTIFIER: "ABCDEFGHIJ",
        KARTISERET_WALLET_SIGNER_CERT_BASE64: certificate,
        KARTISERET_WALLET_SIGNER_KEY_BASE64:
          readFileSync(keyPath).toString("base64"),
        KARTISERET_WALLET_WWDR_CERT_BASE64: certificate,
      },
    );
    const archive = join(dir, "test.pkpass");
    writeFileSync(archive, pass);
    const fields = JSON.parse(
      execFileSync("unzip", ["-p", archive, "pass.json"], { encoding: "utf8" }),
    );
    expect(fields).toMatchObject({
      serialNumber: id,
      passTypeIdentifier: "pass.site.seret.tickets",
      barcodes: [{ message: "test-payload", messageEncoding: "utf-8" }],
      relevantDates: [
        { startDate: "2026-12-01T17:45:00.000Z", endDate: "2026-12-01T18:00:00.000Z" },
      ],
    });
    expect(
      execFileSync("unzip", ["-p", archive, "signature"]).length,
    ).toBeGreaterThan(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
