import { describe, expect, it } from "vitest";
import type { ActionHandler, ActionHandlers } from "./actions/index.ts";
import { ask } from "./decisions.ts";
import {
  applyChoice,
  isTextFrame,
  pop,
  push,
  run,
  type AfterStep,
  type Registry,
  type Resolved,
} from "./loop.ts";
import { dealGame } from "./setup.ts";
import type { DecisionOption, GameState } from "./state.ts";
import { buildState, type BaseSpec } from "./testing/build.ts";
import { pushTurn, turnHandlers } from "./turn.ts";

/** A deal whose hands lie under the Deck: with no Agent in a hand, no Agent step asks (R4.3). */
function deal(startingSeat: number): GameState {
  const state = dealGame({ seats: 3, influences: false, kickstarter: false, startingSeat }, "turn");
  return { ...state, hands: [[], [], []], deck: [...state.deck, ...state.hands.flat()] };
}
const dealt = deal(0);

/** An op that leaves the stack at once and changes nothing. */
const done: ActionHandler = (state) => ({ state: pop(state) });
const stubs: ActionHandlers = { draft: done, draw: done, discard: done, build: done, resell: done };

const a: DecisionOption = { id: "a", label: "A" };
const b: DecisionOption = { id: "b", label: "B" };
/** An op that asks its seat a two-option decision and then leaves the stack. */
const asking: ActionHandler = (state, frame, answer) =>
  answer === null
    ? { state: ask(state, { seat: frame.seat, kind: "test_pick", options: [a, b] }) }
    : { state: pop(state) };

const quiet: AfterStep = (state) => ({ state });
function registryOf(actions: ActionHandlers, afterStep: AfterStep = quiet): Registry {
  return { handlers: turnHandlers(actions), afterStep };
}
const plain = registryOf(stubs);

/** Applies the option at `index` of the pending decision. */
function choose(state: GameState, index: number, registry: Registry = plain): Resolved {
  const pending = state.pending;
  if (pending === null) throw new Error("No decision is pending");
  const choice = { seat: pending.seat, decision: pending.id, option: pending.options[index].id };
  const result = applyChoice(state, choice, registry);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

const outpost: BaseSpec = { station: "stn-selene-labs" };
const reactor: BaseSpec = {
  station: "stn-shackleton",
  modules: [["mod-fusion-reactor", -1, 0, 0]],
};
/** A game of three hand-built Bases with every other zone empty. */
function withBases(first: BaseSpec, second: BaseSpec = outpost): GameState {
  const built = buildState([first, second, outpost]);
  return {
    ...dealt,
    ...built,
    deck: [],
    supply: [],
    hands: [[], [], []],
    removedStations: [],
  };
}

function labels(state: GameState): readonly string[] {
  return state.pending?.options.map((option) => option.label) ?? [];
}

// Terran Outpost's boxes, by option index.
const [DRAFT, BUILD, RESELL_DRAW] = [0, 1, 2];

describe("turn", () => {
  it("R4.1, R4.10: with 3 seats the active seat goes 0, 1, 2, 0 and the turn number grows by one", () => {
    let { state } = run(pushTurn(dealt), plain);
    const seen: (readonly [number, number])[] = [];
    for (let turn = 0; turn < 4; turn += 1) {
      expect(state.pending).toMatchObject({ seat: state.turn.seat, kind: "main_action" });
      seen.push([state.turn.seat, state.turn.number]);
      state = choose(state, DRAFT).state;
    }
    expect(seen).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [0, 4],
    ]);
  });

  it("R4.1: the first turn is the starting seat's", () => {
    const first = run(pushTurn(deal(2)), plain).state;
    expect(first.turn).toMatchObject({ number: 1, seat: 2 });
    expect(choose(first, DRAFT).state.turn).toMatchObject({ number: 2, seat: 0 });
  });

  it("R4.2: a turn runs the Agent step, the Main Action step and the Shuttle step in that order", () => {
    const seen: string[] = [];
    const registry = registryOf(stubs, (state, frame) => {
      const note = `${frame.kind} in ${state.turn.step}`;
      if (frame.kind.endsWith("_step") && seen.at(-1) !== note) seen.push(note);
      return { state };
    });
    choose(run(pushTurn(dealt), registry).state, DRAFT, registry);
    expect(seen).toEqual([
      "agent_step in agent",
      "main_action_step in main_action",
      "shuttle_step in shuttle",
      "agent_step in agent",
      "main_action_step in main_action",
    ]);
  });

  it("emits turn_started when a turn begins", () => {
    const first = run(pushTurn(dealt), plain);
    expect(first.events).toStrictEqual([{ type: "turn_started", seat: 0, turn: 1 }]);
    expect(choose(first.state, DRAFT).events.at(-1)).toStrictEqual({
      type: "turn_started",
      seat: 1,
      turn: 2,
    });
  });

  it("keeps one turn frame on the stack: a new turn replaces the old one", () => {
    const first = run(pushTurn(dealt), plain).state;
    const fourth = choose(choose(choose(first, DRAFT).state, BUILD).state, RESELL_DRAW).state;
    expect(first.stack.map((frame) => frame.kind)).toEqual(["turn", "main_action_step"]);
    expect(fourth.stack.map((frame) => frame.kind)).toEqual(["turn", "main_action_step"]);
    expect(fourth.stack[0].id).not.toBe(first.stack[0].id);
  });
});

describe("main_action_step", () => {
  it("R4.5: a Base of Terran Outpost and a Fusion Reactor offers exactly four boxes", () => {
    const { state } = run(pushTurn(withBases(reactor)), plain);
    expect(state.pending).toStrictEqual({
      id: "d1",
      seat: 0,
      kind: "main_action",
      options: [
        { id: "c1:0", label: "Terran Outpost: Draft", card: "c1", box: 0 },
        { id: "c1:1", label: "Terran Outpost: Build", card: "c1", box: 1 },
        { id: "c1:2", label: "Terran Outpost: Resell x2, Draw", card: "c1", box: 2 },
        { id: "c2:0", label: "Fusion Reactor: Build, Draw, Discard", card: "c2", box: 0 },
      ],
    });
  });

  it("R9.2: a Station offers the boxes of its visible side only", () => {
    const named = withBases({ station: "stn-shackleton", side: "named" });
    expect(labels(run(pushTurn(named), plain).state)).toEqual([
      "Shackleton: Draft",
      "Shackleton: Build x2, Draw",
    ]);
  });

  it("R4.5: offers the boxes of the active Base and of no other", () => {
    const elevator: BaseSpec = {
      station: "stn-imbrium",
      modules: [["mod-space-elevator", 1, 0, 0]],
    };
    const first = run(pushTurn(withBases(outpost, elevator)), plain).state;
    expect(labels(first)).toHaveLength(3);
    const second = choose(first, DRAFT).state;
    expect(second.pending?.seat).toBe(1);
    expect(labels(second).at(-1)).toBe("Space Elevator: Draft x2");
    expect(labels(second)).toHaveLength(4);
  });

  it("R4.6: a box is offered and must be chosen even when it can do nothing", () => {
    // No hand, no Supply, no Deck: none of the three boxes can change anything.
    const first = run(pushTurn(withBases(outpost)), plain).state;
    expect(labels(first)).toHaveLength(3);
    expect(choose(first, BUILD).state.turn).toMatchObject({ number: 2, seat: 1 });
  });

  it("emits box_chosen with the visible face of the card, not the hidden named side", () => {
    const first = run(pushTurn(withBases(outpost)), plain).state;
    expect(choose(first, RESELL_DRAW).events[0]).toStrictEqual({
      type: "box_chosen",
      seat: 0,
      card: { instance: "c1", cardId: "stn-terran-outpost" },
      box: 2,
    });
    const built = run(pushTurn(withBases(reactor)), plain).state;
    expect(choose(built, 3).events[0]).toMatchObject({
      card: { instance: "c2", cardId: "mod-fusion-reactor" },
      box: 0,
    });
  });
});

describe("box", () => {
  it("R8.1, R7.2: [resell x2, draw] runs resell, resell, draw in that order", () => {
    const log: unknown[] = [];
    const note: ActionHandler = (state, frame) => {
      log.push([frame.action, frame.seat]);
      return { state: pop(state) };
    };
    const registry = registryOf({ draft: note, draw: note, resell: note });
    const after = choose(run(pushTurn(dealt), registry).state, RESELL_DRAW, registry).state;
    expect(log).toStrictEqual([
      [{ op: "resell", n: 2 }, 0],
      [{ op: "resell", n: 2 }, 0],
      [{ op: "draw", n: 1 }, 0],
    ]);
    expect(after.turn.number).toBe(2);
  });

  it("is a text frame that has moved past a repetition when that repetition resolves", () => {
    const log: unknown[] = [];
    const note: ActionHandler = (state, frame) => {
      const box = state.stack.at(-2);
      if (box === undefined || !isTextFrame(box)) throw new Error("expected a text frame");
      log.push([frame.action.op, box.kind, box.position, box.repeated, box.deferred]);
      return { state: pop(state) };
    };
    const registry = registryOf({ draw: note, resell: note });
    choose(run(pushTurn(dealt), registry).state, RESELL_DRAW, registry);
    // During the last repetition of the last action nothing is left: position is past the end.
    expect(log).toStrictEqual([
      ["resell", "box", 0, 1, []],
      ["resell", "box", 1, 0, []],
      ["draw", "box", 2, 0, []],
    ]);
  });

  it("waits for a decision an action asks and goes on when it is answered", () => {
    const registry = registryOf({ ...stubs, resell: asking });
    const first = choose(run(pushTurn(dealt), registry).state, RESELL_DRAW, registry).state;
    expect(first.pending).toMatchObject({ id: "d2", seat: 0, kind: "test_pick" });
    expect(first.stack.map((frame) => frame.kind)).toEqual(["turn", "box", "action"]);
    expect(JSON.parse(JSON.stringify(first))).toStrictEqual(first);
    const second = choose(first, 1, registry).state;
    expect(second.pending).toMatchObject({ id: "d3", seat: 0, kind: "test_pick" });
    expect(second.turn.number).toBe(1);
    expect(choose(second, 0, registry).state.turn).toMatchObject({ number: 2, seat: 1 });
  });

  it("throws with the key of an action that has no handler and never skips it", () => {
    const log: string[] = [];
    const note: ActionHandler = (state, frame) => {
      log.push(frame.action.op);
      return { state: pop(state) };
    };
    const registry = registryOf({ resell: note });
    const first = run(pushTurn(dealt), registry).state;
    expect(() => choose(first, RESELL_DRAW, registry)).toThrow("No handler for action draw");
    expect(log).toEqual(["resell", "resell"]);
    const flip = push(dealt, "box", {
      seat: 0,
      actions: [{ op: "flip", who: "own" }],
      position: 0,
      repeated: 0,
      deferred: [],
    });
    expect(() => run(flip, plain)).toThrow("No handler for action flip:own");
  });
});

describe("turn.work", () => {
  it("restarts with the turn and grows with every choice applied in it", () => {
    const registry = registryOf({ ...stubs, resell: asking });
    const first = run(pushTurn(dealt), registry).state;
    // Two steps of the turn frame, the Agent step and the step that asks.
    expect(first.turn.work).toBe(4);
    const late: GameState = { ...first, turn: { ...first.turn, work: 400 } };
    // The frames that lead to the next turn's first decision are counted (T011).
    const second = choose(late, DRAFT, registry).state;
    expect(second.turn.number).toBe(2);
    expect(second.pending?.kind).toBe("main_action");
    expect(second.turn.work).toBeGreaterThan(0);
    expect(second.turn.work).toBeLessThan(10);
    const boxed = choose(second, RESELL_DRAW, registry).state;
    const resold = choose(boxed, 0, registry).state;
    expect(resold.turn.number).toBe(2);
    expect(boxed.turn.work).toBeGreaterThan(second.turn.work);
    expect(resold.turn.work).toBeGreaterThan(boxed.turn.work);
    const third = choose(resold, 0, registry).state;
    expect(third.turn.number).toBe(3);
    expect(third.turn.work).toBe(second.turn.work);
  });
});
