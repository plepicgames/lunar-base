import fc from "fast-check";
import { expect, test } from "vitest";
import { createGame, viewFor, type Seat } from "../engine/index.ts";
import { randomMaker, type DecisionMaker, type DecisionRequest } from "./maker.ts";

const state = createGame(
  { seats: 6, influences: false, kickstarter: false, startingSeat: 0 },
  "maker-game",
);

function request(ids: string[], seat: Seat = 0): DecisionRequest {
  return {
    view: viewFor(state, seat),
    decision: {
      id: "decision",
      seat,
      kind: "test",
      options: ids.map((id) => ({ id, label: id })),
    },
    seat,
    events: [],
  };
}

async function answers(maker: DecisionMaker, count: number, seat: Seat = 0) {
  const input = request(["a", "b", "c"], seat);
  const signal = new AbortController().signal;
  const result = [];
  for (let i = 0; i < count; i += 1) result.push(await maker.decide(input, signal));
  return result;
}

test("randomMaker distributes 1,000 three-option decisions uniformly", async () => {
  const results = await answers(randomMaker("distribution", 0), 1_000);
  for (const id of ["a", "b", "c"]) {
    const count = results.filter((answer) => answer === id).length;
    expect(count).toBeGreaterThanOrEqual(280);
    expect(count).toBeLessThanOrEqual(390);
  }
});

test("the same seed and seat reproduce the stream; another seed or seat changes it", async () => {
  const first = await answers(randomMaker("repeat", 0), 100);
  expect(await answers(randomMaker("repeat", 0), 100)).toEqual(first);
  expect(await answers(randomMaker("repeat", 1), 100, 1)).not.toEqual(first);
  expect(await answers(randomMaker("different", 0), 100)).not.toEqual(first);
});

test("always resolves to an offered id for 1 to 300 options, even when aborted", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.string(),
      fc.integer({ min: 0, max: 5 }),
      fc.uniqueArray(fc.string(), { minLength: 1, maxLength: 300, size: "max" }),
      async (seed, seat, ids) => {
        const maker = randomMaker(seed, seat);
        const input = request(ids, seat);
        const signal = AbortSignal.abort();
        for (let i = 0; i < 10; i += 1) {
          expect(ids).toContain(await maker.decide(input, signal));
        }
      },
    ),
    { seed: 21, numRuns: 300 },
  );
  // Cover every option count in addition to the generated arbitrary option ids.
  for (let count = 1; count <= 300; count += 1) {
    const ids = Array.from({ length: count }, (_, i) => `option-${String(i)}`);
    expect(ids).toContain(
      await randomMaker("limits", 0).decide(request(ids), new AbortController().signal),
    );
  }
});

test("maker calls leave the game, request and other makers' streams untouched", async () => {
  const before = structuredClone(state);
  const input = request(["only"]);
  input.events.push(
    { type: "turn_started", seat: 0, turn: 1, text: "First turn" },
    { type: "turn_started", seat: 1, turn: 2, text: "Second turn" },
  );
  const savedRequest = structuredClone(input);
  const independent = randomMaker("independent", 0);
  await answers(randomMaker("independent", 0), 50);
  expect(await answers(independent, 100)).toEqual(
    await answers(randomMaker("independent", 0), 100),
  );
  await expect(independent.decide(input, new AbortController().signal)).resolves.toBe("only");
  expect(input).toEqual(savedRequest);
  expect(state).toEqual(before);
});
