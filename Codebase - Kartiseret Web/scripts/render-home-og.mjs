import { createHomepagePreviewImage } from "../server/og/previewImage.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(webRoot, "public/og/home.jpg");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, await createHomepagePreviewImage());
process.stdout.write(`Wrote ${output}\n`);
