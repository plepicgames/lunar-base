import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import type { GameView } from "../src/protocol/messages.ts";
import { buildView } from "../src/client/testing/build-fixture.ts";
import { player, view } from "../src/client/testing/view-fixture.ts";
import { expect, test } from "./fixtures.ts";

// The table with the keyboard only, and its six regions at the two sizes the
// brief names. The spec answers the socket itself, so it can script a whole
// turn: the box, then the Build, then the next player's turn.
const SIZES = [
  { width: 1280, height: 720 },
  { width: 1024, height: 768 },
];

const NAMES = ["Ann", "Bea", "Cy"];
const SIX = ["Ann", "Bea", "Cy", "Di", "Ed", "Flo"];

function mainActionView(names: readonly string[] = NAMES, supply = 4): GameView {
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
  return view({
    config: { seats: names.length, influences: false, kickstarter: false },
    players: names.map((name, seat) =>
      player(seat, { name, handSize: 3, ...(seat === 0 ? { base } : {}) }),
    ),
    hand: [
      { instance: "c-1", cardId: "mod-depot" },
      { instance: "c-2", cardId: "mod-fusion-reactor" },
      { instance: "c-3", cardId: "agt-investor" },
    ],
    supply: Array.from({ length: supply }, (_, i) => ({
      instance: `s${String(i)}`,
      cardId: "mod-depot",
    })),
    pending: {
      id: "d2",
      seat: 0,
      kind: "main_action",
      options: [
        { id: "station-0:0", label: "Terran Outpost: Draft", card: "station-0", box: 0 },
        { id: "station-0:1", label: "Terran Outpost: Build", card: "station-0", box: 1 },
        { id: "m-fr:0", label: "Fusion Reactor: Build, Draw, Discard", card: "m-fr", box: 0 },
      ],
    },
  });
}

/** Answers the socket with `first`; a decision sent for `answers` is met with the next view. */
async function script(
  page: Page,
  first: GameView,
  answers: Partial<Record<string, GameView | { view: GameView; events: object[] }>> = {},
): Promise<{ id: string; option: string }[]> {
  const sent: { id: string; option: string }[] = [];
  let seq = 1;
  await page.routeWebSocket("**/ws", (socket) => {
    const update = (next: GameView, events: object[] = []) => {
      seq += 1;
      socket.send(JSON.stringify({ type: "game.update", game: "g1", seq, view: next, events }));
    };
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as {
        type: string;
        decision?: string;
        option?: string;
      };
      if (message.type === "game.decide" && message.decision && message.option) {
        sent.push({ id: message.decision, option: message.option });
        const next = answers[`${message.decision}:${message.option}`];
        if (next !== undefined) {
          if ("view" in next) update(next.view, next.events);
          else update(next);
        }
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
        JSON.stringify({ type: "game.update", game: "g1", seq, view: first, events: [] }),
      );
    });
  });
  return sent;
}

async function enter(page: Page, ready: string): Promise<void> {
  await page.goto("./");
  await page.getByRole("textbox", { name: "Name" }).fill("Ann");
  await page.getByRole("button", { name: "Enter the lobby" }).click();
  await expect(page.getByRole("button", { name: ready })).toBeVisible();
  await page.waitForFunction(() => [...document.images].every((image) => image.complete));
}

/** Presses Tab until the control with this name has the focus. */
async function tabTo(page: Page, name: string | RegExp): Promise<void> {
  const target = page.getByRole("button", { name });
  for (let press = 0; press < 80; press += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

/** The label of the table region that holds the focused control, or null. */
async function regionOfFocus(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    const names = ["Your decision", "Your hand", "Base", "Supply", "Opponents", "Log"];
    const region = document.activeElement?.closest("section[aria-label]");
    const label = region?.getAttribute("aria-label") ?? null;
    return label !== null && names.includes(label) ? label : null;
  });
}

test("a whole turn with the keyboard only: choose a box, Build with a place, confirm", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const sent = await script(page, mainActionView(), {
    "d2:station-0:1": buildView({
      players: NAMES.map((name, seat) => player(seat, { name })),
    }),
    "d6:c-1:1,0,3": view({
      players: NAMES.map((name, seat) => player(seat, { name })),
      pending: { seat: 1, kind: "main_action" },
    }),
  });
  await enter(page, "Terran Outpost: Build");

  // The decision is the first stop of the table.
  await page.keyboard.press("Tab");
  expect(await regionOfFocus(page)).toBe("Your decision");

  await tabTo(page, "Terran Outpost: Build");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Build Depot" })).toBeVisible();

  await tabTo(page, "Build Depot");
  await page.keyboard.press("Enter");
  const base = page.getByRole("region", { name: "Base" });
  await expect(base.getByRole("button", { name: "Place Depot at 1,-1" })).toBeFocused();

  await tabTo(page, "Place Depot at 1,0");
  await page.keyboard.press("Enter");
  await expect(base.getByRole("button", { name: "Turn Depot" })).toBeFocused();
  // Turn 1 of 3 is upright; two presses reach the third turn.
  await page.keyboard.press("r");
  await page.keyboard.press("r");

  await tabTo(page, /^Confirm: /);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Bea decides");

  expect(sent).toEqual([
    { id: "d2", option: "station-0:1" },
    { id: "d6", option: "c-1:1,0,3" },
  ]);
});

test("Tab goes from the decision to hand, Base, Supply, opponents and log", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await script(page, mainActionView());
  await enter(page, "Terran Outpost: Build");

  const seen: string[] = [];
  for (let press = 0; press < 80; press += 1) {
    await page.keyboard.press("Tab");
    const region = await regionOfFocus(page);
    if (region !== null && seen.at(-1) !== region) seen.push(region);
  }
  // Each region is entered once, in this order; a scrollable region the
  // browser makes focusable itself can only repeat a name, never reorder them.
  const order = ["Your decision", "Your hand", "Base", "Supply", "Opponents", "Log"];
  const first = [...new Set(seen)];
  expect(first).toEqual(order.filter((name) => first.includes(name)));
  expect(first.slice(0, 3)).toEqual(["Your decision", "Your hand", "Base"]);
});

test("a choice dialog keeps the focus inside while it is open", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const asked = view({
    players: NAMES.map((name, seat) => player(seat, { name })),
    pending: {
      id: "d3",
      seat: 0,
      kind: "choose_one",
      options: [
        { id: "0", label: "Draw x2", card: "c-1" },
        { id: "1", label: "Discard", card: "c-1" },
      ],
    },
  });
  const sent = await script(page, asked, {
    "d3:1": view({ players: NAMES.map((name, seat) => player(seat, { name })) }),
  });
  await enter(page, "Draw x2");
  const dialog = page.getByRole("dialog");
  await expect(page.getByRole("button", { name: "Draw x2" })).toBeFocused();

  // Tab and Shift+Tab wrap inside the dialog.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Discard" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Draw x2" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Discard" })).toBeFocused();
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);

  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  expect(sent).toEqual([{ id: "d3", option: "1" }]);
});

const SEATINGS = [
  { label: "three seats", names: NAMES, supply: 4 },
  { label: "six seats", names: SIX, supply: 9 },
];

/** True while the focused element is inside the dialog with this name. */
async function focusInDialog(page: Page, name: string | RegExp): Promise<boolean> {
  return await page.getByRole("dialog", { name }).evaluate((dialog) => {
    return dialog === document.activeElement || dialog.contains(document.activeElement);
  });
}

/** Tab and Shift+Tab around the dialog; the focus never leaves it. */
async function expectContained(page: Page, name: string | RegExp): Promise<void> {
  for (const key of ["Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
    await page.keyboard.press(key);
    expect(await focusInDialog(page, name), `${key} stays in the ${String(name)} dialog`).toBe(
      true,
    );
  }
}

test("a private hand takes the focus, keeps it, and gives it back on Escape", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await script(page, mainActionView(), {
    "d2:station-0:0": {
      view: mainActionView(),
      events: [
        {
          type: "hand_seen",
          looker: 0,
          opponent: 1,
          cards: [
            { instance: "b1", cardId: "mod-depot" },
            { instance: "b2", cardId: "agt-investor" },
          ],
          text: "Ann looked at Bea's hand: Depot, Investor.",
        },
      ],
    },
  });
  await enter(page, "Terran Outpost: Draft");
  await tabTo(page, "Terran Outpost: Draft");
  await page.keyboard.press("Enter");

  const name = "Bea's hand";
  await expect(page.getByRole("dialog", { name })).toBeVisible();
  expect(await focusInDialog(page, name)).toBe(true);
  await expectContained(page, name);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name })).toHaveCount(0);
  expect(await regionOfFocus(page)).toBe("Your decision");
});

test("a card opened from the log with the keyboard keeps the focus, then gives it back", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await script(page, mainActionView(), {
    "d2:station-0:0": {
      view: mainActionView(),
      events: [
        {
          type: "card_drawn",
          seat: 0,
          card: { instance: "c-9", cardId: "mod-depot" },
          text: "Ann drew Depot.",
        },
      ],
    },
  });
  await enter(page, "Terran Outpost: Draft");
  await tabTo(page, "Terran Outpost: Draft");
  await page.keyboard.press("Enter");

  const link = page.getByRole("region", { name: "Log" }).getByRole("button", { name: "Depot" });
  for (let press = 0; press < 80; press += 1) {
    if (await link.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(await focusInDialog(page, /Depot/)).toBe(true);
  await expectContained(page, /Depot/);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(link).toBeFocused();
});

test("a card zoomed with the space bar keeps the focus, then gives it back", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await script(page, mainActionView());
  await enter(page, "Terran Outpost: Build");

  const card = page.getByRole("region", { name: "Your hand" }).getByRole("button", {
    name: /Investor/,
  });
  for (let press = 0; press < 80; press += 1) {
    if (await card.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(card).toBeFocused();
  await page.keyboard.press("Space");
  const name = /Investor/;
  await expect(page.getByRole("dialog", { name })).toBeVisible();
  expect(await focusInDialog(page, name)).toBe(true);
  await expectContained(page, name);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name })).toHaveCount(0);
  await expect(card).toBeFocused();
});

for (const { width, height } of SIZES) {
  for (const seating of SEATINGS) {
    test(`the six regions do not overlap at ${String(width)}x${String(height)} with ${seating.label}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await script(page, mainActionView(seating.names, seating.supply));
      await enter(page, "Terran Outpost: Build");

      const boxes = await page.evaluate(() => {
        const names = ["Opponents", "Supply", "Base", "Log", "Your decision", "Your hand"];
        return names.map((name) => {
          const element = document.querySelector(`section[aria-label="${name}"]`);
          if (element === null) throw new Error(`no ${name}`);
          const { left, top, right, bottom } = element.getBoundingClientRect();
          return { name, left, top, right, bottom };
        });
      });
      expect(boxes).toHaveLength(6);
      for (const box of boxes) {
        expect(box.right - box.left, `${box.name} has width`).toBeGreaterThan(0);
        expect(box.bottom - box.top, `${box.name} has height`).toBeGreaterThan(0);
        expect(box.left, `${box.name} left`).toBeGreaterThanOrEqual(0);
        expect(box.right, `${box.name} right`).toBeLessThanOrEqual(width);
      }
      for (const [index, a] of boxes.entries()) {
        for (const b of boxes.slice(index + 1)) {
          const apart =
            a.right <= b.left + 0.5 ||
            b.right <= a.left + 0.5 ||
            a.bottom <= b.top + 0.5 ||
            b.bottom <= a.top + 0.5;
          expect(apart, `${a.name} and ${b.name} overlap`).toBe(true);
        }
      }

      // Nothing in the board is cut off: it holds its content without a scrollbar.
      expect(
        await page.evaluate(() => {
          const board = document.querySelector('section[aria-label="Base"]')?.parentElement;
          return board === null || board === undefined
            ? 0
            : board.scrollHeight - board.clientHeight;
        }),
        "the board holds the Base and Supply",
      ).toBeLessThanOrEqual(1);

      // The decision bar and every control in it lie inside the window.
      const bar = boxes.find((box) => box.name === "Your decision");
      if (bar === undefined) throw new Error("no decision bar");
      expect(bar.top).toBeGreaterThanOrEqual(0);
      expect(bar.bottom).toBeLessThanOrEqual(height);
      for (const button of await page
        .getByRole("region", { name: "Your decision" })
        .getByRole("button")
        .all()) {
        await expect(button).toBeInViewport({ ratio: 1 });
      }
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
        height,
      );

      // The screenshot goes to the ignored Playwright output directory.
      const dir = "test-results/screenshots";
      mkdirSync(dir, { recursive: true });
      const suffix = seating.names.length === 3 ? "" : "-six-seats";
      await page.screenshot({
        path: `${dir}/table-${String(width)}x${String(height)}${suffix}.png`,
      });
    });
  }
}
