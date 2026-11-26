import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PKPass } from "passkit-generator";
import type { WalletTicketDetail } from "@kartiseret/contracts/private-data";
import { HttpError } from "../http-errors.js";

const assetsDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../assets/wallet",
);
const icon = readFileSync(join(assetsDirectory, "icon.png"));
const icon2x = readFileSync(join(assetsDirectory, "icon@2x.png"));
const icon3x = readFileSync(join(assetsDirectory, "icon@3x.png"));

type WalletPassEnvironment = Record<string, string | undefined>;

function certificatesFromEnvironment(env: WalletPassEnvironment) {
  const passTypeIdentifier = env.KARTISERET_WALLET_PASS_TYPE_IDENTIFIER?.trim();
  const teamIdentifier = env.KARTISERET_WALLET_TEAM_IDENTIFIER?.trim();
  const signerCert = env.KARTISERET_WALLET_SIGNER_CERT_BASE64?.trim();
  const signerKey = env.KARTISERET_WALLET_SIGNER_KEY_BASE64?.trim();
  const wwdr = env.KARTISERET_WALLET_WWDR_CERT_BASE64?.trim();
  if (
    !passTypeIdentifier ||
    !teamIdentifier ||
    !signerCert ||
    !signerKey ||
    !wwdr
  )
    throw new HttpError(
      503,
      "wallet_pass_unavailable",
      "Apple Wallet pass signing is not configured yet.",
    );
  if (
    !/^pass\.[A-Za-z0-9.-]+$/.test(passTypeIdentifier) ||
    !/^[A-Z0-9]{10}$/.test(teamIdentifier)
  )
    throw new HttpError(
      503,
      "wallet_pass_unavailable",
      "Apple Wallet pass signing is not configured yet.",
    );

  try {
    const decode = (value: string) => {
      const normalized = value.replace(/\s/g, "");
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) throw new Error();
      const buffer = Buffer.from(normalized, "base64");
      if (
        !buffer.length ||
        buffer.toString("base64").replace(/=+$/, "") !==
          normalized.replace(/=+$/, "")
      )
        throw new Error();
      return buffer;
    };
    return {
      passTypeIdentifier,
      teamIdentifier,
      certificates: {
        signerCert: decode(signerCert),
        signerKey: decode(signerKey),
        wwdr: decode(wwdr),
        ...(env.KARTISERET_WALLET_SIGNER_KEY_PASSPHRASE
          ? { signerKeyPassphrase: env.KARTISERET_WALLET_SIGNER_KEY_PASSPHRASE }
          : {}),
      },
    };
  } catch {
    throw new HttpError(
      503,
      "wallet_pass_unavailable",
      "Apple Wallet pass signing is not configured yet.",
    );
  }
}

/** Convert a cinema's Jerusalem wall-clock time into an unambiguous ISO instant. */
function jerusalemDateTime(date: string, time: string): Date {
  const localAsUtc = Date.parse(`${date}T${time}:00Z`);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    timeZoneName: "longOffset",
  });
  let candidate = localAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = formatter
      .formatToParts(new Date(candidate))
      .find((part) => part.type === "timeZoneName")?.value;
    const match = offset?.match(/^GMT([+-])(\d{2}):(\d{2})$/);
    if (!match) throw new Error("Could not determine the screening timezone.");
    const minutes =
      (Number(match[2]) * 60 + Number(match[3])) * (match[1] === "+" ? 1 : -1);
    const next = localAsUtc - minutes * 60_000;
    if (next === candidate) break;
    candidate = next;
  }
  const result = new Date(candidate);
  if (Number.isNaN(result.getTime()))
    throw new Error("Invalid screening date.");
  return result;
}

export async function generateWalletPass(
  ticket: WalletTicketDetail,
  env: WalletPassEnvironment = process.env,
): Promise<Buffer> {
  const { passTypeIdentifier, teamIdentifier, certificates } =
    certificatesFromEnvironment(env);
  const eventStart = jerusalemDateTime(
    ticket.screeningDate,
    ticket.screeningTime,
  );
  const relevantAt = new Date(eventStart.getTime() - 15 * 60_000).toISOString();
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    dateStyle: "medium",
  }).format(eventStart);
  const pass = new PKPass(
    {
      "icon.png": icon,
      "icon@2x.png": icon2x,
      "icon@3x.png": icon3x,
    },
    certificates,
    {
      formatVersion: 1,
      serialNumber: ticket.id,
      passTypeIdentifier,
      teamIdentifier,
      organizationName: "Kartiseret",
      description: "Kartiseret movie ticket",
      logoText: "Kartiseret",
      backgroundColor: "rgb(250, 249, 255)",
      foregroundColor: "rgb(35, 32, 45)",
      labelColor: "rgb(102, 91, 126)",
      sharingProhibited: true,
      semantics: {
        eventName: ticket.title,
        eventType: "PKEventTypeMovie",
        eventStartDate: eventStart.toISOString(),
        venueName: ticket.cinema,
      },
    },
  );
  try {
    pass.type = "eventTicket";
    pass.primaryFields.push({
      key: "movie",
      label: "MOVIE",
      value: ticket.title,
    });
    pass.secondaryFields.push(
      { key: "cinema", label: "CINEMA", value: ticket.cinema },
      { key: "date", label: "DATE", value: dateLabel },
    );
    pass.auxiliaryFields.push(
      { key: "time", label: "SHOWTIME", value: ticket.screeningTime },
      { key: "city", label: "CITY", value: ticket.city },
    );
    pass.backFields.push(
      {
        key: "screening",
        label: "SCREENING",
        value: `${dateLabel} · ${ticket.screeningTime}`,
      },
      {
        key: "cinema",
        label: "CINEMA",
        value: `${ticket.cinema}, ${ticket.city}`,
      },
      { key: "source", label: "TICKET", value: "Imported to Kartiseret" },
    );
    pass.setBarcodes({
      format: "PKBarcodeFormatQR",
      message: ticket.qrMessage,
      messageEncoding: "utf-8",
      altText: "Ticket QR code",
    });
    pass.preferredStyleSchemes = ["eventTicket"];
    // Wallet picks the precise presentation time around this relevance date.
    pass.setRelevantDate(new Date(relevantAt));
    pass.setRelevantDates([{ relevantDate: relevantAt }]);
    return await pass.getAsBuffer();
  } catch {
    throw new HttpError(
      503,
      "wallet_pass_unavailable",
      "Apple Wallet could not create this pass. Please try again or use the original ticket.",
    );
  }
}
