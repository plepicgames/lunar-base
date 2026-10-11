import { expect, test } from "vitest";
import { viewFor, type DecisionOption, type GameState } from "../../engine/index.ts";
import { pushAction } from "../../engine/actions/index.ts";
import { gameRegistry } from "../../engine/game.ts";
import { run } from "../../engine/loop.ts";
import { dealGame } from "../../engine/setup.ts";
import { buildState } from "../../engine/testing/build.ts";
import type { DecisionRequest } from "../maker.ts";
import { score } from "./index.ts";

function fixture(): GameState {
  const bases = buildState([
    { station: "ks-stn-kafka", side: "named" },
    { station: "ks-stn-tipu", side: "named" },
    { station: "ks-stn-braun", side: "named" },
  ]);
  return {
    ...dealGame({ seats: 3, influences: true, kickstarter: true, startingSeat: 0 }, "ks-maker"),
    ...bases,
    cards: {
      ...bases.cards,
      welfare: "ks-inf-welfare",
      cowboy: "inf-space-cowboy-capitalism",
      transparency: "ks-inf-transparency",
      rover: "mod-rover-1",
    },
    hands: [[], [], []],
    supply: [],
    deck: [],
    discard: [],
    play: [],
    credits: [6, 6, 6],
    stack: [],
    pending: null,
  };
}
function request(state: GameState, kind: string, options: DecisionOption[]): DecisionRequest {
  return {
    view: viewFor(state, 0),
    seat: 0,
    events: [],
    decision: { id: "test", seat: 0, kind, options },
  };
}

test("D14 values a Station that reaches the colonist target above other exchanges", () => {
  const state = run(pushAction(fixture(), { op: "exchange_station" }, 0), gameRegistry).state;
  if (!state.pending) throw new Error("Expected Kafka choice");
  const input = request(state, state.pending.kind, [...state.pending.options]);
  input.view = {
    ...input.view,
    players: input.view.players.map((p) => (p.seat === 0 ? { ...p, colonists: 8 } : p)),
  };
  expect(score(input, input.decision.options[0])).toBeGreaterThan(100_000);
  expect(score(input, input.decision.options[0])).toBeGreaterThan(
    score(input, input.decision.options[1]),
  );
});

test("D14 values distinct achievements and never guesses an unrevealed named face", () => {
  const state = fixture();
  const options = [
    { id: "1", label: "Exchange", target: 1 },
    { id: "2", label: "Exchange", target: 2 },
  ];
  const input = request(state, "exchange_station", options);
  input.view = {
    ...input.view,
    players: input.view.players.map((p) =>
      p.seat === 0 ? { ...p, achievements: ["dog", "atom", "dome", "satellite"] } : p,
    ),
  };
  expect(score(input, options[1])).toBeGreaterThan(score(input, options[0]));
  const hidden = {
    ...state,
    bases: state.bases.map((base, seat) =>
      seat === 1
        ? {
            ...base,
            station: { ...base.station, side: "terran_outpost" as const, revealed: false },
          }
        : base,
    ),
  };
  const changed = { ...hidden, cards: { ...hidden.cards, c2: "stn-dark-side" } };
  expect(score(request(hidden, "exchange_station", options), options[0])).toBe(
    score(request(changed, "exchange_station", options), options[0]),
  );
});

test("D4 charges the offered extra cost before evaluating Cowboy's victory", () => {
  const state = { ...fixture(), supply: ["welfare", "cowboy", "rover"], credits: [18, 6, 6] };
  const waiting = run(pushAction(state, { op: "draft", n: 1 }, 0), gameRegistry).state;
  if (!waiting.pending) throw new Error("Expected Draft");
  const input = request(waiting, "draft", [...waiting.pending.options]);
  const cowboy = input.decision.options.find((o) => o.card === "cowboy");
  if (!cowboy) throw new Error("Expected Cowboy Draft option");
  expect(cowboy.price).toBe(3);
  expect(score(input, cowboy)).toBeLessThan(100_000);
  expect(score(input, { ...cowboy, price: 0 })).toBeGreaterThan(100_000);
  const quiet = request({ ...state, supply: ["welfare", "rover"] }, "draft", []);
  expect(score(quiet, { id: "welfare", label: "Draft", card: "welfare", price: 3 })).toBeLessThan(
    score(quiet, { id: "rover", label: "Draft", card: "rover" }),
  );
});

test("Main Action excludes an unaffordable Influence Draft", () => {
  const state = { ...fixture(), supply: ["welfare"], credits: [0, 6, 6] };
  const draft = { id: "draft", label: "Draft", card: "c1", box: 0 };
  expect(score(request(state, "main_action", [draft]), draft)).toBe(0);
});

test("Draw uses the public top card and counts a hidden discard pile by size", () => {
  const state = fixture();
  const bases = buildState([
    { station: "stn-shackleton" },
    { station: "ks-stn-tipu" },
    { station: "ks-stn-braun" },
  ]);
  const drawState = {
    ...state,
    ...bases,
    cards: { ...state.cards, ...bases.cards },
    supply: ["transparency"],
    deck: ["rover"],
  };
  const draw = { id: "draw", label: "Draw", card: "c1", box: 2 };
  const input = request(drawState, "main_action", [draw]);
  const unseen = { ...input, view: { ...input.view, deckTop: null } };
  expect(score(input, draw)).toBeGreaterThan(score(unseen, draw));
  const recyclable = request({ ...drawState, deck: [], discard: ["rover"] }, "main_action", [draw]);
  expect(recyclable.view.discard).toEqual([]);
  expect(score(recyclable, draw)).toBe(3);

  // Selene Draws three: only the first identity is known, even with more cards available.
  const selene = {
    ...drawState,
    cards: { ...drawState.cards, c1: "stn-selene-labs" },
    bases: drawState.bases.map((base, seat) =>
      seat === 0 ? { ...base, station: { ...base.station, side: "named" as const } } : base,
    ),
  };
  const one = request(selene, "main_action", [draw]);
  const three = request({ ...selene, deck: ["rover", "cowboy", "welfare"] }, "main_action", [draw]);
  expect(score(three, draw) - score(one, draw)).toBe(6);
});
