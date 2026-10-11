import { describe, expect, it } from "vitest";
import { deckCards } from "../catalogue.ts";
import { ask } from "../decisions.ts";
import { gameRegistry } from "../game.ts";
import { applyChoice, push, run, type Registry } from "../loop.ts";
import { dealGame } from "../setup.ts";
import type { GameState } from "../state.ts";
import { buildState } from "../testing/build.ts";
import { pushTurn } from "../turn.ts";
import { pushAction } from "./index.ts";

const config = { seats: 3, startingSeat: 0, influences: false, kickstarter: false } as const;
const registry: Registry = {
  ...gameRegistry,
  handlers: {
    ...gameRegistry.handlers,
    stop: (state) => ({
      state: ask(state, {
        seat: 0,
        kind: "finished",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      }),
    }),
  },
};

function game(supply = ["a", "b", "c"], seats = 3): GameState {
  const built = buildState(Array.from({ length: seats }, () => ({ station: "stn-shackleton" })));
  return {
    ...dealGame({ ...config, seats }, "opponent-resells"),
    ...built,
    cards: {
      ...built.cards,
      a: "agt-investor",
      b: "mod-inflatable-habitat",
      c: "mod-bacon-printer",
      influence: "inf-quarantine",
      dome: "mod-hayashi-dome",
      market: "agt-market-manipulator",
    },
    hands: Array.from({ length: seats }, () => []),
    credits: Array<number>(seats).fill(0),
    deck: [],
    supply,
    discard: [],
    removedStations: [],
  };
}

function choose(state: GameState, option: string, rules = registry) {
  const pending = state.pending;
  if (!pending) throw new Error("Expected decision");
  const result = applyChoice(state, { seat: pending.seat, decision: pending.id, option }, rules);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

function resells(state: GameState, seat = 0) {
  return run(pushAction(push(state, "stop"), { op: "opponent_resells", n: 2 }, seat), registry);
}

describe("R7.10: An opponent Resells", () => {
  it("after a Dome is built, the chosen opponent makes two D8 decisions and gains both Credits", () => {
    const start = { ...game(), hands: [["dome"], [], []], credits: [3, 0, 0] };
    const main = run(pushTurn(start), gameRegistry).state;
    const box = main.pending?.options.find((option) => option.label === "Terran Outpost: Build");
    if (!box) throw new Error("Expected Build box");
    const building = choose(main, box.id, gameRegistry).state;
    const placement = building.pending?.options.find((option) => option.card === "dome");
    if (!placement) throw new Error("Expected Dome placement");
    const built = choose(building, placement.id, gameRegistry);
    expect(built.events.some((event) => event.type === "module_built")).toBe(true);
    expect(built.state.pending).toMatchObject({ seat: 0, kind: "target" });
    const balance = built.state.credits[0];
    const first = choose(built.state, "1", gameRegistry).state;
    expect(first.pending).toMatchObject({ seat: 1, kind: "resell" });
    expect(first.turn.seat).toBe(0);
    const second = choose(first, "a", gameRegistry);
    expect(second.state.pending).toMatchObject({ seat: 1, kind: "resell" });
    expect(second.state.credits).toEqual([balance, 1, 0]);
    const done = choose(second.state, "b", gameRegistry);
    expect(done.state.credits).toEqual([balance, 2, 0]);
    expect(
      [...second.events, ...done.events].filter((event) => event.type === "card_resold"),
    ).toMatchObject([
      { seat: 1, credits: 1 },
      { seat: 1, credits: 1 },
    ]);
  });

  it.each([{ supply: [] }, { supply: ["influence"] }])(
    "still asks D9 with no eligible Supply cards: $supply",
    ({ supply }) => {
      const start = game(supply);
      const before = structuredClone(start);
      const asked = resells(start, 2).state;
      expect(asked.pending).toMatchObject({ seat: 2, kind: "target" });
      expect(asked.pending?.options.map((option) => option.target)).toEqual([0, 1]);
      const done = choose(asked, "0");
      expect(done.state.pending?.kind).toBe("finished");
      expect(done.state.credits).toEqual([0, 0, 0]);
      expect(done.state.supply).toEqual(supply);
      expect(done.events).toEqual([]);
      expect(start).toEqual(before);
    },
  );

  it.each(["a", "b"])(
    "Resells the sole Agent or Module %s once, skipping the second Resell",
    (card) => {
      const asked = resells(game([card, "influence"])).state;
      const done = choose(asked, "2");
      expect(done.state.pending?.kind).toBe("finished");
      expect(done.state.credits).toEqual([0, 0, 1]);
      expect(done.state.supply).toEqual(["influence"]);
      expect(done.state.discard).toEqual([card]);
      expect(done.events).toMatchObject([{ type: "card_resold", seat: 2, credits: 1 }]);
    },
  );

  it("auto-selects the sole opponent, rejects the active seat, and replays a saved D8", () => {
    const asked = resells(game(undefined, 2)).state;
    expect(asked.pending).toMatchObject({ seat: 1, kind: "resell" });
    const pending = asked.pending;
    if (!pending) throw new Error("Expected Resell decision");
    expect(
      applyChoice(asked, { seat: 0, decision: pending.id, option: "a" }, registry),
    ).toMatchObject({ ok: false, error: { code: "wrong_seat" } });
    const before = structuredClone(asked);
    const result = choose(asked, "a");
    expect(choose(JSON.parse(JSON.stringify(asked)) as GameState, "a")).toEqual(result);
    expect(asked).toEqual(before);
  });

  it("checks the opponent's victory after the first Resell before doing the second", () => {
    const start = { ...game(undefined, 2), credits: [0, 19] };
    const done = choose(resells(start).state, "a");
    expect(done.state.result?.winners).toEqual([1]);
    expect(done.state.credits).toEqual([0, 20]);
    expect(done.state.supply).toEqual(["b", "c"]);
    expect(done.events.map((event) => event.type)).toEqual(["card_resold", "game_ended"]);
  });
});

it("Q16: Market Manipulator chooses the Reselling opponent and Steal victim separately", () => {
  const start = game(["a", "b", "c", "d", "e"]);
  const state = {
    ...start,
    cards: { ...start.cards, d: "agt-investor", e: "mod-bacon-printer" },
    hands: [["market"], [], []],
    credits: [5, 0, 4],
  };
  let current = choose(run(pushTurn(state), gameRegistry).state, "market", gameRegistry).state;
  expect(current.pending).toMatchObject({ seat: 0, kind: "resell" });
  current = choose(current, "a", gameRegistry).state;
  current = choose(current, "b", gameRegistry).state;
  expect(current.pending).toMatchObject({ seat: 0, kind: "target" });
  const resellDecision = current.pending?.id;
  current = choose(current, "1", gameRegistry).state;
  expect(current.pending).toMatchObject({ seat: 1, kind: "resell" });
  current = choose(current, "c", gameRegistry).state;
  current = choose(current, "d", gameRegistry).state;
  expect(current.credits).toEqual([2, 2, 4]);
  expect(current.pending).toMatchObject({ seat: 0, kind: "target" });
  expect(current.pending?.id).not.toBe(resellDecision);
  const done = choose(current, "2", gameRegistry);
  expect(done.state.credits).toEqual([5, 2, 1]);
  expect(done.events).toContainEqual({ type: "credits_stolen", thief: 0, victim: 2, amount: 3 });
});

it("admits all four Domes and Rovers, Asteroid Grinder, and Market Manipulator to the Deck", () => {
  const deck = deckCards(config);
  for (const id of [
    "mod-chandrasekhar-dome",
    "mod-hayashi-dome",
    "mod-oort-dome",
    "mod-struve-dome",
    "mod-rover-1",
    "mod-rover-2",
    "mod-rover-3",
    "mod-rover-4",
    "mod-asteroid-grinder",
    "agt-market-manipulator",
  ])
    expect(deck).toContain(id);
});
