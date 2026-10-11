import { describe, expect, test } from "vitest";
import { nextInt, nextUint32, seedToState, shuffle, type RngState } from "./rng.ts";

const UINT32 = 2 ** 32;

function draw(state: RngState, count: number): { values: number[]; state: RngState } {
  const values: number[] = [];
  let current = state;
  for (let i = 0; i < count; i += 1) {
    const step = nextUint32(current);
    values.push(step.value);
    current = step.state;
  }
  return { values, state: current };
}

function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < UINT32;
}

describe("nextUint32", () => {
  // The values come from the reference C implementation of xoshiro128** 1.1
  // (Blackman and Vigna, https://prng.di.unimi.it/xoshiro128starstar.c) with s = {1, 2, 3, 4}.
  test("gives the reference xoshiro128** outputs for the state [1, 2, 3, 4]", () => {
    const { values, state } = draw([1, 2, 3, 4], 8);
    expect(values).toEqual([
      11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849,
    ]);
    expect(state).toEqual([857776784, 3957087773, 2428778008, 3837013768]);
  });

  test("keeps every state word an unsigned 32-bit integer", () => {
    let state: RngState = [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff];
    for (let i = 0; i < 1000; i += 1) {
      const step = nextUint32(state);
      expect(isUint32(step.value)).toBe(true);
      expect(step.state.every(isUint32)).toBe(true);
      state = step.state;
    }
  });

  test("continues the same stream after a JSON round trip", () => {
    const state = draw(seedToState("round trip"), 5).state;
    const copy = JSON.parse(JSON.stringify(state)) as RngState;
    expect(copy).toEqual(state);
    expect(draw(copy, 5)).toEqual(draw(state, 5));
  });
});

describe("seedToState", () => {
  test("gives the pinned state for two seed strings", () => {
    expect(seedToState("lunar-base")).toEqual([1720029934, 2960894160, 4243910225, 1875815513]);
    // Covers a surrogate pair and a non-ASCII code unit.
    expect(seedToState("Kuu \u{1F319} №2")).toEqual([
      3944696209, 2180779475, 2608022025, 1494750386,
    ]);
  });

  test("accepts the empty string", () => {
    expect(seedToState("")).toEqual([91794203, 90457223, 3689677661, 893644233]);
  });

  test("gives the same state for the same seed and another for another seed", () => {
    expect(seedToState("a")).toEqual(seedToState("a"));
    expect(seedToState("a")).not.toEqual(seedToState("b"));
    expect(seedToState("ab")).not.toEqual(seedToState("ba"));
  });
});

describe("nextInt", () => {
  test("gives each of 3 values between 9,500 and 10,500 times in 30,000 draws", () => {
    const counts = [0, 0, 0];
    let state = seedToState("lunar-base");
    for (let i = 0; i < 30_000; i += 1) {
      const step = nextInt(state, 3);
      counts[step.value] = (counts[step.value] ?? 0) + 1;
      state = step.state;
    }
    expect(counts).toHaveLength(3);
    for (const count of counts) {
      expect(count).toBeGreaterThanOrEqual(9_500);
      expect(count).toBeLessThanOrEqual(10_500);
    }
  });

  test("returns the raw output when n is 2^32", () => {
    expect(nextInt([1, 2, 3, 4], UINT32)).toEqual(nextUint32([1, 2, 3, 4]));
  });

  test("returns 0 for n = 1 and still advances the state", () => {
    const step = nextInt([1, 2, 3, 4], 1);
    expect(step.value).toBe(0);
    expect(step.state).toEqual(nextUint32([1, 2, 3, 4]).state);
  });

  test("rejects an output in the uneven tail and draws again", () => {
    // For n = 2^31 + 1 the accepted range is exactly [0, n): every output at or above n is
    // rejected. The 8th, 9th and 10th reference outputs are above it.
    const n = 2 ** 31 + 1;
    const start = draw([1, 2, 3, 4], 7).state;
    let expected = nextUint32(start);
    let rejected = 0;
    while (expected.value >= n) {
      expected = nextUint32(expected.state);
      rejected += 1;
    }
    expect(rejected).toBeGreaterThanOrEqual(3);
    expect(nextInt(start, n)).toEqual(expected);
  });

  test("reduces an accepted output modulo n", () => {
    // 2^32 mod 7 is 4, so only the top 4 outputs are rejected; 70819200 is accepted.
    const start = draw([1, 2, 3, 4], 3).state;
    expect(nextInt(start, 7).value).toBe(70819200 % 7);
  });

  test.each([0, -1, 1.5, UINT32 + 1, Number.NaN, Number.POSITIVE_INFINITY])(
    "throws a RangeError for n = %s",
    (n) => {
      expect(() => nextInt([1, 2, 3, 4], n)).toThrow(RangeError);
    },
  );
});

describe("shuffle", () => {
  const zeroToNine = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  test("gives the pinned order of 0..9 for the seed lunar-base", () => {
    const result = shuffle(seedToState("lunar-base"), zeroToNine);
    expect(result.list).toEqual([1, 5, 4, 8, 2, 7, 6, 9, 0, 3]);
    expect(result.state).toEqual([2920810031, 1056231758, 2554018981, 3076076603]);
  });

  test("returns a new list with the same items", () => {
    const list = ["a", "b", "c", "d", "e"];
    const result = shuffle(seedToState("items"), list);
    expect(result.list).not.toBe(list);
    expect(result.list.toSorted()).toEqual(list);
    expect(list).toEqual(["a", "b", "c", "d", "e"]);
  });

  test("draws nothing for a list of 0 or 1 items", () => {
    const state = seedToState("short");
    expect(shuffle(state, [])).toEqual({ list: [], state });
    expect(shuffle(state, ["only"])).toEqual({ list: ["only"], state });
  });

  test("reaches every order of 3 items", () => {
    const seen = new Set<string>();
    let state = seedToState("orders");
    for (let i = 0; i < 200; i += 1) {
      const result = shuffle(state, [0, 1, 2]);
      seen.add(result.list.join(""));
      state = result.state;
    }
    expect(seen.size).toBe(6);
  });
});

describe("inputs", () => {
  test("no call throws on or changes a frozen state and a frozen list", () => {
    const state = Object.freeze(seedToState("frozen"));
    const before = [...state];
    const list = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    expect(() => nextUint32(state)).not.toThrow();
    expect(() => nextInt(state, 6)).not.toThrow();
    expect(() => shuffle(state, list)).not.toThrow();

    expect(state).toEqual(before);
    expect(list).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(nextUint32(state).state).not.toBe(state);
    expect(shuffle(state, list).list).not.toBe(list);
  });
});
