import type { Locator, Page } from "@playwright/test";
import type { GameView } from "../src/protocol/messages.ts";
import { REPORT_FIELDS } from "../src/client/report.ts";
import { buildPending, view } from "../src/client/testing/view-fixture.ts";
import { expect, test } from "./fixtures.ts";

const TOKEN = "0123456789abcdef0123456789abcdef";
const SEED = "e2e-walking-skeleton";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function reportLink(page: Page): Locator {
  return page.getByRole("link", { name: "Report a problem" });
}

/** The link's query, after checking where it leads and that it holds nothing private. */
async function reportQuery(page: Page, name: string): Promise<URLSearchParams> {
  const link = reportLink(page);
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  const href = (await link.getAttribute("href")) ?? "";
  const url = new URL(href);
  expect(url.origin + url.pathname).toBe("https://github.com/plepicgames/lunar-base/issues/new");
  expect(url.searchParams.get("template")).toBe("game-problem.yml");
  for (const key of url.searchParams.keys()) expect(["template", ...REPORT_FIELDS]).toContain(key);
  const token = await page.evaluate(() => window.sessionStorage.getItem("lunar-base.token"));
  expect(token).toMatch(/^[0-9a-f]{32}$/);
  const text = decodeURIComponent(href).toLowerCase();
  for (const secret of [SEED, token ?? "", name.toLowerCase()]) expect(text).not.toContain(secret);
  expect(text).not.toContain("seed");
  expect(text).not.toContain("token");
  expect(url.searchParams.get("build")).toBe("dev");
  expect(url.searchParams.get("browser")).toBe(await page.evaluate(() => navigator.userAgent));
  return url.searchParams;
}

test("the lobby and the table link to the report form without a seed or a token", async ({
  page,
}) => {
  // The game ID as the server sends it to every seat.
  let game = "";
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      const message = JSON.parse(String(payload)) as { type: string; game?: string };
      if (message.type === "game.update" && message.game) game = message.game;
    });
  });
  await page.goto("./");
  await page.getByRole("textbox", { name: "Name" }).fill("Zebedee");
  await page.getByRole("button", { name: "Enter the lobby" }).click();
  await expect(page.getByRole("heading", { name: "Create a game" })).toBeVisible();

  const lobby = await reportQuery(page, "Zebedee");
  expect(lobby.get("screen")).toBe("lobby");
  expect(lobby.has("game-id")).toBe(false);
  expect(lobby.has("turn")).toBe(false);
  await expect(page.getByText("Version dev")).toBeVisible();

  await page.getByRole("spinbutton", { name: "Players", exact: true }).fill("2");
  await page.getByRole("spinbutton", { name: "Non-human players" }).fill("1");
  await page.getByRole("button", { name: "Create game" }).click();
  await expect(page.getByRole("region", { name: "Table" })).toBeVisible();

  const table = await reportQuery(page, "Zebedee");
  expect(table.get("screen")).toBe("table");
  expect(game).toMatch(UUID);
  expect(table.get("game-id")).toBe(game);
  expect(Number(table.get("turn"))).toBeGreaterThanOrEqual(1);

  // The link is reachable with the keyboard and shows the focus outline.
  await reportLink(page).focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(reportLink(page)).toBeFocused();
  const outline = await reportLink(page).evaluate((element) => getComputedStyle(element).outline);
  expect(outline).toContain("3px");
});

async function script(page: Page, scripted: Partial<GameView>): Promise<void> {
  await page.routeWebSocket("**/ws", (socket) => {
    socket.onMessage((raw) => {
      if ((JSON.parse(String(raw)) as { type: string }).type !== "hello") return;
      socket.send(
        JSON.stringify({ type: "welcome", protocol: 1, token: TOKEN, name: "Ann", jev: false }),
      );
      socket.send(
        JSON.stringify({
          type: "game.update",
          game: "g1",
          seq: 1,
          view: view(scripted),
          events: [],
        }),
      );
    });
  });
  await page.goto("./");
  await page.getByRole("textbox", { name: "Name" }).fill("Ann");
  await page.getByRole("button", { name: "Enter the lobby" }).click();
}

test("the result screen links to the report form with the game and its last turn", async ({
  page,
}) => {
  await script(page, {
    turn: { number: 9, seat: 0, step: "main_action" },
    result: { reason: "victory", winners: [0], scores: [3, 1] },
  });
  await expect(page.getByRole("region", { name: "Result" })).toBeVisible();
  const result = await reportQuery(page, "Ann");
  expect(Object.fromEntries(result)).toMatchObject({
    screen: "result",
    "game-id": "g1",
    turn: "9",
  });
});

test("at 390 px the report link covers no control of the table", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await script(page, { pending: buildPending });
  await expect(page.getByRole("region", { name: "Opponents" })).toBeVisible();
  const link = reportLink(page);
  await expect(link).toBeVisible();
  const overlaps = await link.evaluate((element) => {
    const mine = element.getBoundingClientRect();
    const inside = mine.left >= 0 && mine.right <= window.innerWidth;
    const hit = [...document.querySelectorAll("main button, main a, main input")].filter(
      (control) => {
        const box = control.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return false;
        return (
          box.left < mine.right &&
          mine.left < box.right &&
          box.top < mine.bottom &&
          mine.top < box.bottom
        );
      },
    );
    const centre = document.elementFromPoint(
      mine.left + mine.width / 2,
      mine.top + mine.height / 2,
    );
    return { inside, hit: hit.length, onTop: centre === element };
  });
  expect(overlaps).toEqual({ inside: true, hit: 0, onTop: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
