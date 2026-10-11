import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";

const execFile = promisify(execFileCallback);

export interface Source {
  pdf: string;
  pages: number[];
}
export interface Face {
  id: string;
  type?: string;
  sources: Source[];
}
export interface Catalogue {
  cards: Face[];
  backs: Face[];
}
export interface ManifestFile {
  id: string;
  file: string;
  source: { pdf: string; page: number };
  width: number;
  height: number;
  sha256: string;
}
export interface CardManifest {
  version: 1;
  tools: { sharp?: string; pdftoppm?: string };
  files: ManifestFile[];
}

export function faces(catalogue: Catalogue): Face[] {
  const playing = catalogue.cards.filter((card) => card.type !== "info");
  return [
    ...playing,
    ...catalogue.backs.filter((back) => !playing.some((card) => card.id === back.id)),
  ];
}

export async function encodeCard(options: {
  id: string;
  png: string;
  assetsDir: string;
  pdf: string;
  page: number;
}): Promise<ManifestFile[]> {
  const input = await readFile(options.png);
  const outputs: ManifestFile[] = [];
  for (const [folder, width, height, quality] of [
    ["w591", 591, 1181, 82],
    ["w240", 240, 480, 80],
  ] as const) {
    const file = `${folder}/${options.id}.webp`;
    const bytes = await sharp(input)
      .resize(width, height, { fit: "fill" })
      .webp({ quality })
      .toBuffer();
    await mkdir(join(options.assetsDir, folder), { recursive: true });
    await writeFile(join(options.assetsDir, file), bytes);
    outputs.push({
      id: options.id,
      file,
      source: { pdf: options.pdf, page: options.page },
      width,
      height,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return outputs;
}

export async function writeManifest(
  assetsDir: string,
  files: ManifestFile[],
  pdftoppmVersion: string,
): Promise<CardManifest> {
  const manifest: CardManifest = {
    version: 1,
    tools: { sharp: sharp.versions.sharp, pdftoppm: pdftoppmVersion },
    files,
  };
  await mkdir(assetsDir, { recursive: true });
  await writeFile(join(assetsDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function safePdf(pdf: string): void {
  if (!pdf.startsWith("CARDS/") || pdf.split("/").includes("..")) {
    throw new Error(`Invalid card PDF path: ${pdf}`);
  }
}

export async function buildAssets(options: {
  catalogue: Catalogue;
  productionDir: string;
  assetsDir: string;
  cacheDir: string;
  archive?: string;
  only?: string;
}): Promise<CardManifest> {
  const selected = faces(options.catalogue).filter(
    (face) => !options.only || face.id === options.only,
  );
  if (selected.length === 0) throw new Error(`Unknown card id: ${options.only ?? "(none)"}`);
  const entries: ManifestFile[] = [];
  await mkdir(options.cacheDir, { recursive: true });
  const temp = await mkdtemp(join(options.cacheDir, "card-render-"));
  try {
    if (!existsSync(options.productionDir)) {
      if (!options.archive || !existsSync(options.archive)) {
        throw new Error(
          "Missing production directory; set LUNAR_PRODUCTION_DIR to the unpacked print files " +
            `or LUNAR_PRODUCTION_ARCHIVE to their archive (now ${options.archive ?? "unset"})`,
        );
      }
      await execFile("unzip", ["-oq", options.archive, "CARDS/*", "-d", options.productionDir]);
    }
    for (const face of selected) {
      if (face.sources.length === 0 || face.sources[0].pages.length === 0) {
        throw new Error(`No source page for ${face.id}`);
      }
      const source = face.sources[0];
      const page = source.pages[0];
      safePdf(source.pdf);
      const pdf = join(options.productionDir, source.pdf);
      if (!existsSync(pdf)) {
        throw new Error(
          `Missing PDF ${source.pdf} in LUNAR_PRODUCTION_DIR (${options.productionDir})`,
        );
      }
      const prefix = join(temp, face.id);
      await execFile("pdftoppm", [
        "-r",
        "300",
        "-f",
        String(page),
        "-l",
        String(page),
        "-x",
        "35",
        "-y",
        "35",
        "-W",
        "591",
        "-H",
        "1181",
        "-png",
        "-singlefile",
        pdf,
        prefix,
      ]);
      entries.push(
        ...(await encodeCard({
          id: face.id,
          png: `${prefix}.png`,
          assetsDir: options.assetsDir,
          pdf: source.pdf,
          page,
        })),
      );
    }
    const { stderr } = await execFile("pdftoppm", ["-v"]);
    return await writeManifest(options.assetsDir, entries, stderr.split("\n")[0]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const onlyIndex = process.argv.indexOf("--only");
  const only = onlyIndex < 0 ? undefined : process.argv[onlyIndex + 1];
  if (onlyIndex >= 0 && !only) throw new Error("--only needs a card id");
  const root = process.cwd();
  const catalogue = JSON.parse(
    await readFile(join(root, "docs/design/cards.json"), "utf8"),
  ) as Catalogue;
  const manifest = await buildAssets({
    catalogue,
    productionDir: resolve(process.env.LUNAR_PRODUCTION_DIR ?? ".cache/production"),
    assetsDir: join(root, "assets/cards"),
    cacheDir: join(root, ".cache"),
    archive: process.env.LUNAR_PRODUCTION_ARCHIVE?.trim() || undefined,
    only,
  });
  process.stdout.write(`Built ${String(manifest.files.length)} card images.\n`);
}
