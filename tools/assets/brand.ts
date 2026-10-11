import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";
import { sourceLocation } from "./sources.ts";

type Crop = { left: number; top: number; width: number; height: number };
type BrandSource = { file: string; source: string; background?: true; crop?: Crop };
type BrandEntry = { file: string; source: string; sha256: string };
type BrandManifest = { version: number; files: BrandEntry[] };

export const brandSources: BrandSource[] = [
  { file: "lunar-base-logo-color.png", source: "LF/1_logos/Lunar base colored logo v1.png" },
  {
    file: "lunar-base-logo-white.svg",
    source: "LS/Lunar Base_Quatermaster_ package/Lunar Base logo/Lunar Base_logo_white.svg",
  },
  { file: "website-logo.svg", source: "LF/Web/Elements/Lunar Base website logo v1.svg" },
  { file: "website-icon.svg", source: "LF/Web/Elements/Lunar Base website icon v1.svg" },
  {
    file: "hero-nebula.webp",
    source: "LF/Web/Elements/Hero image 1920 x 1200.jpg",
    background: true,
  },
  {
    file: "contour-background.webp",
    source: "LF/Web/Elements/About Game background.jpg",
    background: true,
  },
  {
    file: "footer-nebula.webp",
    source: "LF/Web/Elements/Lunar Base web footer v1.jpg",
    background: true,
  },
  ...[1, 2, 3, 4, 5].map((number) => ({
    file: `web-icon-${String(number)}.svg`,
    source: `LF/Web/Elements/Icons/LB web icons v1-0${String(number)}.svg`,
  })),
  { file: "right-arrow.svg", source: "LF/Web/Elements/Icons/right-arrow.svg" },
  {
    file: "plepic-games-wordmark.svg",
    source: "PF/vector/plepic-games-wordmark-dark-background.svg",
  },
  ...(
    [
      "station",
      "module",
      "agent",
      "influence",
      "scientific-achievement",
      "credits",
      "colonists",
    ] as const
  ).map((name, index) => ({
    file: `badges/${name}.webp`,
    source: "LF/Web/Elements/Card type tabs v1.png",
    crop: {
      left: [10, 220, 430, 640, 850, 1060, 1270][index],
      top: 0,
      width: index === 6 ? 220 : 200,
      height: 268,
    },
  })),
  ...(
    [
      ["dog", 1980, 925],
      ["flask", 2170, 925],
      ["dna", 2358, 925],
      ["lotus", 2546, 925],
      ["cyber_head", 2730, 925],
      ["helmet", 2920, 925],
      ["printer", 1790, 1115],
      ["brain", 1980, 1115],
      ["rover", 2170, 1115],
      ["elevator", 2350, 1115],
      ["satellite", 2540, 1115],
      ["rocket", 2730, 1115],
      ["atom", 2920, 1115],
      ["flag", 2235, 1310],
      ["dome", 2490, 1310],
      ["observatory", 2750, 1310],
    ] as const
  ).map(([name, x, y]) => ({
    file: `achievements/${name}.webp`,
    source: "RB/printed-page-10",
    crop: {
      left: x - (name === "dome" ? 90 : 76),
      top: y - 76,
      width: name === "dome" ? 180 : 152,
      height: 152,
    },
  })),
];

function sourcePath(source: string): string {
  const [prefix, ...parts] = source.split("/");
  if (!["LF", "LS", "PF"].includes(prefix) || parts.some((part) => part === ".." || part === "")) {
    throw new Error(`Invalid brand source: ${source}`);
  }
  const root = sourceLocation(
    "LUNAR_BRAND_DIR",
    "the directory that holds the brand source folders LF, LS and PF",
  );
  return join(root, prefix, ...parts);
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function buildBrandAssets(assetsDir: string): Promise<BrandManifest> {
  await mkdir(assetsDir, { recursive: true });
  const renderDir = join(process.cwd(), ".cache/brand");
  await mkdir(renderDir, { recursive: true });
  const renderBase = join(renderDir, "rulebook-printed-page-10");
  await promisify(execFile)("pdftoppm", [
    "-f",
    "7",
    "-l",
    "7",
    "-singlefile",
    "-png",
    "-r",
    "400",
    sourceLocation("LUNAR_RULEBOOK_PDF", "the rulebook PDF"),
    renderBase,
  ]);
  const rulebookPage = await readFile(`${renderBase}.png`);
  const files: BrandEntry[] = [];
  for (const item of brandSources) {
    const input =
      item.source === "RB/printed-page-10" ? rulebookPage : await readFile(sourcePath(item.source));
    const bytes = item.crop
      ? await sharp(input).extract(item.crop).webp({ quality: 90 }).toBuffer()
      : item.background
        ? await sharp(input)
            .resize({ width: 1920, withoutEnlargement: true })
            .webp({ quality: 75, effort: 6 })
            .toBuffer()
        : input;
    await mkdir(join(assetsDir, item.file, ".."), { recursive: true });
    await writeFile(join(assetsDir, item.file), bytes);
    files.push({ file: item.file, source: item.source, sha256: sha256(bytes) });
  }
  const manifest: BrandManifest = { version: 1, files };
  await writeFile(join(assetsDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await verifyBrandAssets(assetsDir);
  return manifest;
}

export async function verifyBrandAssets(assetsDir: string): Promise<void> {
  let manifest: BrandManifest;
  try {
    manifest = JSON.parse(
      await readFile(join(assetsDir, "manifest.json"), "utf8"),
    ) as BrandManifest;
  } catch {
    throw new Error("Missing or invalid assets/brand/manifest.json");
  }
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) {
    throw new Error("Invalid assets/brand/manifest.json");
  }
  const listed = new Map(manifest.files.map((entry) => [entry.file, entry]));
  if (listed.size !== brandSources.length || manifest.files.length !== brandSources.length) {
    throw new Error("Wrong brand manifest file count or duplicate entry");
  }
  let backgroundBytes = 0;
  for (const item of brandSources) {
    const entry = listed.get(item.file);
    if (!entry || entry.source !== item.source || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error(`Missing or invalid brand manifest entry: ${item.file}`);
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(join(assetsDir, item.file));
    } catch {
      throw new Error(`Missing brand asset: ${item.file}`);
    }
    if (sha256(bytes) !== entry.sha256) throw new Error(`Changed brand asset: ${item.file}`);
    if (item.background) {
      const metadata = await sharp(bytes).metadata();
      if (metadata.format !== "webp" || !metadata.width || metadata.width > 1920) {
        throw new Error(`Invalid brand background: ${item.file}`);
      }
      backgroundBytes += bytes.length;
    }
    if (item.crop) {
      const metadata = await sharp(bytes).metadata();
      if (
        metadata.format !== "webp" ||
        !metadata.width ||
        !metadata.height ||
        Math.max(metadata.width, metadata.height) < 96
      ) {
        throw new Error(`Invalid brand cut: ${item.file}`);
      }
    }
  }
  if (backgroundBytes >= 1_000_000) throw new Error("Brand backgrounds exceed 1 MB");
  async function checkListed(directory: string, prefix = ""): Promise<void> {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const name = `${prefix}${item.name}`;
      if (item.isDirectory() && ["badges", "achievements"].includes(item.name) && !prefix) {
        await checkListed(join(directory, item.name), `${name}/`);
      } else if (!item.isFile() || (name !== "manifest.json" && !listed.has(name))) {
        throw new Error(`Unlisted brand asset: ${name}`);
      }
    }
  }
  await checkListed(assetsDir);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const manifest = await buildBrandAssets(join(process.cwd(), "assets/brand"));
  process.stdout.write(`Built ${String(manifest.files.length)} brand assets.\n`);
}
