import { describe, expect, it } from "vitest";
import { orbsOf, placedCards } from "./base.ts";
import { cardById } from "./catalogue.ts";
import { eventFor } from "./events.ts";
import { createGame, gameRegistry } from "./game.ts";
import { applyChoice, push, run } from "./loop.ts";
import { dealGame } from "./setup.ts";
import type { GameState } from "./state.ts";
import { buildState, cardOfState, type BaseSpec } from "./testing/build.ts";
import { pushTurn } from "./turn.ts";
import { viewFor } from "./view.ts";
import { pushAction } from "./actions/index.ts";

const config = { seats: 3, influences: false, kickstarter: false, startingSeat: 0 };
function game(specs: readonly BaseSpec[]): GameState {
  return {
    ...dealGame({ ...config, seats: specs.length }, "stations"),
    ...buildState(specs),
    hands: specs.map(() => []),
    supply: [],
    deck: [],
    discard: [],
    removedStations: [],
  };
}
function choose(state: GameState, option: string) {
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
function exchange(state: GameState, seat: number, target: number) {
  const asked = run(pushAction(pushTurn(state), { op: "exchange_station" }, seat), gameRegistry);
  return state.config.seats === 2 ? asked : choose(asked.state, String(target));
}

it.each([2, 3, 4, 5, 6])(
  "R12.1: shuffles ten Stations and removes the unused ones with %i seats",
  (seats) => {
    const dealt = new Set<string>();
    const orders = new Set<string>();
    for (let seed = 0; seed < 50; seed++) {
      const state = createGame({ ...config, seats, kickstarter: true }, String(seed));
      const stations = state.bases.map(({ station }) => station.card);
      expect(stations).toHaveLength(seats);
      expect(state.removedStations).toHaveLength(10 - seats);
      const pool = [...stations, ...state.removedStations].map((id) => state.cards[id]);
      expect(new Set(pool).size).toBe(10);
      expect(pool.filter((id) => cardById(id).set === "kickstarter")).toHaveLength(4);
      orders.add(pool.join(","));
      stations.forEach((id) => dealt.add(state.cards[id]));
      const publicView = JSON.stringify(viewFor(state, null));
      for (const id of pool) expect(publicView).not.toContain(id);
      expect(createGame({ ...config, seats, kickstarter: true }, String(seed))).toEqual(state);
    }
    expect([...dealt].some((id) => id.startsWith("ks-stn-"))).toBe(true);
    expect(orders.size).toBeGreaterThan(1);
  },
);

it("R12.2: starts with both options and eight public Influence names", () => {
  const state = createGame({ ...config, kickstarter: true, influences: true }, "both");
  expect(viewFor(state, null).influencesInGame).toHaveLength(8);
  expect(state.pending).not.toBeNull();
});

describe("R12.3 Exchange", () => {
  it("swaps whole Stations at the origin, preserves Modules and joints, and derives both Orb totals", () => {
    const state = game([
      { station: "ks-stn-braun", side: "named", modules: [["mod-fusion-reactor", -1, 0, 0]] },
      { station: "ks-stn-korolev", side: "named", modules: [["mod-fusion-reactor", -1, 0, 0]] },
      { station: "stn-imbrium" },
    ]);
    const before = structuredClone(state);
    const oldOrbs = state.bases.map((base) => orbsOf(base, cardOfState(state)));
    const result = exchange(state, 0, 1);
    expect(result.state.bases[0].station).toEqual(state.bases[1].station);
    expect(result.state.bases[1].station).toEqual(state.bases[0].station);
    expect(result.state.bases[2]).toEqual(state.bases[2]);
    for (const seat of [0, 1]) {
      const base = result.state.bases[seat];
      expect(base.modules).toEqual(state.bases[seat].modules);
      expect(placedCards(base, cardOfState(result.state))[0].placement).toEqual({
        x: 0,
        y: 0,
        q: 0,
      });
      expect(viewFor(result.state, seat).players[seat].base.orbs).toEqual({
        ...oldOrbs[seat],
        yellow: oldOrbs[seat].yellow + (seat === 0 ? -2 : 2),
        red: oldOrbs[seat].red + (seat === 0 ? 2 : -2),
      });
    }
    expect(state).toEqual(before);
  });

  it("moves a secret named side to its new holder without revealing it in options, views or events", () => {
    const state = game([
      { station: "ks-stn-braun" },
      { station: "ks-stn-kafka", side: "named" },
      { station: "stn-imbrium" },
    ]);
    const asked = run(
      pushAction(pushTurn(state), { op: "exchange_station" }, 1),
      gameRegistry,
    ).state;
    expect(JSON.stringify(asked.pending)).not.toContain("braun");
    const result = choose(asked, "0");
    expect(result.state.bases[1].station).toEqual({
      card: "c1",
      side: "terran_outpost",
      revealed: false,
    });
    expect(viewFor(result.state, 1).players[1].base.station.named).toBe("ks-stn-braun");
    for (const viewer of [0, 2, null]) {
      expect(viewFor(result.state, viewer).players[1].base.station.named).toBeNull();
      expect(JSON.stringify(result.events.map((event) => eventFor(event, viewer)))).not.toContain(
        "braun",
      );
    }
    expect(result.state.bases[0].station).toEqual({ card: "c2", side: "named", revealed: true });
    expect(result.events).toContainEqual({ type: "stations_exchanged", seats: [1, 0] });
    expect(viewFor(result.state, null).players[0].base.station.named).toBe("ks-stn-kafka");
  });
});

describe("R12.4 Kafka", () => {
  it.each([3, 4, 5, 6])(
    "asks the holder D14 before the next printed action with %i seats",
    (seats) => {
      const state = game(
        Array.from({ length: seats }, (_, seat) => ({
          station: seat === 1 ? "ks-stn-kafka" : "stn-shackleton",
        })),
      );
      const withHand = {
        ...state,
        cards: { ...state.cards, h1: "mod-fusion-reactor" },
        hands: state.hands.map((hand, seat) => (seat === 1 ? ["h1"] : hand)),
      };
      const text = push(pushTurn(withHand), "box", {
        seat: 1,
        actions: [{ op: "flip", who: "own" }, { op: "gain_credit_per_hand_card" }],
        position: 0,
        repeated: 0,
        deferred: [],
      });
      const asked = run(text, gameRegistry);
      expect(asked.state.pending).toMatchObject({ seat: 1, kind: "exchange_station" });
      expect(asked.state.pending?.options.map(({ target }) => target)).toEqual(
        Array.from({ length: seats }, (_, seat) => seat).filter((seat) => seat !== 1),
      );
      expect(asked.state.bases[1].station).toEqual({ card: "c2", side: "named", revealed: true });
      expect(asked.events.map(({ type }) => type)).toContain("station_flipped");
      expect(asked.state.credits[1]).toBe(3);
      const result = choose(asked.state, "0");
      expect(result.state.credits[1]).toBe(4);
      expect(result.state.bases[0].station.card).toBe("c2");
      expect(result.state.bases[1].station.card).toBe("c1");
      expect(result.state.pending?.kind).toBe("main_action");
      expect(result.events.filter(({ type }) => type === "stations_exchanged")).toHaveLength(1);
    },
  );

  it("with two seats Exchanges automatically before continuing", () => {
    const state = game([{ station: "stn-shackleton" }, { station: "ks-stn-kafka" }]);
    const result = run(pushAction(pushTurn(state), { op: "flip", who: "own" }, 1), gameRegistry);
    expect(result.state.pending).toMatchObject({ seat: 0, kind: "main_action" });
    expect(result.state.bases.map(({ station }) => station)).toEqual([
      { card: "c2", side: "named", revealed: true },
      { card: "c1", side: "terran_outpost", revealed: false },
    ]);
    expect(result.events.map(({ type }) => type)).toEqual([
      "station_flipped",
      "stations_exchanged",
      "turn_started",
    ]);
  });

  it("does not Exchange when Kafka Flips back to Terran Outpost", () => {
    const state = game([
      { station: "ks-stn-kafka", side: "named" },
      { station: "stn-shackleton" },
      { station: "stn-imbrium" },
    ]);
    const result = run(pushAction(pushTurn(state), { op: "flip", who: "own" }, 0), gameRegistry);
    expect(result.state.pending?.kind).toBe("main_action");
    expect(result.state.bases[0].station).toEqual({
      card: "c1",
      side: "terran_outpost",
      revealed: true,
    });
    expect(result.events.some(({ type }) => type === "stations_exchanged")).toBe(false);
  });
});

it.each([
  [
    "braun",
    "Braun",
    ["Draft", "Build", "Build, An opponent Resells, Draft"],
    { yellow: 2 },
    1,
    ["flag"],
  ],
  ["korolev", "Korolev", ["Draft", "Build", "Discard, Draft x2"], { red: 2 }, 1, ["rocket"]],
  ["tipu", "Tipu", ["Draft", "Build", "Build, Draft, Discard"], { blue: 2 }, 2, []],
  ["kafka", "Kafka", ["Draft", "Build"], {}, 0, []],
] as const)(
  "R12 Station table: %s supplies its printed D2 boxes and values",
  (id, name, boxes, orbs, colonists, achievements) => {
    const state = game([{ station: `ks-stn-${id}`, side: "named" }, { station: "stn-shackleton" }]);
    const asked = run(pushTurn(state), gameRegistry).state;
    expect(asked.pending?.options.map(({ label }) => label)).toEqual(
      boxes.map((box) => `${name}: ${box}`),
    );
    expect(viewFor(asked, 0).players[0]).toMatchObject({
      colonists,
      achievements,
      base: { orbs: { red: 0, blue: 0, yellow: 0, wild: 0, ...orbs } },
    });
  },
);
