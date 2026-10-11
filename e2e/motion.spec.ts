import type { Page, WebSocketRoute } from "@playwright/test";
import type { GameView } from "../src/protocol/messages.ts";
import { player, view } from "../src/client/testing/view-fixture.ts";
import { expect, test } from "./fixtures.ts";

// Card motion against real layout: the mounted client, Chromium, 1280x720.
// The unit tests mock fixed boxes; these watch where a moving card really is.

interface Frame {
  readonly ghost: { left: number; top: number; width: number; height: number } | null;
  readonly landed: { left: number; top: number; width: number; height: number } | null;
}

const card = { instance: "c-1", cardId: "mod-depot" };

async function open(page: Page, first: GameView): Promise<WebSocketRoute> {
  const held: { socket?: WebSocketRoute } = {};
  await page.routeWebSocket("**/ws", (route) => {
    held.socket = route;
    route.onMessage((raw) => {
      if ((JSON.parse(String(raw)) as { type: string }).type !== "hello") return;
      route.send(
        JSON.stringify({
          type: "welcome",
          protocol: 1,
          token: "0123456789abcdef0123456789abcdef",
          name: "Ann",
          jev: false,
        }),
      );
      route.send(
        JSON.stringify({ type: "game.update", game: "g1", seq: 1, view: first, events: [] }),
      );
    });
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Name" }).fill("Ann");
  await page.getByRole("button", { name: "Enter the lobby" }).click();
  await expect(page.getByRole("region", { name: "Opponents" })).toBeVisible();
  await page.waitForFunction(() => [...document.images].every((image) => image.complete));
  if (held.socket === undefined) throw new Error("the client never connected");
  return held.socket;
}

function send(socket: WebSocketRoute, seq: number, state: GameView, events: unknown[]): void {
  socket.send(JSON.stringify({ type: "game.update", game: "g1", seq, view: state, events }));
}

/** Sample, every frame, the ghost's box and the box of the card it is flying to. */
async function watch(page: Page, instance: string): Promise<void> {
  await page.evaluate((id) => {
    const frames: Frame[] = [];
    const box = (element: Element | null) => {
      if (element === null) return null;
      const { left, top, width, height } = element.getBoundingClientRect();
      return { left, top, width, height };
    };
    const sample = () => {
      frames.push({
        ghost: box(document.querySelector("[data-motion-ghost]")),
        landed: box(document.querySelector(`[data-card="${id}"]`)),
      });
      if (frames.length < 60) requestAnimationFrame(sample);
    };
    (window as unknown as { frames: Frame[] }).frames = frames;
    requestAnimationFrame(sample);
  }, instance);
}

async function frames(page: Page): Promise<Frame[]> {
  await page.waitForTimeout(700);
  return await page.evaluate(() => (window as unknown as { frames: Frame[] }).frames);
}

const built = (x: number) => ({ ...card, x, y: 0, q: 0 as const });

test("a built Module flies from the hand to the Base box it lands in, unclipped", async ({
  page,
}) => {
  const station = player(0).base.station;
  const orbs = player(0).base.orbs;
  const socket = await open(
    page,
    view({ players: [player(0), player(1)], hand: [card], supply: [], deck: 40 }),
  );
  const hand = await page
    .getByRole("region", { name: "Your hand" })
    .getByRole("button")
    .boundingBox();
  if (hand === null) throw new Error("no card in the hand");
  await watch(page, "c-1");
  send(
    socket,
    2,
    view({
      players: [player(0, { base: { station, modules: [built(1)], orbs } }), player(1)],
      hand: [],
      supply: [],
      deck: 40,
    }),
    [{ type: "module_built", seat: 0, card, x: 1, y: 0, q: 0, cost: 1, text: "Ann builds Depot." }],
  );
  const seen = await frames(page);
  const flying = seen.filter((frame) => frame.ghost !== null);
  expect(flying.length, "a ghost flew").toBeGreaterThan(3);
  const first = flying[0]?.ghost;
  const last = flying[flying.length - 1]?.ghost;
  const final = seen[seen.length - 1]?.landed;
  if (!first || !last || !final) throw new Error("no frames");
  // It starts on the hand card's box, in screen space.
  expect(Math.abs(first.left - hand.x)).toBeLessThan(40);
  expect(Math.abs(first.top - hand.y)).toBeLessThan(40);
  // It arrives where the card is drawn once layout has settled.
  expect(Math.abs(last.left - final.left)).toBeLessThan(2);
  expect(Math.abs(last.top - final.top)).toBeLessThan(2);
  expect(Math.abs(last.width - final.width)).toBeLessThan(2);
  // The ghost lives on the body, outside the Base view that clips, so it is never cut off.
  expect(
    await page.evaluate(() => document.querySelector("[data-motion-ghost]")),
    "the ghost is gone",
  ).toBeNull();
  const left = await page.locator('[data-card="c-1"]').evaluate((element) => ({
    visibility: (element as HTMLElement).style.visibility,
    transform: (element as HTMLElement).style.transform,
  }));
  expect(left).toEqual({ visibility: "", transform: "" });
});

test("an opponent's resold card leaves from the opponent's panel", async ({ page }) => {
  const hidden = { instance: "op-1", cardId: "mod-depot" };
  const socket = await open(
    page,
    view({ players: [player(0), player(1, { handSize: 3 })], hand: [], supply: [], deck: 40 }),
  );
  const panel = await page.locator('[data-seat="1"]').boundingBox();
  if (panel === null) throw new Error("no opponent panel");
  await watch(page, "op-1");
  send(
    socket,
    2,
    view({
      players: [player(0), player(1, { handSize: 2 })],
      hand: [],
      supply: [],
      discard: [hidden],
      deck: 40,
    }),
    [{ type: "card_resold", seat: 1, card: hidden, text: "Bea resells Depot." }],
  );
  const flying = (await frames(page)).filter((frame) => frame.ghost !== null);
  expect(flying.length, "a ghost flew").toBeGreaterThan(3);
  const first = flying[0]?.ghost;
  if (!first) throw new Error("no ghost");
  expect(Math.abs(first.left - panel.x)).toBeLessThan(panel.width);
  expect(Math.abs(first.top - panel.y)).toBeLessThan(panel.height);
});
