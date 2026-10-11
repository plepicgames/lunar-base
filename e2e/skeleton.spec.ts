import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const DECISION_LIMIT = 2000;

async function decisionSignature(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const bar = document.querySelector('section[aria-label="Your decision"]');
    const log = document.querySelectorAll('section[aria-label="Log"] li').length;
    return `${String(log)}|${bar?.textContent ?? ""}`;
  });
}

/** Advance later turns in one browser task per decision; the required Draft
 * and Build above use named Playwright controls. */
function answerLater(): { previous: string; selected: boolean } | null {
  const bar = document.querySelector('section[aria-label="Your decision"]');
  if (bar === null) return null;
  const kind = bar.getAttribute("data-kind");
  const previous = `${String(document.querySelectorAll('section[aria-label="Log"] li').length)}|${bar.textContent}`;
  const named = (root: ParentNode, name: string) =>
    [...root.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent.trim() === name,
    );
  const barButtons = [...bar.querySelectorAll<HTMLButtonElement>("button")];
  const action = document.querySelector<HTMLButtonElement>("button[data-decision-option]");
  const dialog = document.querySelector<HTMLButtonElement>('[role="dialog"] button');
  const opponents = document.querySelector<HTMLElement>('section[aria-label="Opponents"]');
  const opponentButton = opponents?.querySelector<HTMLButtonElement>(
    'button:not([aria-label^="View "])',
  );
  const baseAction = document.querySelector<HTMLButtonElement>(
    'section[aria-label="Base"] button[data-decision-option]',
  );
  let selected = false;
  let choice: HTMLButtonElement | undefined | null;
  if (kind === "main_action") {
    choice = named(bar, "Terran Outpost: Resell x2, Draw") ?? barButtons[0];
  } else if (kind === "build") {
    choice = named(bar, "Do not Build");
  } else if (kind === "flip") {
    choice = barButtons.find((button) => !button.disabled);
    if (choice === undefined) {
      choice = opponentButton;
      selected = true;
    }
  } else {
    choice =
      dialog ??
      action ??
      baseAction ??
      opponentButton ??
      barButtons.find((button) => !button.disabled);
  }
  if (choice === undefined || choice === null) throw new Error(`No control for ${String(kind)}`);
  choice.click();
  return { previous, selected };
}

async function enter(page: Page, name: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await page.getByRole("button", { name: "Enter the lobby" }).click();
  await expect(page.getByRole("heading", { name: "Create a game" })).toBeVisible();
}

async function create(page: Page, players: number, nonHuman: number): Promise<void> {
  await page.getByRole("spinbutton", { name: "Players", exact: true }).fill(String(players));
  await page.getByRole("spinbutton", { name: "Non-human players" }).fill(String(nonHuman));
  await page.getByRole("button", { name: "Create game" }).click();
}

test("two players start a game and one of them decides", async ({ newPlayer }) => {
  const ada = await newPlayer();
  const bo = await newPlayer();
  await enter(ada, "Ada");
  await enter(bo, "Bo");

  await create(ada, 2, 0);
  await expect(ada.getByRole("heading", { name: "Waiting for players" })).toBeVisible();
  await bo.getByRole("button", { name: "Join" }).click();

  for (const page of [ada, bo]) {
    await expect(page.getByRole("region", { name: "Table" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Supply" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Base" })).toBeVisible();
  }
  // Exactly one seat decides: one page lists option buttons, the other does not.
  await expect(async () => {
    const counts = await Promise.all(
      [ada, bo].map((page) =>
        page.getByRole("region", { name: "Your decision" }).getByRole("button").count(),
      ),
    );
    expect(counts.filter((count) => count > 0)).toHaveLength(1);
  }).toPass({ timeout: 5000 });
});

test("one player Builds and Drafts on the picture table, then reaches the result", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await enter(page, "Cy");
  await create(page, 2, 1);

  const table = page.getByRole("region", { name: "Table" });
  const result = page.getByRole("region", { name: "Result" });
  const bar = page.getByRole("region", { name: "Your decision" });
  const hand = page.getByRole("region", { name: "Your hand" });
  const supply = page.getByRole("region", { name: "Supply" });
  const base = page.getByRole("region", { name: "Base" });
  let built = false;
  let drafted = false;
  let pictured = false;

  for (let step = 0; step < DECISION_LIMIT; step += 1) {
    if (await result.isVisible()) break;
    if (pictured) {
      const answered = await page.evaluate(answerLater);
      if (answered === null) {
        await page.waitForTimeout(5);
        continue;
      }
      if (answered.selected) continue;
      await page.waitForFunction((before) => {
        const bar = document.querySelector('section[aria-label="Your decision"]');
        if (bar === null) return true;
        const now = `${String(document.querySelectorAll('section[aria-label="Log"] li').length)}|${bar.textContent}`;
        return now !== before;
      }, answered.previous);
      continue;
    }
    if (!(await bar.isVisible())) {
      await page.waitForTimeout(5);
      continue;
    }
    const kind = await bar.getAttribute("data-kind");
    const previous = await decisionSignature(page);
    if (kind === "main_action") {
      const wanted = !drafted
        ? "Terran Outpost: Draft"
        : !built
          ? "Terran Outpost: Build"
          : "Terran Outpost: Resell x2, Draw";
      const choice = bar.getByRole("button", { name: wanted });
      await ((await choice.count()) ? choice : bar.getByRole("button").first()).click();
    } else if (kind === "draft") {
      const cards = supply.getByRole("button", { name: /^Draft / });
      await cards.first().click();
      drafted = true;
    } else if (kind === "build") {
      const modules = hand.getByRole("button", { name: /^Build / });
      if (await modules.count()) {
        await modules.first().click();
        await base
          .getByRole("button", { name: /^Place / })
          .first()
          .click();
        await bar.getByRole("button", { name: /^Confirm: / }).click();
        built = true;
      } else {
        await bar.getByRole("button", { name: "Do not Build" }).click();
      }
    } else if (kind === "flip") {
      await page
        .getByRole("region", { name: "Opponents" })
        .getByRole("button", { name: /^Flip / })
        .first()
        .click();
      const confirm = bar.getByRole("button", { name: "Confirm Stations" });
      if (await confirm.isEnabled()) await confirm.click();
    } else {
      const buttons = page.getByRole("dialog").getByRole("button");
      const handCards = hand.locator("button[data-decision-option]");
      const supplyCards = supply.locator("button[data-decision-option]");
      const target = page
        .getByRole("region", { name: "Opponents" })
        .locator('button:not([aria-label^="View "])');
      const fallback = bar.getByRole("button").first();
      if (await buttons.count()) await buttons.first().click();
      else if (await handCards.count()) await handCards.first().click();
      else if (await supplyCards.count()) await supplyCards.first().click();
      else if (await target.count()) await target.first().click();
      else await fallback.click();
    }
    if (built && drafted && (await table.isVisible())) {
      const log = page.getByRole("region", { name: "Log" });
      await expect(log).toContainText("Player 1 drafted");
      await expect(log).toContainText("Player 1 built");
      await expect(hand.locator("img").first()).toBeVisible();
      await expect(supply.locator("img").first()).toBeVisible();
      expect(await base.locator("img").count()).toBeGreaterThanOrEqual(2);
      await page.waitForFunction(() => [...document.images].every((image) => image.complete));
      // Leave the card after clicking it: a stationary hover opens its zoom.
      await page.mouse.move(1270, 710);
      await page.waitForTimeout(300);
      mkdirSync("test-results/screenshots", { recursive: true });
      await page.screenshot({ path: "test-results/screenshots/table-mid-game-1280x720.png" });
      pictured = true;
    }
    await page.waitForFunction((previous) => {
      const region = document.querySelector('section[aria-label="Your decision"]');
      if (region === null) return true;
      const log = document.querySelectorAll('section[aria-label="Log"] li').length;
      const now = `${String(log)}|${region.textContent}`;
      return now !== previous;
    }, previous);
  }

  expect(built).toBe(true);
  expect(drafted).toBe(true);
  expect(pictured).toBe(true);
  await expect(result).toBeVisible();
  await expect(result.getByRole("heading", { level: 2 })).toContainText(/wins|share the victory/);

  await page.getByRole("button", { name: "Back to lobby" }).click();
  await expect(page.getByRole("heading", { name: "Create a game" })).toBeVisible();
  await create(page, 2, 1);
  await expect(page.getByRole("region", { name: "Table" })).toBeVisible();
});

test("the plain table keeps a short named decision flow", async ({ page }) => {
  await page.goto("/?plain=1");
  await page.getByRole("textbox", { name: "Name" }).fill("Plain");
  await page.getByRole("button", { name: "Enter the lobby" }).click();
  await create(page, 2, 1);
  const table = page.getByRole("region", { name: "Table" });
  await expect(table.getByRole("list", { name: "Base of Plain" })).toBeVisible();
  await expect(table.getByRole("region", { name: "Base", exact: true })).toHaveCount(0);
  await expect(table.getByRole("region", { name: "Supply" })).toBeVisible();
  await expect(table.getByRole("region", { name: "Your hand" })).toBeVisible();
  const decision = table.getByRole("region", { name: "Your decision" });
  await expect(decision.getByRole("button").first()).toBeVisible();
  const previous = await decisionSignature(page);
  await decision.getByRole("button").first().click();
  await page.waitForFunction(
    (before) =>
      document.querySelector('section[aria-label="Your decision"]')?.textContent !== before,
    previous.split("|").slice(1).join("|"),
  );
});

test("a request to another host is aborted and recorded", async ({ page, guard }) => {
  guard.acknowledge();
  const outcome = await page.goto("https://example.com/").catch((error: unknown) => error);
  expect(outcome).toBeInstanceOf(Error);
  expect(guard.urls).toContain("https://example.com/");
});

test("a WebSocket to another host is closed and recorded", async ({ page, guard }) => {
  guard.acknowledge();
  await page.goto("/");
  const outcome = await page.evaluate(
    (url) =>
      new Promise<string>((resolve) => {
        const socket = new WebSocket(url);
        socket.onopen = () => {
          resolve("opened");
        };
        socket.onclose = () => {
          resolve("closed");
        };
        setTimeout(() => {
          resolve("timeout");
        }, 5000);
      }),
    "ws://example.com/socket",
  );
  expect(outcome).toBe("closed");
  expect(guard.urls).toContain("ws://example.com/socket");
});

test("a service worker never becomes active", async ({ page }) => {
  await page
    .context()
    .route("**/sw.js", (route) =>
      route.fulfill({ contentType: "text/javascript", body: "self.onfetch = () => {};" }),
    );
  await page.goto("/");
  const outcome = await page.evaluate(async () => {
    try {
      await navigator.serviceWorker.register("/sw.js");
    } catch {
      return "rejected";
    }
    const ready = navigator.serviceWorker.ready.then(() => "active");
    const idle = new Promise<string>((resolve) =>
      setTimeout(() => {
        resolve("inactive");
      }, 1500),
    );
    return await Promise.race([ready, idle]);
  });
  expect(outcome).not.toBe("active");
});
