import { describe, expect, it } from "vitest";
import { cardById, deckCards, influenceCards, stationSides } from "./catalogue.ts";
import { dealGame } from "./setup.ts";
import { viewFor } from "./view.ts";
import type { GameConfig, GameState } from "./state.ts";

const config: GameConfig = { seats: 2, influences: false, kickstarter: false };
const withInfluences: GameConfig = { ...config, influences: true };

function influencesIn(state: GameState, zone: readonly string[]): string[] {
  return zone.filter((id) => cardById(state.cards[id]).type === "influence");
}

function zones(state: GameState): string[] {
  return [
    ...state.deck,
    ...state.discard,
    ...state.supply,
    ...state.hands.flat(),
    ...state.play,
    ...state.removedStations,
    ...state.bases.flatMap((base) => [base.station.card, ...base.modules.map((m) => m.card)]),
  ];
}

function deckOrder(state: GameState): string[] {
  return state.deck.map((id) => state.cards[id]);
}

describe("dealGame", () => {
  it("R3.1–R3.7: deals two hidden Stations, three cards and Credits each, and five Supply cards", () => {
    const state = dealGame(config, "setup");
    expect(state.config).toStrictEqual(config);
    expect(state.bases).toHaveLength(2);
    for (const base of state.bases) {
      expect(base.station.side).toBe("terran_outpost");
      expect(base.station.revealed).toBe(false);
      expect(cardById(state.cards[base.station.card]).type).toBe("station");
      expect(base.modules).toEqual([]);
    }
    expect(state.removedStations).toHaveLength(4);
    const stations = [...state.bases.map((base) => base.station.card), ...state.removedStations];
    expect(stations.map((id) => state.cards[id]).sort()).toEqual(
      stationSides(config)
        .map((card) => card.id)
        .sort(),
    );
    expect(state.hands.map((hand) => hand.length)).toEqual([3, 3]);
    expect(state.credits).toEqual([3, 3]);
    expect(state.supply).toHaveLength(5);
    expect(state.deck).toHaveLength(65);
    const dealt = [...state.deck, ...state.supply, ...state.hands.flat()];
    expect(dealt.map((id) => state.cards[id]).sort()).toEqual(deckCards(config).sort());
    expect(state.discard).toEqual([]);
    expect(state.play).toEqual([]);
    expect(state.stack).toEqual([]);
    expect(state.pending).toBeNull();
    expect(state.counters).toEqual({ frames: 0, decisions: 0 });
    expect(state.result).toBeNull();
    expect(state.influencesInGame).toEqual([]);
    expect(state.turn).toEqual({ number: 1, seat: state.turn.seat, step: "agent", work: 0 });
  });

  it.each([2, 3, 4, 5, 6])("R3.1: conserves every physical card for %i seats", (seats) => {
    const state = dealGame({ ...config, seats }, "conservation");
    const all = zones(state);
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(Object.keys(state.cards).sort());
    expect(Object.keys(state.cards)).toEqual(
      Array.from({ length: 82 }, (_, i) => `c${String(i + 1)}`),
    );
    expect(state.hands.map((hand) => hand.length)).toEqual(Array<number>(seats).fill(3));
    expect(state.bases).toHaveLength(seats);
    expect(state.credits).toEqual(Array<number>(seats).fill(3));
    expect(state.removedStations).toHaveLength(6 - seats);
  });

  it("R3.2, R3.5: honours startingSeat 1 and deals each hand together clockwise", () => {
    const state = dealGame({ ...config, seats: 3, startingSeat: 1 }, "clockwise");
    expect(state.turn.seat).toBe(1);
    // Six shuffled Stations get c1–c6; the shuffled Deck begins at c7.
    expect(state.hands).toEqual([
      ["c13", "c14", "c15"],
      ["c7", "c8", "c9"],
      ["c10", "c11", "c12"],
    ]);
    expect(state.supply).toEqual(["c16", "c17", "c18", "c19", "c20", "c21"]);
    expect(state.deck[0]).toBe("c22");
  });

  it("R3.2: honours an explicit zero and randomly chooses every seat across seeds", () => {
    expect(dealGame({ ...config, startingSeat: 0 }, "zero").turn.seat).toBe(0);
    const seats = new Set(
      Array.from(
        { length: 40 },
        (_, i) => dealGame({ ...config, seats: 6 }, `seat-${String(i)}`).turn.seat,
      ),
    );
    expect([...seats].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("R3.6: deals nine Supply cards for six seats, leaving 49 in the Deck", () => {
    const state = dealGame({ ...config, seats: 6 }, "short-deck");
    expect(state.supply).toHaveLength(9);
    expect(state.deck).toHaveLength(49);
    expect(state.hands.flat()).toHaveLength(18);
  });

  it("replays identically and different seeds change the actual Deck order", () => {
    const first = dealGame(config, "repeat");
    expect(dealGame(config, "repeat")).toStrictEqual(first);
    expect(deckOrder(dealGame(config, "different"))).not.toEqual(deckOrder(first));
  });

  it("assigns c1 after shuffling so it does not identify one catalogue card", () => {
    const identities = new Set(
      Array.from({ length: 20 }, (_, i) => dealGame(config, `identity-${String(i)}`).cards.c1),
    );
    expect(identities.size).toBeGreaterThan(1);
  });

  it("round-trips through JSON without dropping undefined fields", () => {
    for (const settings of [config, { ...config, startingSeat: 1 }]) {
      const state = dealGame(settings, "json");
      expect(JSON.parse(JSON.stringify(state))).toStrictEqual(state);
      expect(state.rng).toHaveLength(4);
      expect(state.rng.every((word) => Number.isInteger(word) && word >= 0 && word < 2 ** 32)).toBe(
        true,
      );
    }
  });

  it("does not mutate or retain the caller's config", () => {
    const settings = { ...config };
    const before = { ...settings };
    const state = dealGame(settings, "independent");
    expect(settings).toEqual(before);
    settings.seats = 6;
    expect(state.config.seats).toBe(2);
    expect(dealGame(Object.freeze(before), "independent")).toStrictEqual(state);
  });

  it.each([0, 1, 7, -1, 2.5, NaN, Infinity])("rejects invalid seat count %s", (seats) => {
    expect(() => dealGame({ ...config, seats }, "invalid")).toThrow(/seats/);
  });

  it.each([-1, 2, 0.5, NaN, Infinity])("rejects invalid starting seat %s", (startingSeat) => {
    expect(() => dealGame({ ...config, startingSeat }, "invalid")).toThrow(/startingSeat/);
  });

  it.each([2, 3, 4, 5, 6])(
    "R3.4: with Influences, %i seats have 84 cards in hands, Supply and Deck, 8 of them Influences",
    (seats) => {
      const state = dealGame({ ...withInfluences, seats }, "influences");
      expect(state.config).toStrictEqual({ ...withInfluences, seats });
      const dealt = [...state.hands.flat(), ...state.supply, ...state.deck];
      expect(dealt).toHaveLength(84);
      const influences = influencesIn(state, dealt);
      expect(influences).toHaveLength(8);
      expect(influences.map((id) => state.cards[id]).sort()).toEqual(
        influenceCards(withInfluences)
          .map((card) => card.id)
          .sort(),
      );
      const others = dealt.filter((id) => !influences.includes(id));
      expect(others.map((id) => state.cards[id]).sort()).toEqual(deckCards(config).sort());
      // Six Stations, then the 84 Deck cards: every physical card is in one zone.
      const all = zones(state);
      expect(new Set(all).size).toBe(all.length);
      expect(all.sort()).toEqual(Object.keys(state.cards).sort());
      expect(Object.keys(state.cards)).toHaveLength(90);
      expect(state.hands.map((hand) => hand.length)).toEqual(Array<number>(seats).fill(3));
      expect(state.supply).toHaveLength(3 + seats);
      expect(state.deck).toHaveLength(84 - 3 * seats - (3 + seats));
      expect(state.discard).toEqual([]);
      expect(state.credits).toEqual(Array<number>(seats).fill(3));
    },
  );

  it("R3.4, R3.8: shuffles the Influences in before any deal, so they reach hands, Supply and Deck", () => {
    const tops = new Set<boolean>();
    let inHands = 0;
    let inSupply = 0;
    for (let i = 0; i < 40; i += 1) {
      const state = dealGame({ ...withInfluences, seats: 6 }, `spread-${String(i)}`);
      const held = influencesIn(state, state.hands.flat()).length;
      const shown = influencesIn(state, state.supply).length;
      // A dealt Influence stays where the deal put it; the rest are in the Deck.
      expect(held + shown + influencesIn(state, state.deck).length).toBe(8);
      inHands += held;
      inSupply += shown;
      tops.add(cardById(state.cards[state.deck[0]]).type === "influence");
    }
    expect(inHands).toBeGreaterThan(0);
    expect(inSupply).toBeGreaterThan(0);
    expect([...tops].sort()).toEqual([false, true]);
  });

  it("names the 8 Influences in the game in catalogue order, whatever the shuffle", () => {
    const names = influenceCards(withInfluences).map((card) => card.name);
    expect(names).toHaveLength(8);
    for (const seed of ["one", "two", "three"]) {
      expect(dealGame(withInfluences, seed).influencesInGame).toEqual(names);
    }
    expect(dealGame(config, "one").influencesInGame).toEqual([]);
  });

  it("replays a deal with Influences identically and as plain JSON", () => {
    const first = dealGame(withInfluences, "repeat");
    expect(dealGame(withInfluences, "repeat")).toStrictEqual(first);
    expect(JSON.parse(JSON.stringify(first))).toStrictEqual(first);
    expect(deckOrder(dealGame(withInfluences, "different"))).not.toEqual(deckOrder(first));
  });

  it("R12.2: picks eight of sixteen before dealing, publishes names and replays across 50 seeds", () => {
    const options = { ...config, influences: true, kickstarter: true };
    const seen = new Set<string>();
    const selections = new Set<string>();
    for (let seed = 0; seed < 50; seed++) {
      const state = dealGame(options, String(seed));
      const all = [...state.deck, ...state.supply, ...state.hands.flat()];
      expect(all).toHaveLength(84);
      const selected = influencesIn(state, all).map((id) => state.cards[id]);
      expect(new Set(selected).size).toBe(8);
      const names = influenceCards(options)
        .filter(({ id }) => selected.includes(id))
        .map(({ name }) => name);
      expect(state.influencesInGame).toEqual(names);
      for (const seat of [null, 0, 1]) expect(viewFor(state, seat).influencesInGame).toEqual(names);
      expect(
        Object.values(state.cards)
          .filter((id) => cardById(id).type === "influence")
          .sort(),
      ).toEqual(selected.sort());
      expect(dealGame(options, String(seed))).toEqual(state);
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
      selected.forEach((id) => seen.add(id));
      selections.add(names.join(","));
    }
    expect(seen.size).toBe(16);
    expect(selections.size).toBeGreaterThan(1);
  });

  it.each([
    null,
    {},
    { ...config, seats: "2" },
    { ...config, influences: "false" },
    { ...config, kickstarter: 0 },
    { ...config, startingSeat: null },
  ])("rejects malformed config %j", (settings) => {
    expect(() => dealGame(settings as GameConfig, "invalid")).toThrow(/config/);
  });
});
