const signatureEndOfCentralDirectory = 0x06054b50;
const signatureCentralDirectory = 0x02014b50;
const signatureLocalFileHeader = 0x04034b50;

type ZipEntry = { name: string; data: Buffer };

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Build a small, uncompressed ZIP for Apple's .pkpasses distribution format. */
export function createPassBundle(entries: readonly ZipEntry[]): Buffer {
  if (entries.length < 2 || entries.length > 10) {
    throw new Error("A Wallet bundle must contain between 2 and 10 passes.");
  }
  const names = new Set<string>();
  let uncompressedBytes = 0;
  const localFiles: Buffer[] = [];
  const centralFiles: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    if (
      !/^[A-Za-z0-9._-]+\.pkpass$/.test(entry.name) ||
      names.has(entry.name)
    ) {
      throw new Error(
        "Wallet bundle contains an invalid or duplicate pass name.",
      );
    }
    names.add(entry.name);
    uncompressedBytes += entry.data.byteLength;
    if (uncompressedBytes > 150 * 1024 * 1024) {
      throw new Error("Wallet pass bundle exceeds Apple's 150 MB limit.");
    }
    if (entry.data.byteLength > 0xffffffff) {
      throw new Error("Wallet pass is too large for a standard pass bundle.");
    }

    const name = Buffer.from(entry.name, "utf8");
    const checksum = crc32(entry.data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(signatureLocalFileHeader, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 file name.
    localHeader.writeUInt16LE(0, 8); // Store signed .pkpass bytes verbatim.
    localHeader.writeUInt16LE(0, 10); // DOS time: 00:00:00.
    localHeader.writeUInt16LE(0x21, 12); // DOS date: 1980-01-01.
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(entry.data.byteLength, 18);
    localHeader.writeUInt32LE(entry.data.byteLength, 22);
    localHeader.writeUInt16LE(name.byteLength, 26);
    localHeader.writeUInt16LE(0, 28);
    localFiles.push(localHeader, name, entry.data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(signatureCentralDirectory, 0);
    centralHeader.writeUInt16LE(20, 4); // Created by ZIP 2.0.
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x21, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(entry.data.byteLength, 20);
    centralHeader.writeUInt32LE(entry.data.byteLength, 24);
    centralHeader.writeUInt16LE(name.byteLength, 28);
    centralHeader.writeUInt16LE(0, 30); // Extra length.
    centralHeader.writeUInt16LE(0, 32); // Comment length.
    centralHeader.writeUInt16LE(0, 34); // Disk number.
    centralHeader.writeUInt16LE(0, 36); // Internal attributes.
    centralHeader.writeUInt32LE(0, 38); // External attributes.
    centralHeader.writeUInt32LE(localOffset, 42);
    centralFiles.push(centralHeader, name);
    localOffset +=
      localHeader.byteLength + name.byteLength + entry.data.byteLength;
  }

  const centralDirectory = Buffer.concat(centralFiles);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(signatureEndOfCentralDirectory, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localFiles, centralDirectory, end]);
}
