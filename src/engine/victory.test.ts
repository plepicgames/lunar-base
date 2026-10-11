import { describe, expect, it } from "vitest";
import { actionHandlers, pushAction } from "./actions/index.ts";
import { colonistsOf } from "./base.ts";
import { ask } from "./decisions.ts";
import { eventFor } from "./events.ts";
import { applyChoice, push, run, type Registry } from "./loop.ts";
import { dealGame } from "./setup.ts";
import type { GameState } from "./state.ts";
import { buildState, cardOfState, type BaseSpec, type ModuleSpec } from "./testing/build.ts";
import { pushTurn, turnHandlers } from "./turn.ts";
import { victoryAfterStep } from "./victory.ts";
import { viewFor } from "./view.ts";

const registry: Registry = { handlers: turnHandlers(actionHandlers), afterStep: victoryAfterStep };
const outpost: BaseSpec = { station: "stn-shackleton" };

// Disconnected Modules still count (R5.16); leave the Station free for Build.
const population: readonly ModuleSpec[] = [
  ["mod-indigo-egregore", -5, 0, 0],
  ["mod-underground-headquarters", -7, 0, 0],
  ["mod-inflatable-habitat", -9, 0, 0],
];
const nineColonists: BaseSpec = { ...outpost, side: "named", modules: population };
const tenColonists: BaseSpec = {
  ...nineColonists,
  modules: [...population, ["mod-depot", -11, 0, 0]],
};
const fiveAchievements: BaseSpec = {
  station: "stn-selene-labs",
  side: "named",
  modules: [
    ["mod-laika-memorial", -5, 0, 0],
    ["mod-rover-1", -7, 0, 0],
    ["mod-satellite-1", -9, 0, 0],
  ],
};

function game(specs: readonly BaseSpec[] = [outpost, outpost]): GameState {
  const built = buildState(specs);
  return {
    ...dealGame(
      { seats: specs.length, influences: false, kickstarter: false, startingSeat: 0 },
      "victory",
    ),
    ...built,
    cards: { ...built.cards, held: "mod-depot", spare: "mod-inflatable-habitat" },
    hands: specs.map(() => []),
    credits: specs.map(() => 3),
    deck: [],
    supply: [],
    discard: [],
  };
}

const influenceIds = [
  "inf-quarantine",
  "inf-lunar-alliance",
  "inf-entropic-cascade",
  "inf-terran-embargo",
  "inf-terran-crackdown",
] as const;

/** The first `count` Influences as instances i1, i2, ... and as the cards a reveal names. */
function influences(count: number) {
  const ids = influenceIds.slice(0, count);
  const revealed = ids.map((cardId, index) => ({ instance: `i${String(index + 1)}`, cardId }));
  return {
    cards: Object.fromEntries(revealed.map(({ instance, cardId }) => [instance, cardId])),
    hand: revealed.map(({ instance }) => instance),
    revealed,
  };
}

/** Puts `count` Influences in the hand of `seat`, after the cards it already holds. */
function holding(state: GameState, seat: number, count: number): GameState {
  const { cards, hand } = influences(count);
  return {
    ...state,
    cards: { ...state.cards, ...cards },
    hands: state.hands.map((held, owner) => (owner === seat ? [...held, ...hand] : held)),
  };
}

function check(state: GameState) {
  return run(pushTurn(state), registry);
}

function shuttle(state: GameState) {
  return run(
    push(
      push({ ...state, turn: { ...state.turn, step: "shuttle" } }, "turn", { begun: 3 }),
      "shuttle_step",
    ),
    registry,
  );
}

describe("R11.2: immediate victory", () => {
  it("ends a Build at 10 colonists before its On playing text can ask another Build", () => {
    const start = {
      ...game([nineColonists, outpost]),
      hands: [["held", "spare"], []],
    };
    expect(colonistsOf(start.bases[0], cardOfState(start))).toBe(9);
    const asked = run(pushAction(pushTurn(start), { op: "build", n: 1 }, 0), registry).state;
    const pending = asked.pending;
    const option = pending?.options.find(({ card }) => card === "held");
    if (!pending || !option) throw new Error("Expected a Depot Build option");
    const before = structuredClone(asked);
    const result = applyChoice(
      asked,
      { seat: 0, decision: pending.id, option: option.id },
      registry,
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(colonistsOf(result.state.bases[0], cardOfState(result.state))).toBe(10);
    expect(result.state.result).toEqual({ reason: "victory", winners: [0], scores: [1, 0] });
    expect(result.state.stack).toEqual([]);
    expect(result.state.pending).toBeNull();
    expect(result.state.hands[0]).toEqual(["spare"]);
    expect(result.state.counters.decisions).toBe(asked.counters.decisions);
    expect(result.events.map(({ type }) => type)).toEqual(["module_built", "game_ended"]);
    expect(asked).toEqual(before);
  });

  it.each([19, 20, 21])("checks the inclusive Credits threshold at %i", (credits) => {
    const result = check({ ...game(), credits: [3, credits] });
    expect(result.state.result).toEqual(
      credits < 20 ? null : { reason: "victory", winners: [1], scores: [0, 1] },
    );
    if (credits < 20) expect(result.state.pending?.kind).toBe("main_action");
  });

  it("clears a decision asked by the winning step", () => {
    const state = push({ ...game(), credits: [20, 0] }, "main_action_step");
    const result = run(state, registry);
    expect(result.state.result?.winners).toEqual([0]);
    expect(result.state.counters.decisions).toBe(1);
    expect(result.state.pending).toBeNull();
    expect(result.state.stack).toEqual([]);
  });
});

describe("R11.3: scores and winners", () => {
  it("two conditions beat one, including another player's five achievements", () => {
    const start = { ...game([tenColonists, fiveAchievements, outpost]), credits: [20, 3, 0] };
    const result = check(start);
    expect(result.state.result).toEqual({ reason: "victory", winners: [0], scores: [2, 1, 0] });
    expect(result.events.at(-1)).toEqual({
      type: "game_ended",
      reason: "victory",
      winners: [0],
      scores: [2, 1, 0],
    });
  });

  it("shares a tie across different conditions and excludes a zero score", () => {
    const result = check(game([tenColonists, fiveAchievements, outpost]));
    expect(result.state.result).toEqual({ reason: "victory", winners: [0, 1], scores: [1, 1, 0] });
  });

  it("keeps playing below every threshold, counting duplicate icons only once", () => {
    const fourAchievements: BaseSpec = {
      ...fiveAchievements,
      modules: [
        ["mod-laika-memorial", -5, 0, 0],
        ["mod-rover-1", -7, 0, 0],
        ["mod-rover-2", -9, 0, 0],
      ],
    };
    const result = check({ ...game([nineColonists, fourAchievements]), credits: [19, 19] });
    expect(result.state.result).toBeNull();
    expect(result.state.pending?.kind).toBe("main_action");
    expect(result.events.some(({ type }) => type === "game_ended")).toBe(false);
  });

  it("counts all three conditions and recomputes visible Station stats", () => {
    const allThree: BaseSpec = {
      ...fiveAchievements,
      modules: [
        ...(fiveAchievements.modules ?? []),
        ["mod-indigo-egregore", -5, 4, 0],
        ["mod-underground-headquarters", -7, 4, 0],
        ["mod-inflatable-habitat", -9, 4, 0],
        ["mod-helium-factory", -11, 4, 0],
      ],
    };
    const result = check({ ...game([allThree, outpost]), credits: [21, 0] });
    expect(result.state.result?.scores).toEqual([3, 0]);
    const hidden = check(game([{ ...fiveAchievements, side: "terran_outpost" }, outpost]));
    expect(hidden.state.result).toBeNull();
  });
});

describe("R11.4: end-of-turn check", () => {
  it("scores both Shuttle recipients together before any deal or next turn", () => {
    const start = {
      ...game([
        { station: "stn-taikotech", side: "named" },
        { station: "stn-imbrium", side: "named" },
      ]),
      credits: [18, 19],
      deck: ["spare"],
    };
    const before = structuredClone(start);
    const result = shuttle(start);
    expect(result.state.credits).toEqual([20, 20]);
    expect(result.state.result).toEqual({ reason: "victory", winners: [0, 1], scores: [1, 1] });
    expect(result.state.stack).toEqual([]);
    expect(result.state.pending).toBeNull();
    expect(result.state.deck).toEqual(["spare"]);
    expect(result.state.supply).toEqual([]);
    expect(result.state.turn.number).toBe(1);
    expect(result.events.map(({ type }) => type)).toEqual(["shuttles_arrived", "game_ended"]);
    expect(start).toEqual(before);
  });

  it.each([tenColonists, fiveAchievements])(
    "checks Base conditions even without arrival",
    (base) => {
      const result = shuttle({ ...game([outpost, base]), supply: ["spare"] });
      expect(result.state.result).toEqual({ reason: "victory", winners: [1], scores: [0, 1] });
      expect(result.events.map(({ type }) => type)).toEqual(["game_ended"]);
      expect(result.state.supply).toEqual(["spare"]);
    },
  );

  it("continues through the deal when everyone still scores zero", () => {
    const result = shuttle({ ...game(), deck: ["spare"] });
    expect(result.state.result).toBeNull();
    expect(result.state.supply).toEqual(["spare"]);
    expect(result.state.pending?.seat).toBe(1);
    expect(result.events.map(({ type }) => type)).toEqual([
      "shuttles_arrived",
      "supply_dealt",
      "turn_started",
    ]);
  });
});

// Seat 0 gains 2 Shuttle Credits and seat 1 gains 1 (R4.8).
const payingStations: readonly BaseSpec[] = [
  { station: "stn-taikotech", side: "named" },
  { station: "stn-imbrium", side: "named" },
];

describe("R11.1: the victory case table", () => {
  it("row 1: A reveals 4 Influences and the Shuttle Credits take B to 20; they share", () => {
    const start = holding({ ...game(payingStations), credits: [3, 19] }, 0, 4);
    const result = shuttle(start);
    expect(result.state.credits).toEqual([5, 20]);
    expect(result.state.result).toEqual({ reason: "victory", winners: [0, 1], scores: [1, 1] });
    expect(result.events.map(({ type }) => type)).toEqual([
      "shuttles_arrived",
      "influences_revealed",
      "game_ended",
    ]);
  });

  it("row 2: the Shuttle Credits also take A to 20; A scores 2 and wins", () => {
    const start = holding({ ...game(payingStations), credits: [18, 19] }, 0, 4);
    const result = shuttle(start);
    expect(result.state.credits).toEqual([20, 20]);
    expect(result.state.result).toEqual({ reason: "victory", winners: [0], scores: [2, 1] });
    expect(result.events.map(({ type }) => type)).toEqual([
      "shuttles_arrived",
      "influences_revealed",
      "game_ended",
    ]);
  });

  it("row 3: a Steal on B's turn takes B to 20; A's 4 Influences do not count", () => {
    const start = holding({ ...game(), credits: [3, 18] }, 0, 4);
    const turnOfB = pushTurn({ ...start, turn: { ...start.turn, seat: 1 } });
    const result = run(pushAction(turnOfB, { op: "steal_credits", n: 2 }, 1), registry);
    expect(result.state.credits).toEqual([1, 20]);
    expect(result.state.result).toEqual({ reason: "victory", winners: [1], scores: [0, 1] });
    expect(result.events.map(({ type }) => type)).toEqual(["credits_stolen", "game_ended"]);
  });

  it("row 4: A holds 4 Influences and Builds to 10 colonists; only the colonists score", () => {
    const start = holding({ ...game([nineColonists, outpost]), hands: [["held"], []] }, 0, 4);
    const main = { ...start, turn: { ...start.turn, step: "main_action" as const } };
    const asked = run(pushAction(pushTurn(main), { op: "build", n: 1 }, 0), registry).state;
    const pending = asked.pending;
    const option = pending?.options.find(({ card }) => card === "held");
    if (!pending || !option) throw new Error("Expected a Depot Build option");
    const result = applyChoice(
      asked,
      { seat: 0, decision: pending.id, option: option.id },
      registry,
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(colonistsOf(result.state.bases[0], cardOfState(result.state))).toBe(10);
    expect(result.state.result).toEqual({ reason: "victory", winners: [0], scores: [1, 0] });
    expect(result.state.hands[0]).toEqual(influences(4).hand);
    expect(result.events.map(({ type }) => type)).toEqual(["module_built", "game_ended"]);
  });
});

describe("R11.4: Influence victory", () => {
  it("the active player with 4 Influences and no other condition wins alone", () => {
    const start = holding({ ...game([outpost, outpost, outpost]), deck: ["spare"] }, 0, 4);
    const before = structuredClone(start);
    const result = shuttle(start);
    expect(result.state.result).toEqual({ reason: "victory", winners: [0], scores: [1, 0, 0] });
    expect(result.state.stack).toEqual([]);
    expect(result.state.pending).toBeNull();
    expect(result.state.turn).toMatchObject({ number: 1, seat: 0 });
    // The game ends before the deal, and the reveal moves no card.
    expect(result.state.deck).toEqual(["spare"]);
    expect(result.state.hands).toEqual(start.hands);
    const reveal = { type: "influences_revealed", seat: 0, cards: influences(4).revealed };
    expect(result.events).toEqual([
      expect.objectContaining({ type: "shuttles_arrived" }),
      reveal,
      { type: "game_ended", reason: "victory", winners: [0], scores: [1, 0, 0] },
    ]);
    expect(start).toEqual(before);
  });

  it("names the 4 cards for every seat and the public audience", () => {
    const result = shuttle(holding(game([outpost, outpost, outpost]), 0, 4));
    const reveal = result.events.find(({ type }) => type === "influences_revealed");
    if (!reveal) throw new Error("Expected a reveal event");
    for (const seat of [null, 0, 1, 2]) {
      expect(eventFor(reveal, seat)).toEqual({
        type: "influences_revealed",
        seat: 0,
        cards: influences(4).revealed,
        text: "Player 1 revealed 4 Influences: Quarantine, Lunar Alliance, Entropic Cascade, Terran Embargo.",
      });
    }
  });

  it("reveals every Influence of a larger hand and no other card", () => {
    const start = holding({ ...game(), hands: [["held"], ["spare"]] }, 0, 5);
    const result = shuttle(start);
    expect(result.state.result).toEqual({ reason: "victory", winners: [0], scores: [1, 0] });
    expect(result.events).toContainEqual({
      type: "influences_revealed",
      seat: 0,
      cards: influences(5).revealed,
    });
  });

  it("checks without arrival: an Agent in the Supply keeps the Shuttles away", () => {
    const start = holding(game(), 0, 4);
    const blocked = { ...start, cards: { ...start.cards, agent: "agt-solicitor" } };
    const result = shuttle({ ...blocked, supply: ["agent"] });
    expect(result.state.result).toEqual({ reason: "victory", winners: [0], scores: [1, 0] });
    expect(result.events.map(({ type }) => type)).toEqual(["influences_revealed", "game_ended"]);
  });

  it("keeps the hand out of every other view after the reveal", () => {
    const { state } = shuttle(holding(game(), 0, 4));
    expect(viewFor(state, 0).hand).toEqual(influences(4).revealed);
    for (const seat of [null, 1]) {
      const view = viewFor(state, seat);
      expect(view.players[0].handSize).toBe(4);
      expect(JSON.stringify(view)).not.toMatch(/"i[1-4]"|inf-/);
    }
  });

  it("with 3 Influences the end-of-turn check reveals nothing", () => {
    const result = shuttle(holding({ ...game(), deck: ["spare"] }, 0, 3));
    expect(result.state.result).toBeNull();
    expect(result.state.pending?.seat).toBe(1);
    expect(result.events.map(({ type }) => type)).toEqual([
      "shuttles_arrived",
      "supply_dealt",
      "turn_started",
    ]);
  });

  it("with 3 Influences another player's condition ends the game without a reveal", () => {
    const start = holding({ ...game(payingStations), credits: [3, 19] }, 0, 3);
    const result = shuttle(start);
    expect(result.state.result).toEqual({ reason: "victory", winners: [1], scores: [0, 1] });
    expect(result.events.map(({ type }) => type)).toEqual(["shuttles_arrived", "game_ended"]);
  });
});

describe("R11.6: condition 4 is met in no other way", () => {
  it("a player with 4 Influences who is not active does not win and reveals nothing", () => {
    const result = shuttle(holding({ ...game(), deck: ["spare"] }, 1, 4));
    expect(result.state.result).toBeNull();
    expect(result.state.hands[1]).toEqual(influences(4).hand);
    expect(result.events.map(({ type }) => type)).toEqual([
      "shuttles_arrived",
      "supply_dealt",
      "turn_started",
    ]);
  });

  it("does not add the Influences of a player who is not active to their score", () => {
    const start = holding({ ...game(payingStations), credits: [18, 19] }, 1, 4);
    const result = shuttle(start);
    expect(result.state.result).toEqual({ reason: "victory", winners: [0, 1], scores: [1, 1] });
    expect(result.events.map(({ type }) => type)).toEqual(["shuttles_arrived", "game_ended"]);
  });

  it("does not count the active player's 4 Influences after any step but the Shuttle step", () => {
    const result = check(holding(game(), 0, 4));
    expect(result.state.result).toBeNull();
    expect(result.state.pending?.kind).toBe("main_action");
    expect(result.events.some(({ type }) => type === "influences_revealed")).toBe(false);
  });
});

describe("finished games", () => {
  it.each([false, true])(
    "rejects a choice without changing the state (pending retained: %s)",
    (retained) => {
      const finished: GameState = {
        ...game(),
        result: { reason: "victory", winners: [0], scores: [1, 0] },
      };
      const state = retained
        ? ask(finished, { seat: 0, kind: "old", options: [{ id: "old", label: "Old" }] })
        : finished;
      const before = structuredClone(state);
      const result = applyChoice(state, { seat: 0, decision: "d1", option: "old" }, registry);
      expect(result).toMatchObject({ ok: false, error: { code: "stale_decision" } });
      expect(state).toEqual(before);
      expect(run(state, registry)).toEqual({ state, events: [] });
    },
  );
});
