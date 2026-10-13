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

/** Each region's box, the page's scroll size, the board's scroll range and each opponent's box. */
async function measure(page: Page) {
  return await page.evaluate(() => {
    const region = (name: string) => {
      const element = document.querySelector(`section[aria-label="${name}"]`);
      if (element === null) throw new Error(`no ${name}`);
      return element;
    };
    const box = (element: Element) => {
      const { top, bottom, left, right, width, height } = element.getBoundingClientRect();
      return { top, bottom, left, right, width, height, area: width * height };
    };
    const board = region("Base").parentElement;
    if (board === null) throw new Error("no board");
    return {
      opponents: box(region("Opponents")),
      supply: box(region("Supply")),
      base: box(region("Base")),
      log: box(region("Log")),
      decision: box(region("Your decision")),
      hand: box(region("Your hand")),
      you: box(region("Ann (you)")),
      rail: [...region("Opponents").querySelectorAll("section[data-seat]")].map(box),
      groupsInHand: region("Your hand").querySelectorAll('[role="group"]').length,
      page: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
      boardRange: board.scrollHeight - board.clientHeight,
    };
  });
}

const WIDE = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

// From 1024 px wide: opponents in a rail on the left, Supply, Base, decision
// and hand in the centre, your counters above the Log on the right.
for (const { width, height } of [WIDE[0], { width: 1024, height: 768 }]) {
  test(`the picture table has three columns at ${String(width)}x${String(height)}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await showTable(page, 4, 0);
    const found = await measure(page);

    for (const centre of [found.supply, found.base, found.decision, found.hand]) {
      expect(found.opponents.right).toBeLessThanOrEqual(centre.left + 0.5);
      expect(centre.right).toBeLessThanOrEqual(Math.min(found.you.left, found.log.left) + 0.5);
    }
    expect(found.supply.bottom).toBeLessThanOrEqual(found.base.top + 0.5);
    expect(found.base.bottom).toBeLessThanOrEqual(found.decision.top + 0.5);
    expect(found.decision.bottom).toBeLessThanOrEqual(found.hand.top + 0.5);
    expect(found.you.bottom).toBeLessThanOrEqual(found.log.top + 0.5);
    // The opponents are stacked: one left edge, each below the one before.
    expect(found.rail).toHaveLength(3);
    expect(new Set(found.rail.map((opponent) => opponent.left)).size).toBe(1);
    for (const [index, opponent] of found.rail.entries()) {
      if (index > 0) expect(opponent.top).toBeGreaterThanOrEqual(found.rail[index - 1].bottom);
    }
  });
}

test("below 1024 px wide the table keeps the stacked arrangement", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 720 });
  await showTable(page, 4, 0);
  const found = await measure(page);
  expect(found.opponents.bottom).toBeLessThanOrEqual(found.supply.top + 0.5);
  // Your counters lie right of the hand, in its row.
  expect(found.you.left).toBeGreaterThanOrEqual(found.hand.right - 0.5);
  expect(found.you.top).toBeLessThan(found.hand.bottom);
  expect(found.you.bottom).toBeGreaterThan(found.hand.top);
});

test("your counters lie above the Log and the hand row holds only cards", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await showTable(page, 4, 0);
  const found = await measure(page);
  expect(found.you.left).toBeGreaterThanOrEqual(found.log.left - 0.5);
  expect(found.you.right).toBeLessThanOrEqual(found.log.right + 0.5);
  expect(found.you.bottom).toBeLessThanOrEqual(found.log.top + 0.5);
  expect(Math.abs(found.hand.left - found.base.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(found.hand.right - found.base.right)).toBeLessThanOrEqual(1);
  expect(found.groupsInHand).toBe(0);
});

// The scene of the report: four players, seven Supply cards, the first Main
// Action of the game. The Base measured 832x151 px before the rails.
test("at 1280x720 with four players the Base has twice its old area", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await showTable(page, 4, 0, "", {
    pending: {
      id: "d2",
      seat: 0,
      kind: "main_action",
      options: [
        { id: "station-0:0", label: "Terran Outpost: Draft", card: "station-0", box: 0 },
        { id: "station-0:1", label: "Terran Outpost: Build", card: "station-0", box: 1 },
        { id: "station-0:2", label: "Terran Outpost: Resell x2, Draw", card: "station-0", box: 2 },
      ],
    },
  });
  const { base } = await measure(page);
  expect(base.area).toBeGreaterThanOrEqual(2 * 832 * 151);
  expect(Math.min(base.top, base.left)).toBeGreaterThanOrEqual(0);
  expect(base.bottom).toBeLessThanOrEqual(720);
  expect(base.right).toBeLessThanOrEqual(1280);
});

for (const { width, height } of WIDE.slice(1)) {
  test(`the whole Base is on screen at ${String(width)}x${String(height)}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await showTable(page, 4, 0);
    const found = await measure(page);
    expect(Math.min(found.base.top, found.base.left)).toBeGreaterThanOrEqual(0);
    expect(found.base.bottom).toBeLessThanOrEqual(height);
    expect(found.base.right).toBeLessThanOrEqual(width);
    expect(found.page.height).toBeLessThanOrEqual(height);
    expect(found.page.width).toBeLessThanOrEqual(width);
    expect(found.boardRange).toBeLessThanOrEqual(1);
  });
}

test("Supply is no taller in a tall window", async ({ page }) => {
  await page.setViewportSize(WIDE[0]);
  await showTable(page, 4, 0);
  const short = (await measure(page)).supply.height;
  for (const size of WIDE.slice(1)) {
    await page.setViewportSize(size);
    await expect
      .poll(async () => (await measure(page)).supply.height, { message: String(size.width) })
      .toBeLessThanOrEqual(short);
  }
});

test("a Supply card zooms and carries its option at 1440x900", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const decisions: { decision: string; option: string }[] = [];
  const pending = {
    id: "d4",
    seat: 0,
    kind: "draft",
    options: [{ id: "s0", card: "s0", label: "Draft Depot (first)" }],
  };
  await showTable(page, 4, 0, "", { pending }, decisions);
  const supply = page.getByRole("region", { name: "Supply" });

  await supply.locator('[data-card="s1"]').focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("dialog", { name: "Depot" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await supply.getByRole("button", { name: "Draft Depot (first)" }).click();
  await expect.poll(() => decisions).toEqual([{ decision: "d4", option: "s0" }]);
});

test("the picture table is as wide as the window at 1920x1080", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await showTable(page, 4, 0);
  const found = await measure(page);
  expect(found.opponents.left).toBeLessThanOrEqual(16);
  expect(found.log.right).toBeGreaterThanOrEqual(1904);
});

test("the plain table keeps 72rem at 1920x1080", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await showTable(page, 4, 0, "?plain=1");
  const main = await page.locator("main").boundingBox();
  expect(main?.width).toBeLessThanOrEqual(1152);
});

for (const { width, height } of WIDE) {
  test(`the Base is the largest region at ${String(width)}x${String(height)}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await showTable(page, 4, 0);
    const { base, opponents, supply, log, decision, hand, you } = await measure(page);
    for (const other of [opponents, supply, log, decision, hand, you]) {
      expect(base.area).toBeGreaterThan(other.area);
    }
  });
}

test("View Bea's Base shows it and Your Base returns", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await showTable(page, 4, 0);
  const heading = page.getByRole("region", { name: "Base" }).getByRole("heading");
  await page.getByRole("button", { name: "View Bea's Base" }).click();
  await expect(heading).toHaveText("Bea's Base");
  await page.getByRole("button", { name: "Your Base", exact: true }).click();
  await expect(heading).toHaveText("Your Base");
});

test("with six players the last opponent's target button sends its option at 1280x720", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const decisions: { decision: string; option: string }[] = [];
  const pending = {
    id: "d9",
    seat: 0,
    kind: "target",
    options: NAMES.slice(1).map((name, index) => ({
      id: `t${String(index + 1)}`,
      label: `Target ${name}`,
      target: index + 1,
    })),
  };
  await showTable(page, 6, 0, "", { pending }, decisions);
  await page
    .getByRole("region", { name: "Opponents" })
    .getByRole("button", { name: "Target Flo" })
    .click();
  await expect.poll(() => decisions).toEqual([{ decision: "d9", option: "t5" }]);
});

/** For each player in the rail: the pairs of its counters that overlap, and whether the rail shows all of it. */
async function measureRail(page: Page) {
  return await page.evaluate(() => {
    const rail = document.querySelector('section[aria-label="Opponents"]');
    if (rail === null) throw new Error("no Opponents");
    const clip = rail.getBoundingClientRect();
    return [...rail.querySelectorAll("section[data-seat]")].map((section) => {
      const { top, bottom } = section.getBoundingClientRect();
      const counters = [...section.querySelectorAll(':scope > div > [role="group"]')].map(
        (counter) => ({ name: counter.ariaLabel, box: counter.getBoundingClientRect() }),
      );
      const overlaps = counters.flatMap((one, index) =>
        counters
          .slice(index + 1)
          .filter(
            ({ box }) =>
              one.box.left < box.right &&
              box.left < one.box.right &&
              one.box.top < box.bottom &&
              box.top < one.box.bottom,
          )
          .map((other) => `${String(one.name)} and ${String(other.name)}`),
      );
      const shown = top >= clip.top && bottom <= clip.bottom;
      return { counters: counters.length, overlaps, shown };
    });
  });
}

// Credits, Colonists, Hand and Achievements, clear of each other and on screen.
const WHOLE = { counters: 4, overlaps: [], shown: true };
// Welfare raises the achievements target to 6: five icons are an ordinary
// count before a victory.
const FIVE_ICONS = {
  targets: { credits: 20, colonists: 10, achievements: 6 },
  players: NAMES.map((name, seat) =>
    player(seat, { name, achievements: ["atom", "dog", "rocket", "dna", "brain"], handSize: 3 }),
  ),
};

test("with six players five achievements do not reach the hand at 1280x720", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await showTable(page, 6, 0, "", FIVE_ICONS);
  expect(await measureRail(page)).toEqual(Array.from({ length: 5 }, () => WHOLE));
});

// A watcher has no seat: all six players are in the rail, one more than a
// player sees there. The heights are 720 and the first above each denser rail.
test("a watcher of six players sees every player's counters without scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await showTable(page, 6, 0, "", { ...FIVE_ICONS, you: null, hand: [], pending: null });
  for (const height of [720, 851, 1241]) {
    await page.setViewportSize({ width: 1280, height });
    await expect
      .poll(() => measureRail(page), { message: String(height) })
      .toEqual(Array.from({ length: 6 }, () => WHOLE));
  }
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

for (const { width, seats } of CASES.filter(({ events }) => events === 0)) {
  test(`Leave game and Help cover no table region and not each other at ${String(width)}x720 with ${String(seats)} seats`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 720 });
    await showTable(page, seats, 0);
    await expect(page.getByRole("button", { name: "Leave game", exact: true })).toBeVisible();

    const found = await page.evaluate(() => {
      const one = (selector: string, text?: string) => {
        const element = [...document.querySelectorAll(selector)].find(
          (candidate) => text === undefined || candidate.textContent === text,
        );
        if (element === undefined) throw new Error(`no ${selector} ${text ?? ""}`);
        return element;
      };
      // What is drawn of an element: its box, cut by every ancestor that clips.
      const drawn = (element: Element) => {
        let { top, bottom, left, right } = element.getBoundingClientRect();
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (getComputedStyle(parent).overflow === "visible") continue;
          const clip = parent.getBoundingClientRect();
          top = Math.max(top, clip.top);
          bottom = Math.min(bottom, clip.bottom);
          left = Math.max(left, clip.left);
          right = Math.min(right, clip.right);
        }
        return { top, bottom, left, right };
      };
      const buttons = [one("button", "Leave game"), one("button", "Help")];
      const regions = ["Opponents", "Supply", "Base", "Log", "Your decision", "Your hand"];
      return buttons.map((button) => {
        const { top, bottom, left, right } = button.getBoundingClientRect();
        const others = [
          ...buttons.filter((other) => other !== button),
          ...document.querySelectorAll("footer a"),
          ...[...regions, "Ann (you)"].map((name) => one(`section[aria-label="${name}"]`)),
        ];
        const overlapped = others.filter((element) => {
          const box = drawn(element);
          return box.left < right && left < box.right && box.top < bottom && top < box.bottom;
        });
        return {
          name: button.textContent,
          box: { top, bottom, left, right },
          overlapped: overlapped.map((element) => element.ariaLabel ?? element.textContent),
          onTop: document.elementFromPoint((left + right) / 2, (top + bottom) / 2) === button,
          page: document.documentElement.scrollHeight,
        };
      });
    });

    for (const button of found) {
      expect(button.overlapped, `${button.name} overlaps`).toEqual([]);
      expect(button.onTop, `${button.name} is on top`).toBe(true);
      expect(Math.min(button.box.top, button.box.left)).toBeGreaterThanOrEqual(0);
      expect(button.box.right).toBeLessThanOrEqual(width);
      expect(Math.max(button.box.bottom, button.page)).toBeLessThanOrEqual(720);
    }
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
  // A window where the board scrolls: the zoom must not move it. Under 1024 px
  // wide the stacked table still has such a board; at 1280x600 the Base
  // shrinks instead and nothing scrolls.
  await page.setViewportSize({ width: 1000, height: 600 });
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
