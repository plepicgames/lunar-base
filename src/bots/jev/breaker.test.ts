import { expect, test } from "vitest";
import { BREAKER_FAILURES, BREAKER_OFF_MS, createBreaker, type Breaker } from "./breaker.ts";

/** A breaker on a clock the test moves. */
function setup() {
  const clock = { ms: 1_000_000 };
  return { clock, breaker: createBreaker(() => clock.ms) };
}

/** A decision that is admitted and still in flight. */
function admitted(breaker: Breaker) {
  const pass = breaker.admit();
  if (!pass) throw new Error("The breaker refused the decision");
  return pass;
}

/** One admitted decision that fails. */
function fail(breaker: Breaker) {
  return admitted(breaker).failure();
}

/** Three failed decisions in a row: Jev is off. */
function open(breaker: Breaker) {
  for (let i = 0; i < BREAKER_FAILURES; i += 1) fail(breaker);
}

test("the limits are 3 failed decisions in a row and 60 s", () => {
  expect(BREAKER_FAILURES).toBe(3);
  expect(BREAKER_OFF_MS).toBe(60_000);
});

test("a new breaker admits every decision", () => {
  const { breaker } = setup();
  expect(breaker.admit()).toBeDefined();
  expect(breaker.admit()).toBeDefined();
});

test("the third failed decision in a row opens the breaker, and failure() says so", () => {
  const { breaker } = setup();
  expect(fail(breaker)).toBe(false);
  expect(fail(breaker)).toBe(false);
  expect(fail(breaker)).toBe(true);
  expect(breaker.admit()).toBeUndefined();
});

test("a success between failures starts the count again", () => {
  const { breaker } = setup();
  fail(breaker);
  fail(breaker);
  admitted(breaker).success();
  fail(breaker);
  fail(breaker);
  expect(breaker.admit()).toBeDefined();
});

test("an open breaker stays closed to decisions until 60 s have passed", () => {
  const { breaker, clock } = setup();
  open(breaker);
  clock.ms += BREAKER_OFF_MS - 1;
  expect(breaker.admit()).toBeUndefined();
  clock.ms += 1;
  expect(breaker.admit()).toBeDefined();
});

test("after the pause one decision tries again and the others wait for its result", () => {
  const { breaker, clock } = setup();
  open(breaker);
  clock.ms += BREAKER_OFF_MS;
  const trial = admitted(breaker);
  expect(breaker.admit()).toBeUndefined();
  trial.success();
  expect(breaker.admit()).toBeDefined();
  expect(breaker.admit()).toBeDefined();
});

test("a failed trial turns Jev off for another 60 s", () => {
  const { breaker, clock } = setup();
  open(breaker);
  clock.ms += BREAKER_OFF_MS;
  expect(fail(breaker)).toBe(true);
  clock.ms += BREAKER_OFF_MS - 1;
  expect(breaker.admit()).toBeUndefined();
  clock.ms += 1;
  expect(breaker.admit()).toBeDefined();
});

test("a late failure of a decision admitted before the breaker opened does not extend the pause", () => {
  const { breaker, clock } = setup();
  const early = admitted(breaker); // still in flight when the breaker opens
  open(breaker);
  clock.ms += 30_000;
  expect(early.failure()).toBe(false);
  clock.ms += 30_000;
  expect(breaker.admit()).toBeDefined();
});

test("a late success of a decision admitted before the breaker opened does not end the pause", () => {
  const { breaker, clock } = setup();
  const early = admitted(breaker); // still in flight when the breaker opens
  open(breaker);
  early.success();
  expect(breaker.admit()).toBeUndefined();
  clock.ms += BREAKER_OFF_MS - 1;
  expect(breaker.admit()).toBeUndefined();
  // The pause ends when it was due, and the trial still turns Jev on again.
  clock.ms += 1;
  const trial = admitted(breaker);
  expect(breaker.admit()).toBeUndefined();
  trial.success();
  expect(breaker.admit()).toBeDefined();
});

test("only the trial's own result ends the trial", () => {
  const { breaker, clock } = setup();
  const early = admitted(breaker);
  const other = admitted(breaker);
  open(breaker);
  clock.ms += BREAKER_OFF_MS;
  const trial = admitted(breaker);
  early.success();
  expect(breaker.admit()).toBeUndefined();
  expect(other.failure()).toBe(false);
  expect(breaker.admit()).toBeUndefined();
  trial.success();
  expect(breaker.admit()).toBeDefined();
});

test("a result from before the pause does not touch the count of a breaker that closed again", () => {
  const { breaker, clock } = setup();
  const early = admitted(breaker);
  const other = admitted(breaker);
  open(breaker);
  clock.ms += BREAKER_OFF_MS;
  admitted(breaker).success();
  fail(breaker);
  fail(breaker);
  early.success();
  expect(other.failure()).toBe(false);
  expect(fail(breaker)).toBe(true);
});

test("disable turns Jev off for good: no pause ends it and no result reopens it", () => {
  const { breaker, clock } = setup();
  const first = admitted(breaker);
  const second = admitted(breaker);
  first.disable();
  expect(breaker.admit()).toBeUndefined();
  second.success();
  expect(second.failure()).toBe(false);
  clock.ms += 10 * BREAKER_OFF_MS;
  expect(breaker.admit()).toBeUndefined();
});

test("a decision admitted before the pause can still turn Jev off for good", () => {
  const { breaker, clock } = setup();
  const early = admitted(breaker);
  open(breaker);
  early.disable();
  clock.ms += BREAKER_OFF_MS;
  expect(breaker.admit()).toBeUndefined();
});
