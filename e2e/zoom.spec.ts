import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { expect, test } from "./fixtures.ts";

// No screen shows a card yet (T051), so the spec builds a one-card page from
// the real components into the ignored .cache and serves it under /__harness/.
// The build copies `assets/`, so the card images sit beside the page.
const root = join(import.meta.dirname, "..");
const harness = join(root, ".cache", "zoom-harness");
const out = join(harness, "out");
const BASE = "/__harness/";
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
};

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Zoom harness</title></head>
<body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>
`;

const ENTRY = `import { createElement } from "react";
import { createRoot } from "react-dom/client";
import ${JSON.stringify(join(root, "src/client/styles/global.css"))};
import { ZoomCard } from ${JSON.stringify(join(root, "src/client/cards/Zoom.tsx"))};
import { Hand } from ${JSON.stringify(join(root, "src/client/table/Hand.tsx"))};

const centre = {
  display: "grid",
  placeItems: "center",
  minHeight: "100vh",
};
const root = createRoot(document.getElementById("root"));
if (location.search === "?hand") {
  // The hand sits at the bottom of a window-high shell that must not scroll.
  const cards = Array.from({ length: 12 }, (_, index) => ({ instance: "h-" + index, cardId: "mod-depot" }));
  const shell = {
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    height: "100vh",
    overflow: "hidden",
  };
  root.render(
    createElement(
      "main",
      { id: "shell", style: shell },
      createElement("p", { id: "counters" }, "Opponent counters"),
      createElement(Hand, { cards, actions: new Map() }),
    ),
  );
} else {
  root.render(
    createElement("main", { style: centre }, createElement(ZoomCard, { cardId: "mod-depot", width: 110 })),
  );
}
`;

test.beforeAll(async () => {
  test.setTimeout(60_000);
  await rm(harness, { recursive: true, force: true });
  await mkdir(harness, { recursive: true });
  await writeFile(join(harness, "index.html"), PAGE);
  await writeFile(join(harness, "main.tsx"), ENTRY);
  await build({
    configFile: false,
    root: harness,
    base: BASE,
    logLevel: "silent",
    publicDir: join(root, "assets"),
    plugins: [react()],
    build: { outDir: out, emptyOutDir: true },
  });
});

test("a card without an instance keeps its unlit hover state", async ({ page }) => {
  await page.route(`**${BASE}**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    const file = pathname.slice(BASE.length) || "index.html";
    const path = join(out, file);
    const type = TYPES[path.slice(path.lastIndexOf("."))] ?? "application/octet-stream";
    await route.fulfill({ body: await readFile(path), contentType: type });
  });
  await page.goto(`${BASE}index.html`);
  const card = page.getByRole("button", { name: "Depot" });
  await expect(card).toBeVisible();
  expect(await card.getAttribute("data-card")).toBeNull();
  await card.hover();
  expect(await card.evaluate((element) => getComputedStyle(element).boxShadow)).toBe("none");
});

test("the zoom of a centred card stays open while the pointer rests and moves within it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route(`**${BASE}**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    const file = pathname.slice(BASE.length) || "index.html";
    const path = join(out, file);
    const type = TYPES[path.slice(path.lastIndexOf("."))] ?? "application/octet-stream";
    await route.fulfill({ body: await readFile(path), contentType: type });
  });
  await page.goto(`${BASE}index.html`);

  const card = page
    .getByRole("button")
    .filter({ has: page.locator('img[src$="/cards/w240/mod-depot.webp"]') });
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  if (box === null) throw new Error("the card has no box");
  // The card sits in the middle, where the fixed zoom view is drawn over it.
  expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThan(8);
  expect(Math.abs(box.y + box.height / 2 - 360)).toBeLessThan(8);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveCount(0);
  await page.mouse.move(x - 20, y - 20);
  await page.mouse.move(x, y);
  await expect(dialog).toBeVisible({ timeout: 3000 });

  // The view really lies over the card; the pointer must still count as on it.
  const zoom = await dialog.boundingBox();
  if (zoom === null) throw new Error("the zoom has no box");
  expect(zoom.x).toBeLessThan(x);
  expect(zoom.x + zoom.width).toBeGreaterThan(x);

  // Stationary: sample the zoom for 1.5 s; it must never close and reopen.
  for (let sample = 0; sample < 15; sample += 1) {
    await expect(dialog).toBeVisible({ timeout: 0 });
    await page.waitForTimeout(100);
  }

  // Moving within the card leaves it open.
  for (const [dx, dy] of [
    [1, 0],
    [-3, 4],
    [5, -6],
  ] as const) {
    await page.mouse.move(x + dx, y + dy);
    for (let sample = 0; sample < 5; sample += 1) {
      await expect(dialog).toBeVisible({ timeout: 0 });
      await page.waitForTimeout(100);
    }
  }

  // Moving away closes it.
  await page.mouse.move(20, 20);
  await expect(dialog).toHaveCount(0);
});

test("the zoom of a card in the raised hand is centred, readable and leaves the table still", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route(`**${BASE}**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    const file = pathname.slice(BASE.length) || "index.html";
    const path = join(out, file);
    const type = TYPES[path.slice(path.lastIndexOf("."))] ?? "application/octet-stream";
    await route.fulfill({ body: await readFile(path), contentType: type });
  });
  await page.goto(`${BASE}index.html?hand`);

  const cards = page.getByRole("region", { name: "Your hand" }).getByRole("button");
  await expect(cards).toHaveCount(12);
  const counters = page.locator("#counters");
  const before = await counters.boundingBox();
  if (before === null) throw new Error("the counters have no box");

  // The first card is raised by focus; Space opens its zoom.
  await cards.first().focus();
  await page.keyboard.press("Space");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const zoom = await dialog.boundingBox();
  if (zoom === null) throw new Error("the zoom has no box");
  // Centred in the viewport and inside it, not anchored to the raised slot.
  expect(Math.abs(zoom.x + zoom.width / 2 - 640)).toBeLessThan(2);
  expect(zoom.y).toBeGreaterThanOrEqual(0);
  expect(zoom.y + zoom.height).toBeLessThanOrEqual(720);
  // The rules text keeps a readable width and does not wrap letter by letter.
  const rules = await dialog.locator("p").first().boundingBox();
  if (rules === null) throw new Error("the rules have no box");
  expect(rules.width).toBeGreaterThan(150);
  expect(rules.height).toBeLessThan(300);

  // Opening the zoom does not scroll the shell or move the counters.
  const scroll = await page.locator("#shell").evaluate((element) => element.scrollTop);
  expect(scroll).toBe(0);
  const after = await counters.boundingBox();
  expect(after).toEqual(before);
});
