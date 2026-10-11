import { expect, test } from "vitest";
import { createGame, viewFor } from "../engine/index.ts";
import { createDecisionBudget, withDecisionBudget } from "./budget.ts";
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
  expect([budget.take(), budget.take(), budget.take()]).toEqual([true, true, true]);
  expect(budget.take()).toBe(false);
  expect(budget.used()).toBe(3);
});

test("a decision is counted for at least 60 minutes and at most 61", () => {
  const { budget, clock } = budgetOf(1);
  clock.at = 30_000; // Half a minute into minute 0.
  expect(budget.take()).toBe(true);
  clock.at = 30_000 + 60 * MINUTE - 1;
  expect(budget.take()).toBe(false);
  // Still counted exactly 60 minutes later: no 60 minutes hold more than the limit.
  clock.at = 30_000 + 60 * MINUTE;
  expect(budget.take()).toBe(false);
  clock.at = 61 * MINUTE - 1;
  expect(budget.take()).toBe(false);
  // Its minute has left the window.
  clock.at = 61 * MINUTE;
  expect(budget.take()).toBe(true);
});

test("the window slides: each minute gives back what its oldest minute used", () => {
  const { budget, clock } = budgetOf(4);
  budget.take();
  budget.take();
  clock.at = 10 * MINUTE;
  budget.take();
  budget.take();
  expect(budget.take()).toBe(false);
  clock.at = 61 * MINUTE;
  expect(budget.used()).toBe(2);
  expect([budget.take(), budget.take(), budget.take()]).toEqual([true, true, false]);
  clock.at = 71 * MINUTE;
  expect(budget.used()).toBe(2);
});

test("a limit of 0 refuses every decision and logs nothing", () => {
  const { budget, clock, lines } = budgetOf(0);
  expect(budget.take()).toBe(false);
  clock.at = 24 * 60 * MINUTE;
  expect(budget.take()).toBe(false);
  expect(lines).toEqual([]);
});

test("memory stays bounded over a day of decisions", () => {
  const { budget, clock } = budgetOf(1_000_000);
  for (let second = 0; second < 24 * 60 * 60; second++) {
    clock.at = second * 1000;
    budget.take();
    expect(budget.buckets()).toBeLessThanOrEqual(61);
  }
  expect(budget.used()).toBe(61 * 60);
});

test("exhaustion and resumption log one line each, however many decisions were refused", () => {
  const { budget, clock, lines } = budgetOf(2);
  budget.take();
  budget.take();
  expect(lines).toEqual([]);
  for (let refused = 0; refused < 50; refused++) budget.take();
  expect(lines).toEqual(["jev budget exhausted limit=2 window=60m"]);
  clock.at = 61 * MINUTE;
  budget.take();
  budget.take();
  expect(lines).toEqual([
    "jev budget exhausted limit=2 window=60m",
    "jev budget resumed limit=2 window=60m",
  ]);
  budget.take();
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
  expect(other.take()).toBe(true);
});
