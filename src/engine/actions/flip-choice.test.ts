import { describe, expect, it } from "vitest";
import { type FlipWho } from "../catalogue.ts";
import { gameRegistry } from "../game.ts";
import { applyChoice, run, type Resolved } from "../loop.ts";
import { dealGame } from "../setup.ts";
import type { DecisionOption, GameState } from "../state.ts";
import { buildState } from "../testing/build.ts";
import { pushTurn } from "../turn.ts";
import { viewFor } from "../view.ts";
import { actionHandlers, handlerOf, pushAction, type ActionFrame } from "./index.ts";

const STATIONS = [
  "stn-shackleton",
  "stn-imbrium",
  "stn-dark-side",
  "stn-selene-labs",
  "stn-taikotech",
  "stn-the-oasis",
];

function game(seats: number, held: readonly string[] = []): GameState {
  const built = buildState(STATIONS.slice(0, seats).map((station) => ({ station })));
  const dealt = dealGame(
    { seats, startingSeat: 0, influences: false, kickstarter: false },
    "flip-choices",
  );
  const cards = Object.fromEntries(held.map((id, i) => [`h${String(i)}`, id]));
  return {
    ...dealt,
    ...built,
    cards: { ...built.cards, ...cards },
    hands: Array.from({ length: seats }, (_, seat) => (seat === 0 ? Object.keys(cards) : [])),
    credits: Array<number>(seats).fill(10),
    deck: [],
    supply: [],
    discard: [],
    removedStations: [],
  };
}

function askFlip(state: GameState, who: FlipWho, seat = 0): GameState {
  return run(pushAction(pushTurn(state), { op: "flip", who }, seat), gameRegistry).state;
}

function choose(state: GameState, option: string): Resolved {
  const pending = state.pending;
  if (!pending) throw new Error("Expected a decision");
  const result = applyChoice(
    state,
    { seat: pending.seat, decision: pending.id, option },
    gameRegistry,
  );
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

function findOption(
  state: GameState,
  matches: (option: DecisionOption) => boolean,
): DecisionOption {
  const option = state.pending?.options.find(matches);
  if (!option) throw new Error("Expected a matching option");
  return option;
}

function optionOf(state: GameState, label: string): string {
  return findOption(state, (option) => option.label === label).id;
}

function flippedSeats(result: Resolved): number[] {
  return result.events.flatMap((event) =>
    event.type === "station_flipped" ? event.flips.map(({ seat }) => seat) : [],
  );
}

describe("D10: choosing Stations", () => {
  it.each([
    [2, 2, 1, 4],
    [3, 3, 3, 8],
    [4, 4, 6, 16],
    [5, 5, 10, 32],
    [6, 6, 15, 64],
  ])("with %i seats offers %i singles, %i pairs, %i subsets", (seats, singles, pairs, subsets) => {
    const start = game(seats);
    for (const [who, count] of [
      ["any_one", singles],
      ["any_two", pairs],
      ["any_number", subsets],
    ] as const) {
      const action = { op: "flip", who } as const;
      const state = pushAction(start, action, 1);
      const asked = handlerOf(actionHandlers, action)(
        state,
        state.stack.at(-1) as ActionFrame,
        null,
      ).state;
      expect(asked.pending).toMatchObject({ kind: "flip", seat: 1 });
      expect(asked.pending?.options).toHaveLength(count);
      expect(asked.bases).toEqual(start.bases);
    }
  });

  it.each([0, 1, 2])("any_one allows seat 1 to Flip seat %i, including itself", (target) => {
    const asked = askFlip(game(3), "any_one", 1);
    const before = structuredClone(asked);
    const result = choose(asked, optionOf(asked, `Flip Player ${String(target + 1)}'s Station`));
    expect(flippedSeats(result)).toEqual([target]);
    expect(result.state.bases[target].station.side).toBe("named");
    expect(
      result.state.bases.filter((_, seat) => seat !== target).map((base) => base.station.side),
    ).toEqual(["terran_outpost", "terran_outpost"]);
    expect(asked).toEqual(before);
  });

  it("any_two offers each different pair once and Flips both in one event", () => {
    const asked = askFlip(game(3), "any_two");
    expect(asked.pending?.options.map(({ seats }) => seats)).toEqual([
      [0, 1],
      [0, 2],
      [1, 2],
    ]);
    const result = choose(asked, optionOf(asked, "Flip Player 1's Station, Player 3's Station"));
    expect(flippedSeats(result)).toEqual([0, 2]);
    expect(result.events.filter(({ type }) => type === "station_flipped")).toHaveLength(1);
    expect(result.state.bases.map((base) => base.station.side)).toEqual([
      "named",
      "terran_outpost",
      "named",
    ]);
  });

  it("any_two with two players applies its only option without waiting", () => {
    const result = run(
      pushAction(pushTurn(game(2)), { op: "flip", who: "any_two" }, 0),
      gameRegistry,
    );
    expect(flippedSeats(result)).toEqual([0, 1]);
    expect(result.state.pending).toMatchObject({ kind: "main_action" });
    expect(result.state.bases.map((base) => base.station.side)).toEqual(["named", "named"]);
  });

  it("any_number has 64 stable ids and distinct public labels, and every choice Flips exactly its subset", () => {
    const start = game(6);
    const asked = askFlip(start, "any_number");
    const options = asked.pending?.options ?? [];
    expect(options).toHaveLength(64);
    expect(new Set(options.map(({ id }) => id)).size).toBe(64);
    expect(new Set(options.map(({ label }) => label)).size).toBe(64);
    expect(askFlip(structuredClone(start), "any_number").pending?.options).toEqual(options);
    // Hidden Station identities cannot enter labels or option data.
    const changed = {
      ...start,
      cards: { ...start.cards, c1: "stn-the-oasis", c2: "stn-shackleton" },
    };
    expect(askFlip(changed, "any_number").pending?.options).toEqual(options);
    expect(viewFor(asked, 0).pending).toMatchObject({ options });
    expect(viewFor(asked, 1).pending).toEqual({ seat: 0, kind: "flip" });
    for (let mask = 0; mask < 64; mask++) {
      const option = options[mask];
      const seats = [0, 1, 2, 3, 4, 5].filter((seat) => (mask & (1 << seat)) !== 0);
      expect(option.seats).toEqual(seats);
      expect(option.label).toBe(
        seats.length
          ? `Flip ${seats.map((seat) => `Player ${String(seat + 1)}'s Station`).join(", ")}`
          : "Flip no Stations",
      );
      const result = choose(asked, option.id);
      expect(flippedSeats(result)).toEqual(seats);
      expect(result.events.filter(({ type }) => type === "station_flipped")).toHaveLength(
        mask === 0 ? 0 : 1,
      );
      expect(result.state.bases.map((base) => base.station.side)).toEqual(
        [0, 1, 2, 3, 4, 5].map((seat) => (seats.includes(seat) ? "named" : "terran_outpost")),
      );
    }
  });
});

describe("D9 / Q14: Double Agent", () => {
  it.each([
    [3, 0, [1, 2]],
    [2, 0, [1]],
    [2, 1, [0]],
    [4, 0, [1, 3]],
    [4, 3, [0, 2]],
  ] as const)("with %i seats and target %i, Flips %j once", (seats, target, expected) => {
    const started = run(pushTurn(game(seats, ["agt-double-agent"])), gameRegistry).state;
    const asked = choose(started, "h0").state;
    expect(asked.pending).toMatchObject({ kind: "target", seat: 0 });
    expect(asked.pending?.options).toHaveLength(seats);
    const selected = findOption(asked, (option) => option.target === target);
    expect(selected.label).toContain(`Player ${String(target + 1)}`);
    const result = choose(asked, selected.id);
    expect(flippedSeats(result)).toEqual(expected);
    expect(result.events.map(({ type }) => type)).toEqual(["station_flipped", "agent_discarded"]);
    expect(result.state.bases[target].station.side).toBe("terran_outpost");
    for (const seat of expected) expect(result.state.bases[seat].station.side).toBe("named");
  });
});

describe("Flip in printed action order", () => {
  it("Q15: Rebel Captain's second box skips an empty-hand Discard and still Flips two Stations", () => {
    const started = run(pushTurn(game(2, ["agt-rebel-captain"])), gameRegistry).state;
    const played = choose(started, "h0").state;
    expect(played.pending?.kind).toBe("choose_one");
    expect(played.hands[0]).toEqual([]);
    const result = choose(played, "1");
    expect(result.events.map(({ type }) => type)).toEqual(["station_flipped", "agent_discarded"]);
    expect(flippedSeats(result)).toEqual([0, 1]);
    expect(result.state.pending?.kind).toBe("main_action");
  });

  it("Beruang Engineers Built from a box Flips a Station before offering its Build", () => {
    const start = game(2, ["mod-beruang-engineers", "mod-inflatable-habitat"]);
    const boxes = run(pushTurn(start), gameRegistry).state;
    const building = choose(boxes, optionOf(boxes, "Terran Outpost: Build")).state;
    const placement = findOption(building, (option) => option.card === "h0");
    const built = choose(building, placement.id);
    expect(built.events.map(({ type }) => type)).toEqual(["credits_changed", "module_built"]);
    expect(built.state.pending?.kind).toBe("flip");
    expect(built.state.bases[0].modules.map(({ card }) => card)).toEqual(["h0"]);
    expect(built.state.hands[0]).toEqual(["h1"]);
    const flipped = choose(built.state, optionOf(built.state, "Flip Player 1's Station"));
    expect(flipped.events.map(({ type }) => type)).toEqual(["station_flipped"]);
    expect(flipped.state.pending).toMatchObject({ kind: "build", seat: 0 });
    const habitat = findOption(flipped.state, (option) => option.card === "h1");
    const done = choose(flipped.state, habitat.id);
    expect(done.events[0].type).toBe("module_built");
    expect(done.state.bases[0].modules.map(({ card }) => card)).toEqual(["h0", "h1"]);
  });
});
