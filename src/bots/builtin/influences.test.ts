import { expect, test } from "vitest";
import {
  viewFor,
  type ActionDef,
  type DecisionOption,
  type GameState,
} from "../../engine/index.ts";
import { gameRegistry } from "../../engine/game.ts";
import { pushImmediate } from "../../engine/influences/immediate.ts";
import { applyChoice, push, run } from "../../engine/loop.ts";
import { dealGame } from "../../engine/setup.ts";
import { buildState } from "../../engine/testing/build.ts";
import type { DecisionRequest } from "../maker.ts";
import { builtinMaker, score } from "./index.ts";

const ids = {
  alliance: "inf-lunar-alliance",
  quarantine: "inf-quarantine",
  embargo: "inf-terran-embargo",
  cascade: "inf-entropic-cascade",
  crackdown: "inf-terran-crackdown",
  cowboy: "inf-space-cowboy-capitalism",
  bureaucracy: "inf-runaway-bureaucracy",
  module: "mod-inflatable-habitat",
  agent: "agt-panaman-broker",
};
function fixture(hand = ["alliance", "module"], supply: string[] = []): GameState {
  const bases = buildState([
    { station: "stn-shackleton", modules: [["mod-inflatable-habitat", 1, 0, 0]] },
    { station: "stn-shackleton" },
  ]);
  return {
    ...dealGame(
      { seats: 2, influences: true, kickstarter: false, startingSeat: 0 },
      "influence-maker",
    ),
    ...bases,
    cards: { ...bases.cards, ...ids },
    hands: [hand, []],
    supply,
    deck: [],
    discard: [],
    credits: [6, 6],
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
function pending(state: GameState): DecisionRequest {
  if (!state.pending) throw new Error("Expected a decision");
  return {
    view: viewFor(state, state.pending.seat),
    seat: state.pending.seat,
    events: [],
    decision: state.pending,
  };
}
function defence(action: ActionDef, state = fixture()): DecisionRequest {
  let result = run(
    push(push(state, "agent", { seat: 1, card: "agent", actions: [], position: 0 }), "action", {
      seat: 1,
      action,
    }),
    gameRegistry,
  );
  if (result.state.pending?.kind !== "defence") {
    const d = result.state.pending;
    if (!d) throw new Error("Expected attacker choice");
    const option = d.options.find(
      (o) => o.target === 0 || (Array.isArray(o.seats) && o.seats.includes(0)),
    );
    if (!option) throw new Error("Expected target 0");
    const next = applyChoice(
      result.state,
      { seat: d.seat, decision: d.id, option: option.id },
      gameRegistry,
    );
    if (!next.ok) throw new Error(next.error.message);
    result = next;
  }
  expect(result.state.pending?.kind).toBe("defence");
  return pending(result.state);
}
const pick = (input: DecisionRequest) =>
  builtinMaker("influences", input.seat).decide(input, AbortSignal.abort());
const cardOptions = (cards: readonly string[]) =>
  cards.map((card) => ({ id: card, card, label: "Opaque" }));

test("D12 exposes the current public action and actor to the defending seat", () => {
  const input = defence({ op: "steal_credits", n: 3 });
  expect(input.view.pending).toMatchObject({
    options: [
      { action: { op: "steal_credits", n: 3 }, actor: 1 },
      { action: { op: "steal_credits", n: 3 }, actor: 1 },
    ],
  });
});

test("defends a Steal that gives the thief 20 Credits, including a one-Credit theft", async () => {
  const state = { ...fixture(), credits: [1, 19] };
  expect(await pick(defence({ op: "steal_credits", n: 3 }, state))).toBe("alliance");
});

test.each([
  [2, "decline"],
  [3, "alliance"],
])("defence threshold for losing %i Credits", async (n, expected) => {
  expect(await pick(defence({ op: "steal_credits", n }))).toBe(expected);
});

test("declines a Flip that only improves its Outpost", async () => {
  expect(await pick(defence({ op: "flip", who: "each_player" }))).toBe("decline");
});

test("defends its Module from theft", async () => {
  expect(await pick(defence({ op: "steal_module", kind: "inflatable_habitat" }))).toBe("alliance");
});

test("keeps three Influences with a fourth available unless the theft loses the game", async () => {
  const state = fixture(["alliance", "quarantine", "embargo"], ["cowboy"]);
  expect(await pick(defence({ op: "steal_credits", n: 3 }, state))).toBe("decline");
  expect(["alliance", "quarantine", "embargo"]).toContain(
    await pick(defence({ op: "steal_credits", n: 3 }, { ...state, credits: [3, 17] })),
  );
});

test("holding four Influences as the active player preserves all four when Discard has another option", async () => {
  const state = fixture(["alliance", "quarantine", "embargo", "cascade", "module"]);
  expect(await pick(request(state, "discard", cardOptions(state.hands[0])))).toBe("module");
});

test("Discard includes the Influence's own immediate effect", () => {
  const state = fixture(["alliance", "cascade"]);
  const input = request(
    { ...state, deck: ["module", "module", "module", "module"] },
    "discard",
    cardOptions(state.hands[0]),
  );
  expect(score(input, input.decision.options[1])).toBeGreaterThan(
    score(input, input.decision.options[0]),
  );
});

test("Draft values a fourth Influence and accounts for Bureaucracy including its own trigger", async () => {
  const state = fixture(["alliance", "quarantine", "embargo"], ["cowboy", "module"]);
  expect(await pick(request(state, "draft", cardOptions(state.supply)))).toBe("cowboy");
  const bare = fixture([], ["embargo", "module"]);
  const costly = fixture([], ["bureaucracy", "module"]);
  const a = request(bare, "draft", cardOptions(bare.supply));
  const b = request(costly, "draft", cardOptions(costly.supply));
  expect(score(b, b.decision.options[0])).toBeLessThan(score(a, a.decision.options[0]));
  expect(await pick(b)).toBe("module");
});

test("Drafting Alliance unblocks Cowboy's trigger, but another Influence does not", () => {
  const state = fixture([], ["alliance", "cowboy", "embargo"]);
  const input = request(state, "draft", cardOptions(state.supply));
  expect(score(input, input.decision.options[0])).toBeGreaterThan(
    score(input, input.decision.options[2]),
  );
});

test("D13 exposes resolving seat and actions, and takes an immediate credit win before a Discard", async () => {
  const state = { ...fixture(["alliance", "module"], ["cowboy", "bureaucracy"]), credits: [18, 6] };
  const input = pending(
    run(
      pushImmediate(state, [
        { card: "bureaucracy", seat: 0, actions: [{ op: "discard", n: 2 }] },
        { card: "cowboy", seat: 0, actions: [{ op: "steal_credits", n: 2 }] },
      ]),
      gameRegistry,
    ).state,
  );
  expect(input.view.pending).toMatchObject({
    options: [
      { actor: 0, actions: [{ op: "discard", n: 2 }] },
      { actor: 0, actions: [{ op: "steal_credits", n: 2 }] },
    ],
  });
  expect(await pick(input)).toBe("1");
});

test.each([
  { op: "steal_credits", n: 3 },
  { op: "steal_module", kind: "inflatable_habitat" },
] satisfies ActionDef[])(
  "four Influences on another seat's turn preserve the pending win against $op",
  async (action) => {
    const state = fixture(["alliance", "quarantine", "embargo", "cowboy"]);
    const input = defence(action, { ...state, turn: { ...state.turn, seat: 1 } });
    expect(await pick(input)).toBe("decline");
  },
);

test.each([
  { extra: [], supply: ["cowboy"] },
  { extra: ["module"], supply: ["cowboy"] },
  { extra: [], supply: [] },
])(
  "defends a forced Discard of two to retain more of hand $extra with Supply $supply",
  async ({ extra, supply }) => {
    const state = fixture(["alliance", "quarantine", "embargo", ...extra], supply);
    const input = defence(
      { op: "each_opponent_discards", n: 2 },
      { ...state, turn: { ...state.turn, seat: 1 } },
    );
    expect(["alliance", "quarantine", "embargo"]).toContain(await pick(input));
  },
);

test.each([
  { action: { op: "steal_credits", n: 3 }, credits: [3, 17] },
  { action: { op: "each_opponent_discards", n: 2 }, credits: [6, 6] },
] satisfies { action: ActionDef; credits: number[] }[])(
  "four Influences off-turn still defend against a win-losing $action.op",
  async ({ action, credits }) => {
    const state = fixture(["alliance", "quarantine", "embargo", "cowboy"]);
    const input = defence(action, { ...state, credits, turn: { ...state.turn, seat: 1 } });
    expect(state.hands[0]).toContain(await pick(input));
  },
);
