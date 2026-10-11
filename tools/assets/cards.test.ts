import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, chmod } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import sharp from "sharp";
import { buildAssets, encodeCard, faces, writeManifest } from "./cards.ts";
import { verifyAssets } from "./verify.ts";

const roots: string[] = [];
const execFile = promisify(execFileCallback);
const catalogue = {
  cards: [{ id: "fixture", sources: [{ pdf: "CARDS/fixture.pdf", pages: [2] }] }],
  backs: [{ id: "back-deck", sources: [{ pdf: "CARDS/back.pdf", pages: [1] }] }],
};

async function fixture() {
  const root = await mkdtemp(join(process.cwd(), ".cache/card-test-"));
  roots.push(root);
  const source = join(root, "source");
  const output = join(root, "output");
  await mkdir(source);
  const png = join(source, "fixture.png");
  await writeFile(
    png,
    await sharp({ create: { width: 3, height: 6, channels: 3, background: "#123456" } })
      .png()
      .toBuffer(),
  );
  return { source, output, png };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("encodes both sizes and records their dimensions and SHA-256 without writing to the source", async () => {
  const { source, output, png } = await fixture();
  const original = await readFile(png);
  const listing = await readdir(source);
  await chmod(source, 0o555);
  try {
    const files = await encodeCard({
      id: "fixture",
      png,
      assetsDir: output,
      pdf: "CARDS/fixture.pdf",
      page: 2,
    });
    const manifest = await writeManifest(output, files, "test");
    expect(JSON.parse(await readFile(join(output, "manifest.json"), "utf8"))).toEqual(manifest);
    expect(await readdir(source)).toEqual(listing);
    expect(await readFile(png)).toEqual(original);
    expect(files.map(({ width, height }) => [width, height])).toEqual([
      [591, 1181],
      [240, 480],
    ]);
    for (const file of files) {
      const bytes = await readFile(join(output, file.file));
      expect((await sharp(bytes).metadata()).width).toBe(file.width);
      expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(file.sha256).toBe(
        (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex"),
      );
    }
  } finally {
    await chmod(source, 0o755);
  }
});

it("does not unpack into an existing production directory with a missing PDF", async () => {
  const { source, output } = await fixture();
  const archiveRoot = join(output, "archive-root");
  await mkdir(join(archiveRoot, "CARDS"), { recursive: true });
  await writeFile(join(archiveRoot, "CARDS/fixture.pdf"), "archive content");
  const archive = join(output, "cards.zip");
  await execFile("zip", [archive, "CARDS/fixture.pdf"], { cwd: archiveRoot });
  const productionDir = join(source, "production");
  await mkdir(productionDir);
  await writeFile(join(productionDir, "README.txt"), "source directory");
  await chmod(productionDir, 0o555);
  try {
    await expect(
      buildAssets({
        catalogue,
        productionDir,
        assetsDir: output,
        cacheDir: join(output, "cache"),
        archive,
        only: "fixture",
      }),
    ).rejects.toThrow("LUNAR_PRODUCTION_DIR");
    expect(await readdir(productionDir)).toEqual(["README.txt"]);
    expect(await readFile(join(productionDir, "README.txt"), "utf8")).toBe("source directory");
  } finally {
    await chmod(productionDir, 0o755);
  }
});

it("verifies a matching set and names missing, changed, and unlisted files", async () => {
  const { output, png } = await fixture();
  const files = [
    ...(await encodeCard({
      id: "fixture",
      png,
      assetsDir: output,
      pdf: "CARDS/fixture.pdf",
      page: 2,
    })),
    ...(await encodeCard({
      id: "back-deck",
      png,
      assetsDir: output,
      pdf: "CARDS/back.pdf",
      page: 1,
    })),
  ];
  await writeFile(join(output, "manifest.json"), JSON.stringify({ version: 1, tools: {}, files }));
  await expect(verifyAssets(catalogue, output)).resolves.toBeUndefined();
  const file = join(output, "w240/fixture.webp");
  const original = await readFile(file);
  await writeFile(file, Buffer.concat([original, Buffer.from("changed")]));
  await expect(verifyAssets(catalogue, output)).rejects.toThrow("w240/fixture.webp");
  await rm(file);
  await expect(verifyAssets(catalogue, output)).rejects.toThrow("w240/fixture.webp");
  await writeFile(file, original);
  await writeFile(join(output, "w240/stray.webp"), original);
  await expect(verifyAssets(catalogue, output)).rejects.toThrow("w240/stray.webp");
  await rm(join(output, "w240/stray.webp"));
  await writeFile(join(output, "stray.webp"), original);
  await expect(verifyAssets(catalogue, output)).rejects.toThrow("stray.webp");
  await rm(join(output, "stray.webp"));
  await mkdir(join(output, "w100"));
  await writeFile(join(output, "w100/stray.webp"), original);
  await expect(verifyAssets(catalogue, output)).rejects.toThrow("w100/stray.webp");
});

it("selects playing faces and the deck back, and names LUNAR_PRODUCTION_DIR without sources", async () => {
  const { output } = await fixture();
  expect(
    faces({
      ...catalogue,
      cards: [...catalogue.cards, { id: "info", type: "info", sources: [] }],
    }).map((face) => face.id),
  ).toEqual(["fixture", "back-deck"]);
  await expect(
    buildAssets({
      catalogue,
      productionDir: join(output, "missing"),
      assetsDir: output,
      cacheDir: join(output, "cache"),
      archive: join(output, "missing.zip"),
    }),
  ).rejects.toThrow("LUNAR_PRODUCTION_DIR");
});
