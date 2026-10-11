import type { Page } from "@playwright/test";
import type { GameView } from "../src/protocol/messages.ts";
import { buildPending, player, view } from "../src/client/testing/view-fixture.ts";
import { expect, test } from "./fixtures.ts";

// The picture table draws a scripted game over the real built client: the
// socket is answered by the spec, so the table can be shown with any seats
// and any length of log.
const NAMES = ["Ann", "Bea", "Cy", "Dee", "Eve", "Flo"];

async function showTable(
  page: Page,
  seats: number,
  events: number,
  query = "",
  scripted: Partial<GameView> = {},
  decisions: { decision: string; option: string }[] = [],
): Promise<void> {
  const state = view({
    config: { seats, influences: false, kickstarter: false },
    players: Array.from({ length: seats }, (_, seat) =>
      player(seat, {
        name: NAMES[seat],
        credits: 7,
        colonists: 4,
        achievements: ["atom", "dog"],
        handSize: 3,
      }),
    ),
    hand: Array.from({ length: 3 }, (_, i) => ({ instance: `h${String(i)}`, cardId: "mod-depot" })),
    supply: Array.from({ length: seats + 3 }, (_, i) => ({
      instance: `s${String(i)}`,
      cardId: "mod-depot",
    })),
    pending: buildPending,
    ...scripted,
  });
  const log = Array.from({ length: events }, (_, i) => ({
    type: "turn_started",
    seat: i % seats,
    turn: i + 1,
    text: `Player ${String((i % seats) + 1)} started turn ${String(i + 1)}.`,
  }));
  await page.routeWebSocket("**/ws", (socket) => {
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as {
        type: string;
        decision?: string;
        option?: string;
      };
      if (message.type === "game.decide" && message.decision && message.option) {
        decisions.push({ decision: message.decision, option: message.option });
      }
      if (message.type !== "hello") return;
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
        JSON.stringify({ type: "game.update", game: "g1", seq: 1, view: state, events: log }),
      );
    });
  });
  await page.goto(`./${query}`);
  await page.getByRole("textbox", { name: "Name" }).fill("Ann");
  await page.getByRole("button", { name: "Enter the lobby" }).click();
  const ready =
    query === ""
      ? page.getByRole("region", { name: "Opponents" })
      : page.getByRole("button", { name: "Do not Build", exact: true });
  await expect(ready).toBeVisible();
  await page.waitForFunction(() => [...document.images].every((image) => image.complete));
}

test("a mouse click on a candidate Module sends its D11 option", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  const decisions: { decision: string; option: string }[] = [];
  await showTable(
    page,
    3,
    0,
    "",
    {
      players: [
        player(0, { name: "Ann" }),
        player(1, {
          name: "Bea",
          base: {
            ...player(1).base,
            modules: [{ instance: "candidate", cardId: "mod-depot", x: 1, y: 0, q: 0 }],
          },
        }),
        player(2, { name: "Cy" }),
      ],
      pending: {
        id: "steal",
        seat: 0,
        kind: "steal_module",
        options: [
          {
            id: "candidate",
            label: "Steal Depot at 1,0 from Player 2",
            card: "candidate",
            target: 1,
          },
        ],
      },
    },
    decisions,
  );
  await page.getByRole("button", { name: "Steal Depot at 1,0 from Player 2" }).click();
  await expect.poll(() => decisions).toEqual([{ decision: "steal", option: "candidate" }]);
});

test("a selected Station has a visible state before confirmation", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await showTable(page, 3, 0, "", {
    pending: {
      id: "flip",
      seat: 0,
      kind: "flip",
      options: [
        { id: "0", label: "Flip no Stations", seats: [] },
        { id: "1", label: "Flip Player 1's Station", seats: [0] },
        { id: "2", label: "Flip Player 2's Station", seats: [1] },
        { id: "3", label: "Flip Players 1 and 2's Stations", seats: [0, 1] },
      ],
    },
  });
  const station = page.getByRole("button", { name: "Player 2's Station" });
  const before = await station.evaluate((element) => getComputedStyle(element).backgroundColor);
  await station.click();
  await expect(station).toHaveAttribute("aria-pressed", "true");
  const after = await station.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(after).not.toBe(before);
});

const CASES = [
  { width: 1280, seats: 3, events: 0 },
  { width: 1280, seats: 3, events: 200 },
  { width: 1024, seats: 6, events: 0 },
  { width: 1024, seats: 6, events: 200 },
];

for (const { width, seats, events } of CASES) {
  test(`the table fits ${String(width)}x720 with ${String(seats)} seats and ${String(events)} log events`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 720 });
    await showTable(page, seats, events);

    const metrics = await page.evaluate(() => {
      const box = (selector: string) => {
        const element = document.querySelector(selector);
        if (element === null) throw new Error(`no ${selector}`);
        const { top, bottom, left, right } = element.getBoundingClientRect();
        return { top, bottom, left, right };
      };
      const log = document.querySelector('section[aria-label="Log"]');
      return {
        page: document.documentElement.scrollHeight,
        wide: document.documentElement.scrollWidth,
        opponents: box('section[aria-label="Opponents"]'),
        decision: box('section[aria-label="Your decision"]'),
        mine: box('section[aria-label="Ann (you)"]'),
        log: box('section[aria-label="Log"]'),
        logScrolls: log === null ? false : log.scrollHeight > log.clientHeight,
      };
    });

    // Nothing is below the window: the page itself does not scroll.
    expect(metrics.page).toBeLessThanOrEqual(720);
    expect(metrics.wide).toBeLessThanOrEqual(width);
    // Public counters, the decision and your own counters are all on screen.
    expect(metrics.opponents.top).toBeGreaterThanOrEqual(0);
    expect(metrics.opponents.bottom).toBeLessThanOrEqual(720);
    expect(metrics.decision.bottom).toBeLessThanOrEqual(720);
    expect(metrics.mine.bottom).toBeLessThanOrEqual(720);
    expect(metrics.mine.right).toBeLessThanOrEqual(width);
    expect(metrics.log.bottom).toBeLessThanOrEqual(720);
    // A long log scrolls inside its column.
    if (events > 0) expect(metrics.logScrolls).toBe(true);

    // Every opponent's counters are visible without scrolling.
    for (const name of NAMES.slice(1, seats)) {
      await expect(page.getByRole("group", { name, exact: true })).toBeInViewport();
    }
    // The decision can be answered where it is.
    await expect(page.getByRole("button", { name: "Do not Build", exact: true })).toBeInViewport();
  });
}

// D2 groups the Main Action boxes by card; the bar must not take the board's room.
for (const width of [1024, 1280]) {
  test(`a D2 decision leaves the Base board usable at ${String(width)}x720`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    const base = {
      station: {
        instance: "station-0",
        cardId: "stn-terran-outpost",
        side: "terran_outpost" as const,
        named: null,
        revealed: false,
      },
      modules: [{ instance: "m-fr", cardId: "mod-fusion-reactor", x: -1, y: 0, q: 0 as const }],
      orbs: { red: 0, blue: 0, yellow: 0, wild: 0 },
    };
    await showTable(page, 3, 0, "", {
      players: Array.from({ length: 3 }, (_, seat) =>
        player(seat, { name: NAMES[seat], handSize: 3, ...(seat === 0 ? { base } : {}) }),
      ),
      pending: {
        id: "d2",
        seat: 0,
        kind: "main_action",
        options: [
          { id: "station-0:0", label: "Terran Outpost: Draft", card: "station-0", box: 0 },
          { id: "station-0:1", label: "Terran Outpost: Build", card: "station-0", box: 1 },
          {
            id: "station-0:2",
            label: "Terran Outpost: Resell x2, Draw",
            card: "station-0",
            box: 2,
          },
          { id: "m-fr:0", label: "Fusion Reactor: Build, Draw, Discard", card: "m-fr", box: 0 },
        ],
      },
    });
    await expect(
      page.getByRole("button", { name: "Fusion Reactor: Build, Draw, Discard" }),
    ).toBeInViewport();

    const board = await page.evaluate(() => {
      const element = document.querySelector('section[aria-label="Base"]')?.parentElement;
      if (element === null || element === undefined) throw new Error("no board");
      return { height: element.clientHeight, page: document.documentElement.scrollHeight };
    });
    // The board keeps the viewport the generic one-row bar leaves it (91px here),
    // not the 3px strip the vertical box list left; the page still fits.
    expect(board.height).toBeGreaterThanOrEqual(90);
    expect(board.page).toBeLessThanOrEqual(720);
  });
}

test("the plain table scrolls like a page to reach its decision", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await showTable(page, 3, 0, "?plain=1");
  const decision = page.getByRole("button", { name: "Do not Build", exact: true });
  await expect(decision).toBeVisible();

  // Ordinary user scrolling, not a programmatic scroll a click would do.
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, 1200);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(decision).toBeInViewport();
});

test("wheel zoom keeps the Base in place without a console error", async ({ page }) => {
  // A window short enough that the board scrolls: the zoom must not move it.
  await page.setViewportSize({ width: 1280, height: 600 });
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await showTable(page, 3, 0);
  const area = page.getByRole("region", { name: "Base" }).getByTestId("base-viewport");
  await area.scrollIntoViewIfNeeded();
  const board = page.locator('[aria-label="Base"]').locator("..");
  const beforeScroll = await board.evaluate((element) => element.scrollTop);
  expect(beforeScroll).toBeGreaterThan(0);
  const beforeScale = Number(await area.getAttribute("data-scale"));
  const box = await area.boundingBox();
  if (box === null) throw new Error("Base viewport has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -120);
  await expect
    .poll(async () => Number(await area.getAttribute("data-scale")))
    .toBeGreaterThan(beforeScale);
  expect(await board.evaluate((element) => element.scrollTop)).toBe(beforeScroll);
  expect(errors).toEqual([]);
});
