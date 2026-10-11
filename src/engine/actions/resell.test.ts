import { expect, it } from "vitest";
import { ask } from "../decisions.ts";
import { gameRegistry } from "../game.ts";
import { applyChoice, push, run, type Registry } from "../loop.ts";
import { dealGame } from "../setup.ts";
import type { GameState } from "../state.ts";
import { pushAction } from "./index.ts";

const registry: Registry = {
  ...gameRegistry,
  handlers: {
    ...gameRegistry.handlers,
    finished: (state) => ({
      state: ask(state, {
        seat: 0,
        kind: "finished",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      }),
    }),
  },
};

function fixture(): GameState {
  return push(
    {
      ...dealGame({ seats: 2, influences: false, kickstarter: false }, "satellite"),
      cards: {
        s0: "stn-dark-side",
        s1: "stn-imbrium",
        i0: "inf-quarantine",
        i1: "inf-entropic-cascade",
        i2: "inf-terran-embargo",
        m0: "mod-depot",
        m1: "mod-inflatable-habitat",
        a0: "agt-space-unicorn",
      },
      bases: ["s0", "s1"].map((card) => ({
        station: { card, side: "terran_outpost", revealed: false },
        modules: [],
      })),
      hands: [[], []],
      deck: [],
      discard: [],
      removedStations: [],
      supply: ["i0", "i1", "m0", "m1", "a0"],
    },
    "finished",
  );
}

function choose(state: GameState, option: string) {
  if (!state.pending) throw new Error("Expected Resell decision");
  const result = applyChoice(
    state,
    { seat: state.pending.seat, decision: state.pending.id, option },
    registry,
  );
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

it("R7.18: counts Supply Influences at resolution and Resells exactly that many for the builder", () => {
  // Schedule with one Influence, then add another before the action resolves.
  const start = pushAction(
    { ...fixture(), supply: ["i0", "m0", "m1", "a0"] },
    { op: "resell_per_supply_influence" },
    1,
  );
  const atResolution = { ...start, supply: ["i0", "i1", "m0", "m1", "a0"] };
  const before = structuredClone(atResolution);
  const asked = run(atResolution, registry);
  expect(asked.state.pending).toMatchObject({ kind: "resell", seat: 1 });
  expect(asked.state.pending?.options.map(({ card }) => card)).toEqual(["m0", "m1", "a0"]);
  const first = choose(asked.state, "m0");
  expect(first.state.credits).toEqual([3, 4]);
  // A later Supply change cannot change the repetition count already captured.
  const second = choose({ ...first.state, supply: [...first.state.supply, "i2"] }, "a0");
  expect(second.state.credits).toEqual([3, 5]);
  expect(second.state.supply).toEqual(["i0", "i1", "m1", "i2"]);
  expect(second.state.discard).toEqual(["m0", "a0"]);
  expect(second.state.pending?.kind).toBe("finished");
  expect(second.state.stack.map(({ kind }) => kind)).toEqual(["finished"]);
  expect([...first.events, ...second.events].map(({ type }) => type)).toEqual([
    "card_resold",
    "card_resold",
  ]);
  expect(atResolution).toEqual(before);
});

it("R7.18: stops when the Supply runs out of resellable cards", () => {
  const start = pushAction(
    { ...fixture(), supply: ["i0", "i1", "m0"] },
    { op: "resell_per_supply_influence" },
    0,
  );
  const result = run(start, registry);
  expect(result.state.supply).toEqual(["i0", "i1"]);
  expect(result.state.discard).toEqual(["m0"]);
  expect(result.state.credits).toEqual([4, 3]);
  expect(result.state.pending?.kind).toBe("finished");
});

it("R8.5: checks victory after each Resell and interrupts the remaining ones", () => {
  const start = pushAction(
    { ...fixture(), credits: [19, 3] },
    { op: "resell_per_supply_influence" },
    0,
  );
  const asked = run(start, registry);
  const result = choose(asked.state, "m0");
  expect(result.events.map(({ type }) => type)).toEqual(["card_resold", "game_ended"]);
  expect(result.state.result).toMatchObject({ reason: "victory", winners: [0] });
  expect(result.state.supply).toEqual(["i0", "i1", "m1", "a0"]);
});
