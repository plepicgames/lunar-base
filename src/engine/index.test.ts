import { describe, expect, test } from "vitest";
import * as engine from "./index.ts";
import {
  applyChoice,
  createGame,
  eventFor,
  startGame,
  type Choice,
  type GameConfig,
} from "./index.ts";
import { dealGame } from "./setup.ts";

const config: GameConfig = { seats: 2, influences: false, kickstarter: false };

function firstChoice(state: engine.GameState, option = 0): Choice {
  const pending = state.pending;
  if (pending === null) throw new Error("No decision is pending");
  return { seat: pending.seat, decision: pending.id, option: pending.options[option].id };
}

test("the engine publishes game operations and pure visible-card evaluation helpers", () => {
  expect(Object.keys(engine).sort()).toEqual([
    "applyChoice",
    "catalogue",
    "createGame",
    "eventFor",
    "legalPlacements",
    "priceOf",
    "startGame",
    "viewFor",
  ]);
});

describe("createGame", () => {
  test("stops at the starting seat's D2 decision, with every box of Terran Outpost", () => {
    const state = createGame(config, "seed");
    expect(state.turn).toEqual({ number: 1, seat: state.turn.seat, step: "main_action", work: 4 });
    expect(state.result).toBeNull();
    expect(state.pending).toMatchObject({ id: "d1", seat: state.turn.seat, kind: "main_action" });
    const station = state.bases[state.turn.seat].station.card;
    expect(state.pending?.options).toEqual([
      { id: `${station}:0`, label: "Terran Outpost: Draft", card: station, box: 0 },
      { id: `${station}:1`, label: "Terran Outpost: Build", card: station, box: 1 },
      { id: `${station}:2`, label: "Terran Outpost: Resell x2, Draw", card: station, box: 2 },
    ]);
  });

  test("asks the seat that the config names as the starting seat (R3.2)", () => {
    for (const startingSeat of [0, 1, 2]) {
      const state = createGame({ ...config, seats: 3, startingSeat }, "seed");
      expect(state.turn.seat).toBe(startingSeat);
      expect(state.pending?.seat).toBe(startingSeat);
    }
  });

  test("keeps the deal of the setup and changes only what starting the turn changes", () => {
    const dealt = dealGame(config, "seed");
    const state = createGame(config, "seed");
    expect({
      ...state,
      turn: dealt.turn,
      stack: [],
      pending: null,
      counters: dealt.counters,
    }).toEqual(dealt);
    expect(state.stack.map((frame) => frame.kind)).toEqual(["turn", "main_action_step"]);
  });

  test("gives the same state for the same config and seed, and plain JSON", () => {
    const state = createGame(config, "seed");
    expect(createGame({ ...config }, "seed")).toStrictEqual(state);
    expect(JSON.parse(JSON.stringify(state))).toStrictEqual(state);
    expect(createGame(config, "another seed").cards).not.toEqual(state.cards);
  });

  test("throws for a config the setup rejects", () => {
    expect(() => createGame({ ...config, seats: 7 }, "seed")).toThrow("seats must be an integer");
  });

  test("R3.4, R3.8: starts a game with the 8 base Influences; the setup deal triggers nothing", () => {
    const options = { ...config, seats: 4, influences: true };
    let inHand = 0;
    let inSupply = 0;
    for (let i = 0; i < 20; i += 1) {
      const seed = `influences-${String(i)}`;
      const dealt = dealGame(options, seed);
      const { state, events } = startGame(options, seed);
      const influences = (zone: readonly string[]) =>
        zone.filter((id) => state.cards[id].startsWith("inf-")).length;
      inHand += influences(state.hands.flat());
      inSupply += influences(state.supply);
      expect(influences([...state.hands.flat(), ...state.supply, ...state.deck])).toBe(8);
      // Every card lies where the deal put it and nothing was resolved for it.
      expect(state).toMatchObject({
        hands: dealt.hands,
        supply: dealt.supply,
        deck: dealt.deck,
        discard: [],
        play: [],
        credits: [3, 3, 3, 3],
        bases: dealt.bases,
        result: null,
      });
      expect(events).toEqual([
        { type: "game_started", seats: 4, startingSeat: state.turn.seat },
        { type: "turn_started", seat: state.turn.seat, turn: 1 },
      ]);
      expect(state.pending).toMatchObject({ id: "d1", seat: state.turn.seat });
      expect(["agent", "main_action"]).toContain(state.pending?.kind);
    }
    expect(inHand).toBeGreaterThan(0);
    expect(inSupply).toBeGreaterThan(0);
  });

  test("startGame gives the same state with the events of the opening", () => {
    const { state, events } = startGame({ ...config, seats: 3 }, "seed");
    expect(state).toStrictEqual(createGame({ ...config, seats: 3 }, "seed"));
    expect(events).toEqual([
      { type: "game_started", seats: 3, startingSeat: state.turn.seat },
      { type: "turn_started", seat: state.turn.seat, turn: 1 },
    ]);
  });
});

describe("applyChoice", () => {
  test("applies a choice with the game's own handlers and runs to the next decision", () => {
    const state = createGame(config, "seed");
    const before = structuredClone(state);
    const result = applyChoice(state, firstChoice(state));
    expect(state).toStrictEqual(before);
    if (!result.ok) throw new Error(result.error.message);
    const station = state.bases[state.turn.seat].station.card;
    expect(result.events).toEqual([
      {
        type: "box_chosen",
        seat: state.turn.seat,
        card: { instance: station, cardId: "stn-terran-outpost" },
        box: 0,
      },
    ]);
    expect(result.state.pending).toMatchObject({ id: "d2", seat: state.turn.seat, kind: "draft" });
  });

  test("rejects a choice that is stale, from the wrong seat or not offered", () => {
    const state = createGame(config, "seed");
    const choice = firstChoice(state);
    const codes = [
      { ...choice, decision: "d9" },
      { ...choice, seat: 1 - choice.seat },
      { ...choice, option: "none" },
    ].map((bad) => {
      const result = applyChoice(state, bad);
      return result.ok ? "ok" : result.error.code;
    });
    expect(codes).toEqual(["stale_decision", "wrong_seat", "unknown_option"]);
  });
});

test("eventFor turns an event of applyChoice into what a seat is told", () => {
  const state = createGame(config, "seed");
  const result = applyChoice(state, firstChoice(state));
  if (!result.ok) throw new Error(result.error.message);
  expect(eventFor(result.events[0], null)).toMatchObject({
    type: "box_chosen",
    text: `Player ${String(state.turn.seat + 1)} chose box 1 on Terran Outpost.`,
  });
});
