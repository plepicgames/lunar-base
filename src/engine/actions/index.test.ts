import { describe, expect, it } from "vitest";
import type { ActionDef } from "../catalogue.ts";
import { pop } from "../loop.ts";
import { dealGame } from "../setup.ts";
import {
  handlerOf,
  pushAction,
  repetitions,
  type ActionHandler,
  type ActionHandlers,
} from "./index.ts";

const dealt = dealGame(
  { seats: 2, influences: false, kickstarter: false, startingSeat: 0 },
  "actions",
);
const done: ActionHandler = (state) => ({ state: pop(state) });

describe("repetitions", () => {
  const cases: readonly (readonly [ActionDef, number])[] = [
    [{ op: "draft", n: 1 }, 1],
    [{ op: "draw", n: 3 }, 3],
    [{ op: "build", n: 2 }, 2],
    [{ op: "resell", n: 2 }, 2],
    // An amount, taken in one step (R8.5).
    [{ op: "steal_credits", n: 3 }, 1],
    [{ op: "each_player_loses_credits", n: 3 }, 1],
    // The handler makes its one choice of player first, then repeats itself.
    [{ op: "opponent_resells", n: 2 }, 1],
    [{ op: "discard_hand" }, 1],
  ];

  it.each(cases)("R7.2: %j is resolved %d time(s) by its text", (action, times) => {
    expect(repetitions(action)).toBe(times);
  });
});

describe("handlerOf", () => {
  it("finds a handler by the action's key", () => {
    const flip: ActionHandler = (state) => ({ state });
    const handlers: ActionHandlers = { draw: done, "flip:any_one": flip };
    expect(handlerOf(handlers, { op: "draw", n: 2 })).toBe(done);
    expect(handlerOf(handlers, { op: "flip", who: "any_one" })).toBe(flip);
  });

  it("throws with the key of an action that has no handler", () => {
    const handlers: ActionHandlers = { draw: done, "flip:any_one": done };
    expect(() => handlerOf(handlers, { op: "resell", n: 1 })).toThrow(
      "No handler for action resell",
    );
    expect(() => handlerOf(handlers, { op: "flip", who: "own" })).toThrow(
      "No handler for action flip:own",
    );
  });
});

describe("the action frame", () => {
  it("holds one action and the seat that performs it", () => {
    const state = pushAction(dealt, { op: "resell", n: 2 }, 1);
    expect(state.stack).toStrictEqual([
      { id: "f1", kind: "action", action: { op: "resell", n: 2 }, seat: 1 },
    ]);
  });
});
