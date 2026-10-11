import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { faces, type CardManifest, type Catalogue } from "./cards.ts";
import { verifyBrandAssets } from "./brand.ts";
import { verifyHelpAssets } from "./help.ts";

export async function verifyAssets(catalogue: Catalogue, assetsDir: string): Promise<void> {
  let manifest: CardManifest;
  try {
    manifest = JSON.parse(await readFile(join(assetsDir, "manifest.json"), "utf8")) as CardManifest;
  } catch {
    throw new Error("Missing or invalid assets/cards/manifest.json");
  }
  const catalogueFaces = faces(catalogue);
  const expected = new Set(
    catalogueFaces.flatMap(({ id }) => [`w591/${id}.webp`, `w240/${id}.webp`]),
  );
  const sources = new Map(catalogueFaces.map((face) => [face.id, face.sources[0]]));
  const listed = new Map(manifest.files.map((entry) => [entry.file, entry]));
  if (listed.size !== manifest.files.length)
    throw new Error("Duplicate file in assets/cards/manifest.json");
  for (const file of expected) {
    if (!listed.has(file)) throw new Error(`Missing manifest entry: ${file}`);
  }
  for (const entry of manifest.files) {
    if (!expected.has(entry.file)) throw new Error(`Unexpected manifest entry: ${entry.file}`);
    const source = sources.get(entry.id);
    if (entry.source.pdf !== source?.pdf || entry.source.page !== source.pages[0]) {
      throw new Error(`Wrong source: ${entry.file}`);
    }
    if (entry.file !== `${entry.width === 591 ? "w591" : "w240"}/${entry.id}.webp`) {
      throw new Error(`Invalid manifest entry: ${entry.file}`);
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(join(assetsDir, entry.file));
    } catch {
      throw new Error(`Missing image: ${entry.file}`);
    }
    if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
      throw new Error(`Changed image: ${entry.file}`);
    }
    const metadata = await sharp(bytes).metadata();
    if (metadata.width !== entry.width || metadata.height !== entry.height) {
      throw new Error(`Wrong dimensions: ${entry.file}`);
    }
    if (!(await stat(join(assetsDir, entry.file))).isFile())
      throw new Error(`Not a file: ${entry.file}`);
  }
  const pending = [""];
  while (pending.length > 0) {
    const folder = pending.pop();
    if (folder === undefined) break;
    for (const item of await readdir(join(assetsDir, folder), { withFileTypes: true })) {
      const relative = folder ? `${folder}/${item.name}` : item.name;
      if (item.isDirectory()) pending.push(relative);
      else if (relative !== "manifest.json" && !listed.has(relative)) {
        throw new Error(`Unlisted file: ${relative}`);
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = process.cwd();
  const catalogue = JSON.parse(
    await readFile(join(root, "docs/design/cards.json"), "utf8"),
  ) as Catalogue;
  await verifyAssets(catalogue, join(root, "assets/cards"));
  await verifyBrandAssets(join(root, "assets/brand"));
  await verifyHelpAssets(join(root, "assets/help"));
  const all = faces(catalogue);
  const playing = all.filter((face) => face.id !== "back-deck").length;
  process.stdout.write(
    `Card assets verified: ${String(playing)} playing faces and back-deck, ${String(all.length * 2)} files.\n`,
  );
  process.stdout.write("Brand assets verified.\n");
  process.stdout.write("Help assets verified.\n");
}
