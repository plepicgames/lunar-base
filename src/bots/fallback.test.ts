import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createGame, viewFor } from "../engine/index.ts";
import { DECISION_BUDGET_MS, Declined, withFallback, type Decided } from "./fallback.ts";
import type { DecisionMaker, DecisionRequest } from "./maker.ts";

const state = createGame(
  { seats: 2, influences: false, kickstarter: false, startingSeat: 0 },
  "fallback-game",
);
const request: DecisionRequest = {
  view: viewFor(state, 0),
  decision: {
    id: "decision",
    seat: 0,
    kind: "test",
    options: ["a", "b", "c"].map((id) => ({ id, label: id })),
  },
  seat: 0,
  events: [],
};

/** A maker that always answers `option` and counts how often it was asked. */
function fixed(option: string) {
  const maker = {
    asked: 0,
    decide() {
      maker.asked += 1;
      return Promise.resolve(option);
    },
  };
  return maker;
}

function rejecting(error: unknown): DecisionMaker {
  // The wrapper must survive any thrown value, not only an Error.
  // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
  return { decide: () => Promise.reject(error) };
}

/** Records the settled answer without waiting for it. */
function settled(answer: Promise<Decided>) {
  const seen: { value?: Decided } = {};
  void answer.then((value) => {
    seen.value = value;
  });
  return seen;
}

const caller = () => new AbortController().signal;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test("the budget for one decision is 8 s", () => {
  expect(DECISION_BUDGET_MS).toBe(8_000);
});

test("a primary that never answers is aborted at 8 s and the fallback's answer is used", async () => {
  let signal: AbortSignal | undefined;
  const primary: DecisionMaker = {
    decide(_request, given) {
      signal = given;
      return new Promise<string>(() => {});
    },
  };
  const fallback = fixed("b");
  const seen = settled(withFallback(primary, fallback).decideBy(request, caller()));
  await vi.advanceTimersByTimeAsync(7_999);
  expect(signal?.aborted).toBe(false);
  expect(fallback.asked).toBe(0);
  expect(seen.value).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expect(signal?.aborted).toBe(true);
  expect(seen.value).toEqual({ option: "b", by: "builtin-after-jev-failure" });
  expect(fallback.asked).toBe(1);
});

test("the limits set another budget", async () => {
  const primary: DecisionMaker = { decide: () => new Promise<string>(() => {}) };
  const seen = settled(
    withFallback(primary, fixed("c"), { budgetMs: 50 }).decideBy(request, caller()),
  );
  await vi.advanceTimersByTimeAsync(49);
  expect(seen.value).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expect(seen.value).toEqual({ option: "c", by: "builtin-after-jev-failure" });
});

test("a primary that names an offered option decides, and the fallback is not asked", async () => {
  let given: DecisionRequest | undefined;
  const primary: DecisionMaker = {
    decide(received) {
      given = received;
      return Promise.resolve("c");
    },
  };
  const fallback = fixed("a");
  const maker = withFallback(primary, fallback);
  expect(await maker.decideBy(request, caller())).toEqual({ option: "c", by: "jev" });
  expect(given).toBe(request);
  expect(fallback.asked).toBe(0);
  // The budget's timer does not outlive the decision.
  expect(vi.getTimerCount()).toBe(0);
  expect(await maker.decide(request, caller())).toBe("c");
});

test("a primary that returns an option id that was not offered leads to the fallback's answer", async () => {
  const fallback = fixed("a");
  const maker = withFallback(fixed("not-offered"), fallback);
  expect(await maker.decideBy(request, caller())).toEqual({
    option: "a",
    by: "builtin-after-jev-failure",
  });
  expect(fallback.asked).toBe(1);
});

test.each([
  ["rejects", rejecting(new Error("503"))],
  ["rejects with a value that is no Error", rejecting("refused")],
  [
    "throws before it returns a promise",
    {
      decide() {
        throw new Error("broken");
      },
    } satisfies DecisionMaker,
  ],
])("a primary that %s gives the fallback's answer at once", async (_name, primary) => {
  const answer = await withFallback(primary, fixed("b")).decideBy(request, caller());
  expect(answer).toEqual({ option: "b", by: "builtin-after-jev-failure" });
  expect(vi.getTimerCount()).toBe(0);
});

test("a primary that declines is no failure: the label names the reason", async () => {
  const off = withFallback(rejecting(new Declined("off")), fixed("a"));
  expect(await off.decideBy(request, caller())).toEqual({ option: "a", by: "builtin" });
  const many = withFallback(rejecting(new Declined("too-many-options")), fixed("a"));
  expect(await many.decideBy(request, caller())).toEqual({
    option: "a",
    by: "builtin-too-many-options",
  });
});

test("one maker as primary and fallback is asked once and decides as builtin", async () => {
  const only = fixed("b");
  expect(await withFallback(only, only).decideBy(request, caller())).toEqual({
    option: "b",
    by: "builtin",
  });
  expect(only.asked).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
});

test("the caller's abort stops the primary before the budget, and the fallback still answers", async () => {
  let signal: AbortSignal | undefined;
  const primary: DecisionMaker = {
    decide(_request, given) {
      signal = given;
      return new Promise<string>(() => {});
    },
  };
  const controller = new AbortController();
  const seen = settled(withFallback(primary, fixed("a")).decideBy(request, controller.signal));
  await vi.advanceTimersByTimeAsync(10);
  controller.abort();
  await vi.advanceTimersByTimeAsync(0);
  expect(signal?.aborted).toBe(true);
  expect(seen.value).toEqual({ option: "a", by: "builtin-after-jev-failure" });
  expect(vi.getTimerCount()).toBe(0);
});

test("an answer that comes after the abort is ignored", async () => {
  let answer: (option: string) => void = () => {};
  const primary: DecisionMaker = {
    decide: () =>
      new Promise<string>((resolve) => {
        answer = resolve;
      }),
  };
  const fallback = fixed("a");
  const seen = settled(withFallback(primary, fallback).decideBy(request, caller()));
  await vi.advanceTimersByTimeAsync(8_000);
  answer("c");
  await vi.advanceTimersByTimeAsync(0);
  expect(seen.value).toEqual({ option: "a", by: "builtin-after-jev-failure" });
  expect(fallback.asked).toBe(1);
});
