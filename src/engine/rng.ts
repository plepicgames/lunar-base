// The engine's only source of randomness: xoshiro128** over a plain JSON state.
// Every function is pure. A change to any algorithm here changes every replay,
// so the test vectors in rng.test.ts pin all of them.

/** Four unsigned 32-bit integers. Never all zero: that state only produces zeros. */
export type RngState = readonly [number, number, number, number];

export interface RngStep {
  readonly value: number;
  readonly state: RngState;
}

const UINT32_RANGE = 2 ** 32;
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

/**
 * One step of xoshiro128** 1.1 (Blackman and Vigna,
 * https://prng.di.unimi.it/xoshiro128starstar.c). The value is an integer
 * from 0 to 2^32 - 1.
 */
export function nextUint32(state: RngState): RngStep {
  let [s0, s1, s2, s3] = state;
  const value = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
  const t = s1 << 9;
  s2 ^= s0;
  s3 ^= s1;
  s1 ^= s2;
  s0 ^= s3;
  s2 ^= t;
  s3 = rotl(s3, 11);
  return { value, state: [s0 >>> 0, s1 >>> 0, s2 >>> 0, s3 >>> 0] };
}

// One state word: 32-bit FNV-1a over the byte `lane` and then the seed's
// UTF-16 code units, each as two bytes with the low byte first, finished with
// the 32-bit finalizer of MurmurHash3 (fmix32).
function hashLane(seed: string, lane: number): number {
  let h = Math.imul(FNV_OFFSET_BASIS ^ lane, FNV_PRIME);
  for (let i = 0; i < seed.length; i += 1) {
    const unit = seed.charCodeAt(i);
    h = Math.imul(h ^ (unit & 0xff), FNV_PRIME);
    h = Math.imul(h ^ (unit >>> 8), FNV_PRIME);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Turns a seed string into a generator state. Word i is `hashLane(seed, i)`.
 * Any string is a valid seed, the empty string included. The hash spreads a
 * seed over the state; it is not cryptographic.
 */
export function seedToState(seed: string): RngState {
  const state: RngState = [
    hashLane(seed, 0),
    hashLane(seed, 1),
    hashLane(seed, 2),
    hashLane(seed, 3),
  ];
  // No seed is known to hash to four zeros, but the generator cannot leave that state.
  return state.every((word) => word === 0) ? [1, 0, 0, 0] : state;
}

/**
 * A uniform integer from 0 to n - 1, for an integer n from 1 to 2^32.
 *
 * Rejection sampling: outputs at or above the largest multiple of n that fits
 * in 2^32 are thrown away, so every value is equally likely. A call always
 * takes at least one generator step, also for n = 1, and takes one more for
 * each rejected output. Fewer than half of all outputs are rejected for any n.
 */
export function nextInt(state: RngState, n: number): RngStep {
  if (!Number.isInteger(n) || n < 1 || n > UINT32_RANGE) {
    throw new RangeError(`nextInt: n must be an integer from 1 to 2^32, got ${String(n)}`);
  }
  const limit = UINT32_RANGE - (UINT32_RANGE % n);
  let step = nextUint32(state);
  while (step.value >= limit) {
    step = nextUint32(step.state);
  }
  return { value: step.value % n, state: step.state };
}

/**
 * Fisher-Yates shuffle into a new list. For i from the last index down to 1
 * it swaps item i with item `nextInt(state, i + 1)`. A list of 0 or 1 items
 * takes no generator step.
 */
export function shuffle<T>(
  state: RngState,
  list: readonly T[],
): { readonly list: T[]; readonly state: RngState } {
  const result = [...list];
  let current = state;
  for (let i = result.length - 1; i > 0; i -= 1) {
    const step = nextInt(current, i + 1);
    const picked = result[step.value];
    result[step.value] = result[i];
    result[i] = picked;
    current = step.state;
  }
  return { list: result, state: current };
}
