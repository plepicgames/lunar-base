import { describe, expect, it } from "vitest";
import type { ActionDef } from "../catalogue.ts";
import { ask } from "../decisions.ts";
import { push, run, type Registry } from "../loop.ts";
import { dealGame } from "../setup.ts";
import { turnHandlers } from "../turn.ts";
import { actionHandlers } from "./index.ts";

const dealt = dealGame(
  { seats: 2, startingSeat: 0, influences: false, kickstarter: false },
  "choose-one-card",
);
const registry: Registry = {
  handlers: {
    ...turnHandlers(actionHandlers),
    stop: (state) => ({ state: ask(state, { seat: 0, kind: "finished", options: [] }) }),
  },
  afterStep: (state) => ({ state }),
};

const choice: ActionDef = {
  op: "choose_one",
  options: [[{ op: "draw", n: 2 }], [{ op: "discard", n: 1 }]],
};

function asked(card: string | null) {
  const stopped = push(dealt, "stop");
  const frame = { seat: 1, actions: [choice], position: 0, repeated: 0, deferred: [] };
  const state = push(stopped, "box", card === null ? frame : { ...frame, source: card });
  const pending = run(state, registry).state.pending;
  if (pending === null || !("options" in pending)) throw new Error("Expected a decision");
  return pending;
}

describe("D3 names the card being resolved", () => {
  it("puts the card of the on-play text that holds the choice on each option", () => {
    const frame = {
      seat: 1,
      card: "c-9",
      actions: [choice],
      position: 0,
      repeated: 0,
      deferred: [],
    };
    const pending = run(push(push(dealt, "stop"), "box", frame), registry).state.pending;
    if (pending === null || !("options" in pending)) throw new Error("Expected a decision");
    expect(pending.options.map((option) => option.card)).toStrictEqual(["c-9", "c-9"]);
  });

  it("puts the card of the Main Action box that holds the choice on each option", () => {
    const { options } = asked("c-7");
    expect(options).toStrictEqual([
      { id: "0", label: "Draw x2", card: "c-7" },
      { id: "1", label: "Discard", card: "c-7" },
    ]);
  });

  it("leaves the option as printed when no card holds the text", () => {
    expect(asked(null).options.every((option) => !("card" in option))).toBe(true);
  });
});
