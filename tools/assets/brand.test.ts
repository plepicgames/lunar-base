import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { verifyBrandAssets } from "./brand.ts";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

test("brand manifest detects changed, missing, and unlisted files", async () => {
  const folder = await mkdtemp(join(tmpdir(), "lunar-brand-"));
  temporary.push(folder);
  const assets = join(folder, "brand");
  await cp(join(process.cwd(), "assets/brand"), assets, { recursive: true });
  await expect(verifyBrandAssets(assets)).resolves.toBeUndefined();

  const manifest = JSON.parse(await readFile(join(assets, "manifest.json"), "utf8")) as {
    files: { file: string }[];
  };
  const first = manifest.files[0].file;
  await writeFile(join(assets, first), "changed");
  await expect(verifyBrandAssets(assets)).rejects.toThrow(`Changed brand asset: ${first}`);
  await cp(join(process.cwd(), "assets/brand", first), join(assets, first));

  await writeFile(join(assets, "stray.svg"), "unlisted");
  await expect(verifyBrandAssets(assets)).rejects.toThrow("Unlisted brand asset: stray.svg");
});
