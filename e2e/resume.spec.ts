import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

async function enter(page: Page, name: string): Promise<void> {
  await page.goto("/?plain=1");
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await page.getByRole("button", { name: "Enter the lobby" }).click();
  await expect(page.getByRole("heading", { name: "Create a game" })).toBeVisible();
}

async function create(page: Page, bots: number): Promise<void> {
  await page.getByRole("spinbutton", { name: "Non-human players" }).fill(String(bots));
  await page.getByRole("button", { name: "Create game" }).click();
}

async function twoHumanPlayers(ada: Page, prefix: string): Promise<[Page, Page]> {
  const bo = await ada.context().newPage();
  await enter(ada, `${prefix} Ada`);
  await enter(bo, `${prefix} Bo`);
  await create(ada, 0);
  await bo.getByRole("button", { name: "Join" }).click();
  await expect(ada.getByRole("region", { name: "Table" })).toBeVisible();
  await expect(bo.getByRole("region", { name: "Table" })).toBeVisible();
  return [ada, bo];
}

test("reload restores the same hand and pending decision at the table", async ({ page }) => {
  const [ada, bo] = await twoHumanPlayers(page, "Reload");
  const active = (await ada.getByRole("region", { name: "Your decision" }).count()) ? ada : bo;
  const hand = active.getByRole("region", { name: "Your hand" }).getByRole("listitem");
  const decision = active.getByRole("region", { name: "Your decision" });
  await expect(decision.getByRole("button").first()).toBeVisible();
  const cardNames = await hand.allTextContents();
  expect(cardNames.length).toBeGreaterThan(0);
  const pendingKind = await decision.locator("[data-decision-kind]").textContent();
  const pendingOptions = await decision.getByRole("button").allTextContents();

  await active.reload();
  await expect(active.getByRole("region", { name: "Table" })).toBeVisible();
  await expect(decision.locator("[data-decision-kind]")).toHaveText(pendingKind ?? "");
  expect(await decision.getByRole("button").allTextContents()).toEqual(pendingOptions);
  expect(await hand.allTextContents()).toEqual(cardNames);
});

test("a second tab in the same browser context enters as its own player", async ({ page }) => {
  await enter(page, "Tab Ada");
  await create(page, 1);
  await expect(page.getByRole("region", { name: "Table" })).toBeVisible();

  const second = await page.context().newPage();
  await second.goto("/");
  await expect(second.getByRole("textbox", { name: "Name" })).toBeVisible();
  await second.getByRole("textbox", { name: "Name" }).fill("Tab Bo");
  await second.getByRole("button", { name: "Enter the lobby" }).click();
  await expect(second.getByRole("heading", { name: "Create a game" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Table" })).toBeVisible();
  await expect(page.getByText("This game is open in another tab")).toHaveCount(0);
});

test("an absent player shows as away and the one-second takeover advances play", async ({
  page,
}) => {
  const [ada, bo] = await twoHumanPlayers(page, "Takeover");
  const active = (await ada.getByRole("region", { name: "Your decision" }).count()) ? ada : bo;
  const observer = active === ada ? bo : ada;
  const activeName = active === ada ? "Takeover Ada" : "Takeover Bo";
  const decision = observer.getByRole("status");
  await expect(decision).toContainText(`${activeName} decides:`);
  const log = observer.getByRole("region", { name: "Log" }).getByRole("listitem");
  const before = await log.count();
  await active.close();
  await expect(observer.getByRole("region", { name: activeName })).toContainText("away");
  await expect.poll(async () => await log.count(), { timeout: 5000 }).toBeGreaterThan(before);
});
