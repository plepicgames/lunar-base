import { describe, expect, it } from "vitest";
import { ask } from "./decisions.ts";
import type { GameEvent } from "./events.ts";
import {
  applyChoice,
  isTextFrame,
  pop,
  push,
  run,
  STEP_BUDGET,
  update,
  type AfterStep,
  type Registry,
  type Step,
} from "./loop.ts";
import { dealGame } from "./setup.ts";
import type { Choice, DecisionOption, GameState, JsonValue, Seat } from "./state.ts";

// Frame kinds that exist only here. Each handler is one step of the loop.
function pay(state: GameState, seat: Seat, amount: number): Step {
  const credits = state.credits.map((held, at) => (at === seat ? held + amount : held));
  return {
    state: { ...state, credits },
    events: [{ type: "credits_changed", seat, delta: amount, credits: credits[seat] }],
  };
}

const handlers: Registry["handlers"] = {
  /** Leaves the stack and pays `amount` to `seat`. */
  gain: (state, frame) => pay(pop(state), frame.seat as Seat, frame.amount as number),
  /** Never finishes and never asks. */
  forever: (state) => ({ state: push(state, "forever") }),
  /** Asks `seat` to pick one of `options`, then pays the option's amount. */
  pick: (state, frame, answer) =>
    answer === null
      ? {
          state: ask(state, {
            seat: frame.seat as Seat,
            kind: "test_pick",
            options: frame.options as readonly DecisionOption[],
          }),
        }
      : pay(pop(state), answer.decision.seat, answer.option.amount as number),
  /** Sets a decision by hand that nobody can answer. */
  mute: (state) => ({
    state: { ...state, pending: { id: "d9", seat: 0, kind: "test_mute", options: [] } },
  }),
};
const registry: Registry = { handlers, afterStep: (state) => ({ state }) };

const one: DecisionOption = { id: "one", label: "Gain 1 Credit", amount: 1 };
const two: DecisionOption = { id: "two", label: "Gain 2 Credits", amount: 2 };
type FrameSpec = readonly [kind: string, data?: Readonly<Record<string, JsonValue>>];
/** A decision of seat 0 that the tests leave open: the loop needs a frame to stop at. */
const wait: FrameSpec = ["pick", { seat: 0, options: [one, two] }];

const dealt = dealGame(
  { seats: 2, influences: false, kickstarter: false, startingSeat: 0 },
  "loop",
);

/** Frames are listed bottom first: the last one resolves first. */
function stacked(...frames: readonly FrameSpec[]): GameState {
  return frames.reduce((state, [kind, data]) => push(state, kind, data), dealt);
}

function atWork(state: GameState, work: number): GameState {
  return { ...state, turn: { ...state.turn, work } };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

/** Ends the game for seat 0 at 4 Credits, as the victory check of T017 will. */
const richWins: AfterStep = (state) =>
  state.credits[0] >= 4
    ? {
        state: {
          ...state,
          stack: [],
          pending: null,
          result: { reason: "victory", winners: [0], scores: [1, 0] },
        },
        events: [{ type: "game_ended", reason: "victory", winners: [0], scores: [1, 0] }],
      }
    : { state };

const stepLimit = { reason: "step_limit", winners: [], scores: [0, 0] };

describe("the stack", () => {
  it("push adds a frame on top with the next frame id and its data", () => {
    const state = push(push(dealt, "gain", { seat: 1, amount: 2 }), "forever");
    expect(state.stack).toStrictEqual([
      { id: "f1", kind: "gain", seat: 1, amount: 2 },
      { id: "f2", kind: "forever" },
    ]);
    expect(state.counters).toStrictEqual({ frames: 2, decisions: 0 });
    expect(dealt.stack).toEqual([]);
  });

  it("pop removes the top frame and its id is not used again", () => {
    const state = push(pop(stacked(["gain"], ["forever"])), "forever");
    expect(state.stack.map((frame) => frame.id)).toEqual(["f1", "f3"]);
  });

  it("pop throws on an empty stack", () => {
    expect(() => pop(dealt)).toThrow("The resolution stack is empty");
  });

  it("update replaces the frame of the same id where it lies and takes no frame id", () => {
    const start = stacked(["gain", { seat: 0, amount: 1 }], ["forever"]);
    const state = update(start, { ...start.stack[0], amount: 5 });
    expect(state.stack).toStrictEqual([
      { id: "f1", kind: "gain", seat: 0, amount: 5 },
      { id: "f2", kind: "forever" },
    ]);
    expect(state.counters).toStrictEqual(start.counters);
    expect(start.stack[0]).toMatchObject({ amount: 1 });
  });

  it("update throws for a frame that is not on the stack", () => {
    expect(() => update(stacked(["forever"]), { id: "f7", kind: "forever" })).toThrow(
      "Frame f7 is not on the resolution stack",
    );
  });

  it("a text frame holds an action list, a position and a deferred list", () => {
    const box = push(dealt, "test_box", {
      actions: [
        { op: "resell", n: 2 },
        { op: "draw", n: 1 },
      ],
      position: 0,
      deferred: ["c12"],
    }).stack[0];
    expect(isTextFrame(box)).toBe(true);
    if (!isTextFrame(box)) throw new Error("expected a text frame");
    expect(box.actions[box.position]).toEqual({ op: "resell", n: 2 });
    expect(box.deferred).toEqual(["c12"]);
    expect(isTextFrame(stacked(["gain", { seat: 0, amount: 1 }]).stack[0])).toBe(false);
    expect(isTextFrame({ id: "f1", kind: "build", actions: [], position: 0 })).toBe(false);
  });
});

describe("run", () => {
  it("performs one step per pass, top frame first, and counts each in turn.work", () => {
    const start = stacked(wait, ["gain", { seat: 0, amount: 1 }], ["gain", { seat: 1, amount: 2 }]);
    const { state, events } = run(start, registry);
    expect(events).toStrictEqual([
      { type: "credits_changed", seat: 1, delta: 2, credits: 5 },
      { type: "credits_changed", seat: 0, delta: 1, credits: 4 },
    ]);
    expect(state.credits).toEqual([4, 5]);
    expect(state.stack.map((frame) => frame.id)).toEqual(["f1"]);
    expect(state.turn.work).toBe(3);
  });

  it("stops with pending set when a frame asks a two-option decision", () => {
    const { state, events } = run(stacked(["gain", { seat: 0, amount: 1 }], wait), registry);
    expect(state.pending).toStrictEqual({
      id: "d1",
      seat: 0,
      kind: "test_pick",
      options: [one, two],
    });
    expect(state.result).toBeNull();
    expect(state.stack).toHaveLength(2);
    expect(state.credits).toEqual([3, 3]);
    expect(events).toEqual([]);
    expect(state.turn.work).toBe(1);
    expect(run(state, registry)).toStrictEqual({ state, events: [] });
  });

  it("applies a one-option decision without stopping and counts it as a step", () => {
    const plain = run(stacked(wait, ["gain", { seat: 1, amount: 2 }]), registry);
    const asked = run(stacked(wait, ["pick", { seat: 1, options: [two] }]), registry);
    expect(asked.events).toStrictEqual([
      { type: "credits_changed", seat: 1, delta: 2, credits: 5 },
    ]);
    expect(asked.state.credits).toEqual([3, 5]);
    // The decision that stops the loop is the next one, for seat 0.
    expect(asked.state.pending).toMatchObject({ id: "d2", seat: 0 });
    expect(plain.state.turn.work).toBe(2);
    expect(asked.state.turn.work).toBe(3);
  });

  it("calls the after-step hook after every step with the frame and the counted work", () => {
    const seen: (readonly [string, number])[] = [];
    const noted: GameEvent = { type: "deck_reshuffled", count: 0 };
    const afterStep: AfterStep = (state, frame) => {
      seen.push([frame.id, state.turn.work]);
      return { state, events: [noted] };
    };
    const start = stacked(wait, ["gain", { seat: 1, amount: 2 }]);
    const { events } = run(start, { handlers, afterStep });
    expect(seen).toEqual([
      ["f2", 1],
      ["f1", 2],
    ]);
    expect(events.map((event) => event.type)).toEqual([
      "credits_changed",
      "deck_reshuffled",
      "deck_reshuffled",
    ]);
  });

  it("stops when the after-step hook sets a result", () => {
    const start = stacked(wait, ["gain", { seat: 1, amount: 9 }], ["gain", { seat: 0, amount: 1 }]);
    const { state, events } = run(start, { handlers, afterStep: richWins });
    expect(state.result).toStrictEqual({ reason: "victory", winners: [0], scores: [1, 0] });
    expect(state.credits).toEqual([4, 3]);
    expect(state.turn.work).toBe(1);
    expect(events.map((event) => event.type)).toEqual(["credits_changed", "game_ended"]);
  });

  it("ends a frame that pushes itself for ever at the step budget, the same way each time", () => {
    const play = () => {
      const opened = run(stacked(["forever"], wait), registry).state;
      return applyChoice(opened, { seat: 0, decision: "d1", option: "one" }, registry);
    };
    const ended = play();
    if (!ended.ok) throw new Error(ended.error.message);
    expect(STEP_BUDGET).toBe(5000);
    expect(ended.state.result).toStrictEqual(stepLimit);
    expect(ended.state.result?.reason).toBe("step_limit");
    expect(ended.state.result?.winners).toEqual([]);
    expect(ended.state.turn.work).toBe(5000);
    expect(ended.state.stack).toEqual([]);
    expect(ended.state.pending).toBeNull();
    expect(ended.events).toStrictEqual([
      { type: "credits_changed", seat: 0, delta: 1, credits: 4 },
      { type: "game_ended", ...stepLimit },
    ]);
    expect(play()).toStrictEqual(ended);
    expect(JSON.parse(JSON.stringify(ended.state))).toStrictEqual(ended.state);
  });

  it("sets step_limit instead of a decision asked by the step that uses up the budget", () => {
    const { state, events } = run(atWork(stacked(wait), STEP_BUDGET - 1), registry);
    expect(state.result).toStrictEqual(stepLimit);
    expect(state.pending).toBeNull();
    expect(state.stack).toEqual([]);
    expect(state.turn.work).toBe(STEP_BUDGET);
    expect(events).toStrictEqual([{ type: "game_ended", ...stepLimit }]);
  });

  it("starts no step once the budget is used up", () => {
    const start = atWork(stacked(wait, ["gain", { seat: 0, amount: 1 }]), STEP_BUDGET);
    const { state, events } = run(start, registry);
    expect(state.credits).toEqual([3, 3]);
    expect(state.result).toStrictEqual(stepLimit);
    expect(state.turn.work).toBe(STEP_BUDGET);
    expect(events).toHaveLength(1);
  });

  it("keeps a result the hook sets on the step that uses up the budget", () => {
    const start = atWork(stacked(wait, ["gain", { seat: 0, amount: 1 }]), STEP_BUDGET - 1);
    const { state, events } = run(start, { handlers, afterStep: richWins });
    expect(state.result?.reason).toBe("victory");
    expect(state.turn.work).toBe(STEP_BUDGET);
    expect(events.filter((event) => event.type === "game_ended")).toHaveLength(1);
  });

  it("does nothing to a finished game", () => {
    const finished: GameState = { ...dealt, result: { ...stepLimit, reason: "step_limit" } };
    expect(run(finished, registry)).toStrictEqual({ state: finished, events: [] });
  });

  it("throws on engine bugs: no frame, no handler, a decision without options", () => {
    expect(() => run(dealt, registry)).toThrow("The resolution stack is empty");
    expect(() => run(stacked(["test_missing"]), registry)).toThrow(
      "No handler for frame kind test_missing",
    );
    expect(() => run(stacked(["toString"]), registry)).toThrow("No handler for frame kind");
    expect(() => run(stacked(["mute"]), registry)).toThrow("Decision d9 has no options");
  });

  it("returns deeply equal states and events for two calls on equal states", () => {
    const start = stacked(
      wait,
      ["pick", { seat: 1, options: [two] }],
      ["pick", { seat: 1, options: [one, two] }],
    );
    const opened = run(start, registry);
    expect(run(structuredClone(start), registry)).toStrictEqual(opened);
    const choice: Choice = { seat: 1, decision: "d1", option: "one" };
    const applied = applyChoice(opened.state, choice, registry);
    if (!applied.ok) throw new Error(applied.error.message);
    expect(applied.events).toHaveLength(2);
    expect(applyChoice(structuredClone(opened.state), { ...choice }, registry)).toStrictEqual(
      applied,
    );
  });
});

describe("applyChoice", () => {
  const opened = run(stacked(wait, ["pick", { seat: 1, options: [one, two] }]), registry).state;
  const choice: Choice = { seat: 1, decision: "d1", option: "two" };

  it("applies the chosen option as one step and runs to the next decision", () => {
    expect(opened.pending).toMatchObject({ id: "d1", seat: 1 });
    expect(opened.turn.work).toBe(1);
    const applied = applyChoice(opened, choice, registry);
    if (!applied.ok) throw new Error(applied.error.message);
    expect(applied.events).toStrictEqual([
      { type: "credits_changed", seat: 1, delta: 2, credits: 5 },
    ]);
    expect(applied.state.credits).toEqual([3, 5]);
    expect(applied.state.stack.map((frame) => frame.id)).toEqual(["f1"]);
    expect(applied.state.pending).toMatchObject({ id: "d2", seat: 0, kind: "test_pick" });
    // One step for the choice and one for the frame that asks next.
    expect(applied.state.turn.work).toBe(3);
  });

  it.each([
    ["stale_decision", { ...choice, decision: "d0" }],
    ["wrong_seat", { ...choice, seat: 0 }],
    ["unknown_option", { ...choice, option: "three" }],
  ] as const)("returns the error %s and leaves the state unchanged", (code, bad) => {
    const before = structuredClone(opened);
    const rejected = applyChoice(opened, bad, registry);
    expect(rejected).toMatchObject({ ok: false, error: { code } });
    expect(rejected).not.toHaveProperty("state");
    expect(opened).toStrictEqual(before);
  });

  it("rejects a choice that was already applied", () => {
    const applied = applyChoice(opened, choice, registry);
    if (!applied.ok) throw new Error(applied.error.message);
    expect(applyChoice(applied.state, choice, registry)).toMatchObject({
      ok: false,
      error: { code: "stale_decision" },
    });
  });

  it("neither throws on nor changes a deeply frozen state", () => {
    const frozen = deepFreeze(structuredClone(opened));
    const applied = applyChoice(frozen, choice, registry);
    expect(applied).toStrictEqual(applyChoice(opened, choice, registry));
    expect(frozen).toStrictEqual(opened);
    const longest = deepFreeze(run(stacked(["forever"], wait), registry).state);
    const before = structuredClone(longest);
    const ended = applyChoice(longest, { seat: 0, decision: "d1", option: "two" }, registry);
    expect(ended).toMatchObject({ ok: true, state: { result: stepLimit } });
    expect(longest).toStrictEqual(before);
  });
});
