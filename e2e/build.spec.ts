import type { Page } from "@playwright/test";
import { buildView } from "../src/client/testing/build-fixture.ts";
import { expect, test } from "./fixtures.ts";

// The Build interaction over the real built client. The spec answers the
// socket with a scripted D6 decision and collects what the client sends.
async function showBuild(page: Page): Promise<Record<string, unknown>[]> {
  const sent: Record<string, unknown>[] = [];
  await page.routeWebSocket("**/ws", (socket) => {
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as Record<string, unknown>;
      if (message.type !== "hello") {
        sent.push(message);
        return;
      }
      socket.send(
        JSON.stringify({
          type: "welcome",
          protocol: 1,
          token: "0123456789abcdef0123456789abcdef",
          name: "Ann",
          jev: false,
        }),
      );
      socket.send(
        JSON.stringify({ type: "game.update", game: "g1", seq: 1, view: buildView(), events: [] }),
      );
    });
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Name" }).fill("Ann");
  await page.getByRole("button", { name: "Enter the lobby" }).click();
  await expect(page.getByRole("button", { name: "Build Depot" })).toBeVisible();
  return sent;
}

async function boardHeight(page: Page) {
  return await page.evaluate(() => {
    const element = document.querySelector('section[aria-label="Base"]')?.parentElement;
    if (element === null || element === undefined) throw new Error("no board");
    return {
      height: element.clientHeight,
      page: document.documentElement.scrollHeight,
      wide: document.documentElement.scrollWidth,
    };
  });
}

const decide = (option: string) => ({
  type: "game.decide",
  game: "g1",
  decision: "d6",
  option,
});

/** Presses Tab until the control with this name has the focus. */
async function tabTo(page: Page, name: string | RegExp): Promise<void> {
  const target = page.getByRole("button", { name });
  for (let press = 0; press < 60; press += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

test("Build with the mouse: Module, place, a click to turn, Confirm", async ({ page }) => {
  const sent = await showBuild(page);
  const base = page.getByRole("region", { name: "Base" });

  await page.getByRole("button", { name: "Build Depot" }).click();
  await expect(base.getByRole("button", { name: /^Place Depot at / })).toHaveCount(3);
  // Every place lies inside the Base grid: the view is fitted around them.
  const grid = await base.getByTestId("base-viewport").boundingBox();
  if (grid === null) throw new Error("Base viewport has no box");
  for (const place of await base.getByRole("button", { name: /^Place Depot at / }).all()) {
    const box = await place.boundingBox();
    if (box === null) throw new Error("A place has no box");
    expect(box.x).toBeGreaterThanOrEqual(grid.x);
    expect(box.y).toBeGreaterThanOrEqual(grid.y);
    expect(box.x + box.width).toBeLessThanOrEqual(grid.x + grid.width);
    expect(box.y + box.height).toBeLessThanOrEqual(grid.y + grid.height);
  }

  await base.getByRole("button", { name: "Place Depot at 1,0" }).click();
  const preview = base.getByRole("button", { name: "Turn Depot" });
  await expect(preview).toHaveAttribute("data-turns", "0");
  await preview.click();
  await expect(preview).toHaveAttribute("data-turns", "2");

  const bar = page.getByRole("region", { name: "Your decision" });
  await expect(bar.getByRole("status")).toContainText("Price: 1 Credit.");
  await expect(bar.getByRole("status")).toContainText("Orbs formed: yellow, red.");
  expect(sent).toEqual([]);

  const confirm = bar.getByRole("button", { name: /^Confirm: / });
  await expect(confirm).toBeInViewport({ ratio: 1 });
  await confirm.click();
  expect(sent).toEqual([decide("c-1:1,0,2")]);
});

// The bar is at its fullest with a preview: text, Confirm, Back and skip.
for (const width of [1024, 1280]) {
  test(`the Build bar leaves the Base board its room at ${String(width)}x720`, async ({ page }) => {
    await showBuild(page);
    await page.setViewportSize({ width, height: 720 });
    const before = await boardHeight(page);
    await page.getByRole("button", { name: "Build Depot" }).click();
    await page.getByRole("button", { name: "Place Depot at 1,0" }).click();
    await expect(page.getByRole("button", { name: /^Confirm: / })).toBeInViewport({ ratio: 1 });

    const board = await boardHeight(page);
    // No less than before a Module was picked, and as much as the generic
    // one-row bar leaves it (table-layout.spec.ts).
    expect(board.height).toBeGreaterThanOrEqual(before.height);
    expect(board.height).toBeGreaterThanOrEqual(90);
    expect(board.page).toBeLessThanOrEqual(720);
    expect(board.wide).toBeLessThanOrEqual(width);
  });
}

test("Build with Tab, Enter, R and Escape only", async ({ page }) => {
  const sent = await showBuild(page);
  const base = page.getByRole("region", { name: "Base" });

  await tabTo(page, "Build Depot");
  await page.keyboard.press("Enter");
  await expect(base.getByRole("button", { name: "Place Depot at 1,-1" })).toBeFocused();

  await tabTo(page, "Place Depot at 1,0");
  await page.keyboard.press("Enter");
  const preview = base.getByRole("button", { name: "Turn Depot" });
  await expect(preview).toBeFocused();
  await page.keyboard.press("r");
  await expect(preview).toHaveAttribute("data-turns", "2");

  // Escape steps back to the places, and the same place is picked again.
  await page.keyboard.press("Escape");
  await expect(base.getByRole("button", { name: "Place Depot at 1,0" })).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("r");
  await page.keyboard.press("r");
  await expect(preview).toHaveAttribute("data-turns", "3");

  await tabTo(page, /^Confirm: /);
  await page.keyboard.press("Enter");
  expect(sent).toEqual([decide("c-1:1,0,3")]);
});

test("Skip sends the skip option", async ({ page }) => {
  const sent = await showBuild(page);
  await page.getByRole("button", { name: "Do not Build", exact: true }).click();
  expect(sent).toEqual([decide("skip")]);
});
