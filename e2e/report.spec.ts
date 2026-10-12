import type { Locator, Page } from "@playwright/test";
import type { GameView } from "../src/protocol/messages.ts";
import { REPORT_FIELDS } from "../src/client/report.ts";
import { buildPending, view } from "../src/client/testing/view-fixture.ts";
import { expect, test } from "./fixtures.ts";

const TOKEN = "0123456789abcdef0123456789abcdef";
const SEED = "e2e-walking-skeleton";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const LINKS = {
  problem: { text: "Report a problem", template: "game-problem.yml" },
  idea: { text: "Suggest a change", template: "feature-request.yml" },
} as const;
type Kind = keyof typeof LINKS;
const KINDS: readonly Kind[] = ["problem", "idea"];

function reportLink(page: Page, kind: Kind): Locator {
  return page.getByRole("link", { name: LINKS[kind].text });
}

/** One link's query, after checking where it leads and that it holds nothing private. */
async function linkQuery(page: Page, name: string, kind: Kind): Promise<URLSearchParams> {
  const link = reportLink(page, kind);
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  const href = (await link.getAttribute("href")) ?? "";
  const url = new URL(href);
  expect(url.origin + url.pathname).toBe("https://github.com/plepicgames/lunar-base/issues/new");
  expect(url.searchParams.get("template")).toBe(LINKS[kind].template);
  for (const key of url.searchParams.keys()) expect(["template", ...REPORT_FIELDS]).toContain(key);
  // The key carries the base path when the game runs under one.
  const token = await page.evaluate(() => {
    const key = Object.keys(window.sessionStorage).find((k) => k.startsWith("lunar-base.token"));
    return key === undefined ? null : window.sessionStorage.getItem(key);
  });
  expect(token).toMatch(/^[0-9a-f]{32}$/);
  const text = decodeURIComponent(href).toLowerCase();
  for (const secret of [SEED, token ?? "", name.toLowerCase()]) expect(text).not.toContain(secret);
  expect(text).not.toContain("seed");
  expect(text).not.toContain("token");
  expect(url.searchParams.get("build")).toBe("dev");
  expect(url.searchParams.get("browser")).toBe(await page.evaluate(() => navigator.userAgent));
  return url.searchParams;
}

/** The query both links share. They differ in the template only. */
async function reportQuery(page: Page, name: string): Promise<URLSearchParams> {
  const problem = await linkQuery(page, name, "problem");
  const idea = await linkQuery(page, name, "idea");
  idea.set("template", LINKS.problem.template);
  expect(Object.fromEntries(idea)).toEqual(Object.fromEntries(problem));
  return problem;
}

test("the lobby and the table link to both forms without a seed or a token", async ({ page }) => {
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

  // Both links are reachable with the keyboard, one after the other, and show the focus outline.
  await reportLink(page, "problem").focus();
  await page.keyboard.press("Shift+Tab");
  for (const kind of KINDS) {
    await page.keyboard.press("Tab");
    const link = reportLink(page, kind);
    await expect(link).toBeFocused();
    expect(await link.evaluate((element) => getComputedStyle(element).outline)).toContain("3px");
  }
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

test("the result screen links to both forms with the game and its last turn", async ({ page }) => {
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

test("at 390 px both links fit the footer and cover no control of the table", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await script(page, { pending: buildPending });
  await expect(page.getByRole("region", { name: "Opponents" })).toBeVisible();
  const boxes: { left: number; right: number; top: number; bottom: number }[] = [];
  for (const kind of KINDS) {
    const link = reportLink(page, kind);
    await expect(link).toBeVisible();
    const measured = await link.evaluate((element) => {
      const mine = element.getBoundingClientRect();
      const footer = element.closest("footer")?.getBoundingClientRect();
      const inside =
        footer !== undefined &&
        mine.left >= 0 &&
        mine.right <= window.innerWidth &&
        mine.top >= footer.top &&
        mine.bottom <= footer.bottom;
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
      // The whole label shows: the link is not squeezed or clipped.
      const whole = element.scrollWidth <= element.clientWidth + 1 && mine.height >= 24;
      const box = { left: mine.left, right: mine.right, top: mine.top, bottom: mine.bottom };
      return { box, inside, hit: hit.length, onTop: centre === element, whole };
    });
    const { box, ...checks } = measured;
    expect(checks, kind).toEqual({ inside: true, hit: 0, onTop: true, whole: true });
    boxes.push(box);
  }
  const [first, second] = boxes;
  const apart =
    first.right <= second.left ||
    second.right <= first.left ||
    first.bottom <= second.top ||
    second.bottom <= first.top;
  expect(apart).toBe(true);
  await expect(page.getByText("Version dev")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
