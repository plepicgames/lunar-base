import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";
import { sourceLocation } from "./sources.ts";

const pages = [4, 21, 22, 23, 24, 25, 26] as const;
// The label recorded in assets/help/manifest.json. The rulebook PDF is not in
// this repository; a build reads it from LUNAR_RULEBOOK_PDF.
const source = "lunar-base-rulebook.pdf";
type Entry = {
  file: string;
  page: number;
  sheet: number;
  width: number;
  height: number;
  sha256: string;
};
type Manifest = { version: number; source: string; files: Entry[] };

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export async function buildHelpAssets(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const cache = join(process.cwd(), ".cache/help");
  await mkdir(cache, { recursive: true });
  const rulebook = sourceLocation("LUNAR_RULEBOOK_PDF", "the rulebook PDF");
  const files: Entry[] = [];
  for (const page of pages) {
    const sheet = page === 4 ? 4 : 13 + Math.floor((page - 21) / 2);
    const prefix = join(cache, `page-${String(page)}`);
    await promisify(execFile)("pdftoppm", [
      "-f",
      String(sheet),
      "-l",
      String(sheet),
      "-singlefile",
      "-png",
      "-r",
      "600",
      rulebook,
      prefix,
    ]);
    const metadata = await sharp(`${prefix}.png`).metadata();
    if (!metadata.width || !metadata.height) throw new Error(`Cannot read sheet ${String(sheet)}`);
    const left = page % 2 === 0 ? Math.floor(metadata.width / 2) : 0;
    const bytes = await sharp(`${prefix}.png`)
      .extract({ left, top: 0, width: Math.floor(metadata.width / 2), height: metadata.height })
      .resize({ width: 1000, withoutEnlargement: true })
      .webp({ quality: 75, effort: 6 })
      .toBuffer();
    const { width, height } = await sharp(bytes).metadata();
    if (!width || !height) throw new Error(`Cannot read help page ${String(page)}`);
    const file = `page-${String(page)}.webp`;
    await writeFile(join(directory, file), bytes);
    files.push({ file, page, sheet, width, height, sha256: hash(bytes) });
  }
  const manifest: Manifest = { version: 1, source, files };
  await writeFile(join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await verifyHelpAssets(directory);
}

export async function verifyHelpAssets(directory: string): Promise<void> {
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) as Manifest;
  } catch {
    throw new Error("Missing or invalid assets/help/manifest.json");
  }
  if (
    manifest.version !== 1 ||
    manifest.source !== source ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== pages.length
  ) {
    throw new Error("Invalid assets/help/manifest.json");
  }
  let total = 0;
  for (const [index, page] of pages.entries()) {
    const file = `page-${String(page)}.webp`;
    const entry = manifest.files[index];
    const sheet = page === 4 ? 4 : 13 + Math.floor((page - 21) / 2);
    if (
      entry.file !== file ||
      entry.page !== page ||
      entry.sheet !== sheet ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    ) {
      throw new Error(`Invalid help manifest entry: ${file}`);
    }
    const bytes = await readFile(join(directory, file));
    if (!(await stat(join(directory, file))).isFile() || hash(bytes) !== entry.sha256) {
      throw new Error(`Changed help image: ${file}`);
    }
    const metadata = await sharp(bytes).metadata();
    if (
      metadata.format !== "webp" ||
      metadata.width !== entry.width ||
      metadata.height !== entry.height ||
      metadata.width < 1000
    ) {
      throw new Error(`Invalid help image: ${file}`);
    }
    total += bytes.length;
  }
  if (total >= 2_000_000) throw new Error("Help images exceed 2 MB");
  const expected = new Set(["manifest.json", ...pages.map((page) => `page-${String(page)}.webp`)]);
  for (const item of await readdir(directory)) {
    if (!expected.has(item)) throw new Error(`Unlisted help asset: ${item}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildHelpAssets(join(process.cwd(), "assets/help"));
  process.stdout.write("Built seven help pages.\n");
}
