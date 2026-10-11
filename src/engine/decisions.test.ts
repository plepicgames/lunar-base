import { describe, expect, it } from "vitest";
import { ask, checkChoice } from "./decisions.ts";
import { dealGame } from "./setup.ts";
import type { DecisionOption, GameState } from "./state.ts";

const dealt = dealGame(
  { seats: 2, influences: false, kickstarter: false, startingSeat: 0 },
  "decisions",
);
const options: readonly DecisionOption[] = [
  { id: "keep", label: "Keep the card", card: "c9" },
  { id: "sell", label: "Resell the card", card: "c9", credits: 1 },
];

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

describe("ask", () => {
  it("sets pending with the next decision id and the options in the order given", () => {
    const state = ask(dealt, { seat: 1, kind: "test_pick", options });
    expect(state.pending).toStrictEqual({ id: "d1", seat: 1, kind: "test_pick", options });
    expect(state.counters).toStrictEqual({ frames: 0, decisions: 1 });
    expect({ ...state, pending: null, counters: dealt.counters }).toStrictEqual(dealt);
  });

  it("never reuses a decision id in a game", () => {
    const first = ask(dealt, { seat: 0, kind: "test_pick", options });
    const second = ask({ ...first, pending: null }, { seat: 0, kind: "test_pick", options });
    expect(second.pending?.id).toBe("d2");
  });

  it("does not change a frozen state or keep the caller's option list", () => {
    const frozen = deepFreeze(structuredClone(dealt));
    const own = structuredClone(options) as DecisionOption[];
    const state = ask(frozen, { seat: 0, kind: "test_pick", options: own });
    own.pop();
    expect(frozen).toStrictEqual(dealt);
    expect(state.pending?.options).toStrictEqual(options);
  });

  it("throws on a decision nobody can answer", () => {
    expect(() => ask(dealt, { seat: 0, kind: "test_pick", options: [] })).toThrow(
      "Decision test_pick has no options",
    );
  });

  it("throws on two options with the same id", () => {
    const twice = [options[0], { id: "keep", label: "Keep it again" }];
    expect(() => ask(dealt, { seat: 0, kind: "test_pick", options: twice })).toThrow(
      "Decision test_pick repeats option id keep",
    );
  });

  it("throws while another decision is pending", () => {
    const waiting = ask(dealt, { seat: 0, kind: "test_pick", options });
    expect(() => ask(waiting, { seat: 1, kind: "test_other", options })).toThrow(
      "Decision d1 is still pending",
    );
  });
});

describe("checkChoice", () => {
  const waiting: GameState = ask(dealt, { seat: 1, kind: "test_pick", options });

  it("returns the pending decision and the offered option a valid choice names", () => {
    expect(checkChoice(waiting, { seat: 1, decision: "d1", option: "sell" })).toStrictEqual({
      ok: true,
      decision: waiting.pending,
      option: options[1],
    });
  });

  it.each([
    ["stale_decision", { seat: 1, decision: "d0", option: "sell" }],
    ["wrong_seat", { seat: 0, decision: "d1", option: "sell" }],
    ["unknown_option", { seat: 1, decision: "d1", option: "burn" }],
    // The first failed check names the error: decision, then seat, then option.
    ["stale_decision", { seat: 0, decision: "d0", option: "burn" }],
    ["wrong_seat", { seat: 0, decision: "d1", option: "burn" }],
  ] as const)("rejects with %s", (code, choice) => {
    const checked = checkChoice(waiting, choice);
    expect(checked).toMatchObject({ ok: false, error: { code } });
    if (checked.ok) throw new Error("expected a rejection");
    expect(checked.error.message).toMatch(/\.$/);
  });

  it("rejects every choice as stale when nothing is pending", () => {
    expect(checkChoice(dealt, { seat: 0, decision: "d1", option: "keep" })).toMatchObject({
      ok: false,
      error: { code: "stale_decision" },
    });
  });
});
