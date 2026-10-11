import { describe, expect, it } from "vitest";
import { deckCards } from "../catalogue.ts";
import { ask } from "../decisions.ts";
import { eventFor } from "../events.ts";
import { gameRegistry } from "../game.ts";
import { applyChoice, push, run, type Registry } from "../loop.ts";
import { dealGame } from "../setup.ts";
import type { GameState } from "../state.ts";
import { buildState } from "../testing/build.ts";
import { pushTurn } from "../turn.ts";
import { pushAction } from "./index.ts";

const BASE = { seats: 2, influences: false, kickstarter: false } as const;
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

function game(credits: readonly number[]): GameState {
  const built = buildState(
    credits.map((_, seat) => ({
      station: seat === 0 ? "stn-imbrium" : "stn-shackleton",
      side: "named",
    })),
  );
  return {
    ...dealGame({ ...BASE, seats: credits.length, startingSeat: 0 }, "steal-credits"),
    ...built,
    credits,
    hands: credits.map(() => []),
    deck: [],
    supply: [],
    discard: [],
    removedStations: [],
  };
}

function choose(state: GameState, option: string, rules = registry) {
  const pending = state.pending;
  if (!pending) throw new Error("Expected a decision");
  const result = applyChoice(state, { seat: pending.seat, decision: pending.id, option }, rules);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

function steal(state: GameState, seat = 0, rules = registry) {
  return run(pushAction(push(state, "stop"), { op: "steal_credits", n: 3 }, seat), rules);
}

function imbrium(credits: readonly number[]) {
  const state = game(credits);
  const held: GameState = {
    ...state,
    cards: { ...state.cards, habitat: "mod-inflatable-habitat" },
    hands: [["habitat"], []],
  };
  const asked = run(pushTurn(held), gameRegistry).state;
  const box = asked.pending?.options.find(
    (item) => item.label === "Imbrium: Steal 3 Credits, Build",
  );
  if (!box) throw new Error("Expected Imbrium's box");
  return choose(asked, box.id, gameRegistry);
}

describe("R7.13 Steal Credits / D9", () => {
  it.each([
    { victim: 2, amount: 2, balances: [6, 0, 1] },
    { victim: 5, amount: 3, balances: [7, 2, 1] },
    { victim: 0, amount: 0, balances: [4, 0, 1] },
  ])(
    "takes $amount from a victim with $victim Credits and emits a public transfer",
    ({ victim, amount, balances }) => {
      const start = game([4, victim, 1]);
      const before = structuredClone(start);
      const asked = steal(start);
      expect(asked.state.pending).toMatchObject({ seat: 0, kind: "target" });
      expect(asked.state.pending?.options).toEqual([
        { id: "1", label: "Steal from Player 2", target: 1 },
        { id: "2", label: "Steal from Player 3", target: 2 },
      ]);
      expect(asked.events).toEqual([]);
      expect(asked.state.credits).toEqual([4, victim, 1]);
      const done = choose(asked.state, "1");
      expect(done.state.credits).toEqual(balances);
      expect(done.events).toEqual([{ type: "credits_stolen", thief: 0, victim: 1, amount }]);
      const event = done.events[0];
      for (const viewer of [null, 0, 1, 2]) {
        expect(eventFor(event, viewer)).toEqual({
          type: "credits_stolen",
          thief: 0,
          victim: 1,
          amount,
          text: `Player 1 stole ${String(amount)} Credits from Player 2.`,
        });
      }
      expect(start).toEqual(before);
      expect(choose(JSON.parse(JSON.stringify(asked.state)) as GameState, "1")).toEqual(done);
    },
  );

  it("asks the performing seat, excludes itself, and leaves unchosen balances alone", () => {
    const asked = steal(game([5, 0, 2]), 2).state;
    expect(asked.pending).toMatchObject({ seat: 2, kind: "target" });
    expect(asked.pending?.options.map((option) => option.id)).toEqual(["0", "1"]);
    const pending = asked.pending;
    if (!pending) throw new Error("Expected target choice");
    expect(
      applyChoice(asked, { seat: 2, decision: pending.id, option: "2" }, registry),
    ).toMatchObject({
      ok: false,
      error: { code: "unknown_option" },
    });
    const done = choose(asked, "0");
    expect(done.state.credits).toEqual([2, 0, 5]);
    expect(done.events).toEqual([{ type: "credits_stolen", thief: 2, victim: 0, amount: 3 }]);
  });

  it("R8.5: two seats auto-select the opponent and transfer the whole amount in one step", () => {
    const balances: (readonly number[])[] = [];
    const done = steal(game([4, 5]), 0, {
      ...registry,
      afterStep: (state, frame) => {
        if (frame.kind === "action" && state.pending === null) balances.push(state.credits);
        return gameRegistry.afterStep(state, frame);
      },
    });
    expect(done.state.pending?.kind).toBe("finished");
    expect(done.state.credits).toEqual([7, 2]);
    expect(balances).toEqual([[7, 2]]);
    expect(done.events).toEqual([{ type: "credits_stolen", thief: 0, victim: 1, amount: 3 }]);
  });
});

it("Imbrium's box Steals 3 Credits before asking to Build", () => {
  const stolen = imbrium([0, 5]);
  expect(stolen.events.map((event) => event.type)).toEqual(["box_chosen", "credits_stolen"]);
  expect(stolen.state.credits).toEqual([3, 2]);
  expect(stolen.state.pending?.kind).toBe("build");
  const placement = stolen.state.pending?.options.find((option) => option.card === "habitat");
  if (!placement) throw new Error("Expected a Build placement");
  const built = choose(stolen.state, placement.id, gameRegistry);
  expect(built.events.some((event) => event.type === "module_built")).toBe(true);
  expect(built.state.bases[0].modules).toContainEqual(expect.objectContaining({ card: "habitat" }));
});

it("R11.2: a Steal reaching 20 Credits wins at that step, before Imbrium's Build", () => {
  const done = imbrium([17, 5]);
  expect(done.state.credits).toEqual([20, 2]);
  expect(done.events.map((event) => event.type)).toEqual([
    "box_chosen",
    "credits_stolen",
    "game_ended",
  ]);
  expect(done.state.result).toEqual({ reason: "victory", winners: [0], scores: [1, 0] });
  expect(done.state.pending).toBeNull();
  expect(done.state.stack).toEqual([]);
  expect(done.state.hands[0]).toEqual(["habitat"]);
  expect(done.state.bases[0].modules).toEqual([]);
});

it("admits both Panaman Brokers, and Helium Factory since T038 supports Dark Side", () => {
  const deck = deckCards(BASE);
  expect(deck.filter((id) => id === "agt-panaman-broker")).toHaveLength(2);
  expect(deck.filter((id) => id === "mod-helium-factory")).toHaveLength(2);
});
