import { expect, test } from "vitest";
import { createGame, viewFor } from "../engine/index.ts";
import { createDecisionBudget, withDecisionBudget, type DecisionBudget } from "./budget.ts";
import { Declined, withFallback } from "./fallback.ts";
import type { DecisionMaker, DecisionRequest } from "./maker.ts";

const MINUTE = 60_000;
const state = createGame(
  { seats: 2, influences: false, kickstarter: false, startingSeat: 0 },
  "budget-game",
);
const request: DecisionRequest = {
  view: viewFor(state, 0),
  decision: {
    id: "decision",
    seat: 0,
    kind: "test",
    options: ["a", "b"].map((id) => ({ id, label: id })),
  },
  seat: 0,
  events: [],
};
const signal = () => new AbortController().signal;

/** A budget on a clock the test moves, with the lines it logged. */
function budgetOf(limit: number) {
  const clock = { at: 0 };
  const lines: string[] = [];
  const budget = createDecisionBudget({
    limit,
    now: () => clock.at,
    log: (line) => lines.push(line),
  });
  return { budget, clock, lines };
}

/** Reserves one decision and says whether the budget allowed it. */
const took = (budget: DecisionBudget) => budget.take() !== undefined;

/** A maker that counts how often it was asked; `answer` may throw. */
function counting(answer: () => string) {
  const maker = {
    asked: 0,
    decide() {
      maker.asked += 1;
      return Promise.resolve().then(answer);
    },
  };
  return maker;
}

test("the budget allows its limit and refuses the next decision", () => {
  const { budget } = budgetOf(3);
  expect([took(budget), took(budget), took(budget)]).toEqual([true, true, true]);
  expect(took(budget)).toBe(false);
  expect(budget.used()).toBe(3);
});

test("a decision is counted for at least 60 minutes and at most 61", () => {
  const { budget, clock } = budgetOf(1);
  clock.at = 30_000; // Half a minute into minute 0.
  expect(took(budget)).toBe(true);
  clock.at = 30_000 + 60 * MINUTE - 1;
  expect(took(budget)).toBe(false);
  // Still counted exactly 60 minutes later: no 60 minutes hold more than the limit.
  clock.at = 30_000 + 60 * MINUTE;
  expect(took(budget)).toBe(false);
  clock.at = 61 * MINUTE - 1;
  expect(took(budget)).toBe(false);
  // Its minute has left the window.
  clock.at = 61 * MINUTE;
  expect(took(budget)).toBe(true);
});

test("the window slides: each minute gives back what its oldest minute used", () => {
  const { budget, clock } = budgetOf(4);
  took(budget);
  took(budget);
  clock.at = 10 * MINUTE;
  took(budget);
  took(budget);
  expect(took(budget)).toBe(false);
  clock.at = 61 * MINUTE;
  expect(budget.used()).toBe(2);
  expect([took(budget), took(budget), took(budget)]).toEqual([true, true, false]);
  clock.at = 71 * MINUTE;
  expect(budget.used()).toBe(2);
});

test("a limit of 0 refuses every decision and logs nothing", () => {
  const { budget, clock, lines } = budgetOf(0);
  expect(took(budget)).toBe(false);
  clock.at = 24 * 60 * MINUTE;
  expect(took(budget)).toBe(false);
  expect(lines).toEqual([]);
});

test("memory stays bounded over a day of decisions", () => {
  const { budget, clock } = budgetOf(1_000_000);
  for (let second = 0; second < 24 * 60 * 60; second++) {
    clock.at = second * 1000;
    took(budget);
    expect(budget.buckets()).toBeLessThanOrEqual(61);
  }
  expect(budget.used()).toBe(61 * 60);
});

test("exhaustion and resumption log one line each, however many decisions were refused", () => {
  const { budget, clock, lines } = budgetOf(2);
  took(budget);
  took(budget);
  expect(lines).toEqual([]);
  for (let refused = 0; refused < 50; refused++) took(budget);
  expect(lines).toEqual(["jev budget exhausted limit=2 window=60m"]);
  clock.at = 61 * MINUTE;
  took(budget);
  took(budget);
  expect(lines).toEqual([
    "jev budget exhausted limit=2 window=60m",
    "jev budget resumed limit=2 window=60m",
  ]);
  took(budget);
  expect(lines).toHaveLength(3);
  expect(lines[2]).toBe("jev budget exhausted limit=2 window=60m");
});

test("a seat decides with Jev until the budget is spent, then built-in, then Jev again", async () => {
  const { budget, clock, lines } = budgetOf(3);
  const jev = counting(() => "a");
  const builtin = counting(() => "b");
  const maker = withFallback(withDecisionBudget(jev, budget), builtin);
  const decide = async (times: number) => {
    const by: string[] = [];
    for (let i = 0; i < times; i++) by.push((await maker.decideBy(request, signal())).by);
    return by;
  };

  expect(await decide(3)).toEqual(["jev", "jev", "jev"]);
  // Over the budget: the built-in player decides, Jev is not asked, and the
  // label is the one of a Jev that is off, not of a Jev that failed.
  expect(await decide(4)).toEqual(["builtin", "builtin", "builtin", "builtin"]);
  expect(jev.asked).toBe(3);
  expect(builtin.asked).toBe(4);

  clock.at = 61 * MINUTE;
  expect(await decide(2)).toEqual(["jev", "jev"]);
  expect(jev.asked).toBe(5);
  expect(lines).toEqual([
    "jev budget exhausted limit=3 window=60m",
    "jev budget resumed limit=3 window=60m",
  ]);
});

test("a decision that Jev fails counts once and is no reason to refuse the next", async () => {
  const { budget } = budgetOf(2);
  const jev = counting(() => {
    throw new Error("Jev gave no answer");
  });
  const maker = withFallback(
    withDecisionBudget(jev, budget),
    counting(() => "b"),
  );
  expect((await maker.decideBy(request, signal())).by).toBe("builtin-after-jev-failure");
  expect(budget.used()).toBe(1);
  expect((await maker.decideBy(request, signal())).by).toBe("builtin-after-jev-failure");
  expect((await maker.decideBy(request, signal())).by).toBe("builtin");
  expect(jev.asked).toBe(2);
});

test.each(["off", "too-many-options"] as const)(
  "a decision Jev declines as %s made no request and is not counted",
  async (reason) => {
    const { budget } = budgetOf(2);
    const jev = counting(() => {
      throw new Declined(reason);
    });
    const maker = withDecisionBudget(jev, budget);
    for (let i = 0; i < 5; i++)
      await expect(maker.decide(request, signal())).rejects.toBeInstanceOf(Declined);
    expect(jev.asked).toBe(5);
    expect(budget.used()).toBe(0);
  },
);

test("with a budget of 0 Jev is never asked", async () => {
  const { budget } = budgetOf(0);
  const jev = counting(() => "a");
  const maker = withFallback(
    withDecisionBudget(jev, budget),
    counting(() => "b"),
  );
  expect((await maker.decideBy(request, signal())).by).toBe("builtin");
  expect(jev.asked).toBe(0);
});

test("two seats share one budget, and a second budget is untouched", async () => {
  const { budget } = budgetOf(3);
  const other = budgetOf(3).budget;
  const jev = counting(() => "a");
  const builtin: DecisionMaker = counting(() => "b");
  const first = withFallback(withDecisionBudget(jev, budget), builtin);
  const second = withFallback(withDecisionBudget(jev, budget), builtin);
  const by = [];
  for (const maker of [first, second, first, second, first])
    by.push((await maker.decideBy(request, signal())).by);
  expect(by).toEqual(["jev", "jev", "jev", "builtin", "builtin"]);
  expect(other.used()).toBe(0);
  expect(took(other)).toBe(true);
});

test("a late refund takes back its own minute, not the one a later decision was counted in", async () => {
  const { budget, clock } = budgetOf(2);
  // A is asked just before a minute boundary and declines only after B was counted.
  let declineA: () => void = () => undefined;
  const calls = { asked: 0 };
  const jev: DecisionMaker = {
    decide() {
      calls.asked += 1;
      if (calls.asked > 1) return Promise.resolve("a");
      return new Promise((_, reject) => {
        declineA = () => {
          reject(new Declined("off"));
        };
      });
    },
  };
  const maker = withDecisionBudget(jev, budget);
  clock.at = MINUTE - 1;
  const a = maker.decide(request, signal());
  await Promise.resolve();
  clock.at = MINUTE;
  await expect(maker.decide(request, signal())).resolves.toBe("a"); // B, paid.
  declineA();
  await expect(a).rejects.toBeInstanceOf(Declined);
  expect(budget.used()).toBe(1);
  await expect(maker.decide(request, signal())).resolves.toBe("a"); // C, paid.
  await expect(maker.decide(request, signal())).rejects.toBeInstanceOf(Declined);
  // A's minute has left the window; B and C are under 60 minutes old.
  clock.at = 61 * MINUTE;
  expect(budget.used()).toBe(2);
  await expect(maker.decide(request, signal())).rejects.toBeInstanceOf(Declined);
  expect(calls.asked).toBe(3);
  clock.at = 62 * MINUTE;
  await expect(maker.decide(request, signal())).resolves.toBe("a");
});

test("a refund called twice takes back one decision", () => {
  const { budget } = budgetOf(3);
  const refund = budget.take();
  budget.take();
  budget.take();
  refund?.();
  refund?.();
  expect(budget.used()).toBe(2);
});

test("a refund after its minute left the window changes nothing", () => {
  const { budget, clock } = budgetOf(3);
  const refund = budget.take();
  clock.at = 61 * MINUTE;
  budget.take();
  budget.take();
  refund?.();
  expect(budget.used()).toBe(2);
  expect(budget.buckets()).toBe(1);
});

test("a clock that goes backwards neither frees a decision early nor moves the window back", () => {
  const { budget, clock } = budgetOf(2);
  clock.at = 100 * MINUTE;
  expect(took(budget)).toBe(true);
  // A backward reading is no time passed: this decision is counted at minute 100 too.
  clock.at = 0;
  expect(took(budget)).toBe(true);
  expect(took(budget)).toBe(false);
  clock.at = 100 * MINUTE;
  expect(budget.used()).toBe(2);
  expect(took(budget)).toBe(false);
  clock.at = 160 * MINUTE;
  expect(budget.used()).toBe(2);
  clock.at = 161 * MINUTE;
  expect(budget.used()).toBe(0);
});

test("memory stays bounded when the clock keeps stepping backwards", () => {
  const { budget, clock } = budgetOf(1_000_000);
  for (let step = 0; step < 2_000; step++) {
    clock.at = ((step * 37) % 500) * MINUTE;
    budget.take();
    expect(budget.buckets()).toBeLessThanOrEqual(61);
  }
});
