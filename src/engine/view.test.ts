import { isDeepStrictEqual } from "node:util";
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { createGame, viewFor, type GameState, type Seat } from "./index.ts";
import { seedToState, shuffle } from "./rng.ts";
import { buildState } from "./testing/build.ts";
import { play, seededPicker } from "./testing/play.ts";

const config = { seats: 2, influences: false, kickstarter: false, startingSeat: 0 };
const opening = () => createGame(config, "view-test");

function instanceIds(value: unknown): string[] {
  // Includes ids in object keys and in composite option ids such as c12:0.
  return [...new Set(JSON.stringify(value).match(/\bc\d+\b/g) ?? [])];
}

/** Independent R2.3/R2.4 allow-list, never obtained from a view. */
function visiblePlaces(state: GameState, seat: Seat | null): Set<string> {
  return new Set([
    ...state.supply,
    ...(state.supply.some((id) => state.cards[id] === "ks-inf-transparency")
      ? state.deck.slice(0, 1)
      : state.discard),
    ...state.play,
    ...state.bases.flatMap((base) => [base.station.card, ...base.modules.map(({ card }) => card)]),
    ...(seat === null ? [] : state.hands[seat]),
    ...(state.pending?.seat === seat ? instanceIds(state.pending.options) : []),
  ]);
}

function forbiddenKeys(value: unknown): string[] {
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => [
    ...(["rng", "seed", "cards", "stack"].includes(key) ? [key] : []),
    ...forbiddenKeys(item),
  ]);
}

function expectSame(actual: unknown, expected: unknown): void {
  if (!isDeepStrictEqual(actual, expected)) expect(actual).toStrictEqual(expected);
}

describe("viewFor", () => {
  test("shows each public zone and counter, and only the viewer's hand", () => {
    const dealt = opening();
    const state: GameState = {
      ...dealt,
      ...buildState([
        { station: "stn-shackleton", modules: [["mod-inflatable-habitat", -1, 0, 0]] },
        { station: "stn-selene-labs", side: "named" },
      ]),
      cards: {
        c1: "stn-shackleton",
        c2: "mod-inflatable-habitat",
        c3: "stn-selene-labs",
        c4: "mod-bacon-printer",
        c5: "mod-satellite-1",
        c6: "mod-rover-1",
        c7: "mod-fusion-reactor",
        c8: "mod-laika-memorial",
        c9: "mod-lunar-capital",
      },
      hands: [["c4"], ["c5"]],
      supply: ["c6"],
      discard: ["c7"],
      play: ["c8"],
      deck: ["c9"],
      removedStations: [],
      credits: [7, 3],
      pending: null,
    };
    const own = viewFor(state, 0);
    expect(own.you).toBe(0);
    expect(own.hand).toEqual([{ instance: "c4", cardId: "mod-bacon-printer" }]);
    expect(own.players[0]).toEqual({
      seat: 0,
      credits: 7,
      colonists: 2,
      achievements: [],
      handSize: 1,
      base: {
        station: {
          instance: "c1",
          cardId: "stn-terran-outpost",
          side: "terran_outpost",
          named: "stn-shackleton",
          revealed: false,
        },
        modules: [{ instance: "c2", cardId: "mod-inflatable-habitat", x: -1, y: 0, q: 0 }],
        orbs: { red: 0, blue: 2, yellow: 0, wild: 0 },
      },
    });
    expect(own.players[1]).toMatchObject({
      seat: 1,
      credits: 3,
      colonists: 1,
      achievements: ["flask", "dna"],
      handSize: 1,
      base: { station: { named: "stn-selene-labs" } },
    });
    expect(own.supply).toEqual([{ instance: "c6", cardId: "mod-rover-1" }]);
    expect(own.discard).toEqual([{ instance: "c7", cardId: "mod-fusion-reactor" }]);
    expect(own.play).toEqual([{ instance: "c8", cardId: "mod-laika-memorial" }]);
    expect(own.deck).toBe(1);
    expect(own.turn).toEqual({
      number: state.turn.number,
      seat: state.turn.seat,
      step: state.turn.step,
    });
    expect(own.targets).toEqual({ credits: 20, colonists: 10, achievements: 5 });
    expect(own.config).toEqual(config);
    expect(own.influencesInGame).toEqual([]);
    expect(own.result).toBeNull();
    expect(own.pending).toBeNull();
    expect(instanceIds(own)).not.toContain("c5");
    expect(instanceIds(own)).not.toContain("c9");
    expect(viewFor(state, 1).hand).toEqual([{ instance: "c5", cardId: "mod-satellite-1" }]);
  });

  test("keeps a never-Flipped named side private and remembers it after flipping back", () => {
    const state = opening();
    const named = state.cards[state.bases[0].station.card];
    expect(viewFor(state, 0).players[0].base.station.named).toBe(named);
    for (const viewer of [1, null]) {
      expect(viewFor(state, viewer).players[0].base.station.named).toBeNull();
      for (const side of ["named", "terran_outpost"] as const) {
        const flipped = {
          ...state,
          bases: state.bases.map((base, seat) =>
            seat === 0 ? { ...base, station: { ...base.station, revealed: true, side } } : base,
          ),
        };
        expect(viewFor(flipped, viewer).players[0].base.station).toMatchObject({
          named,
          side,
          revealed: true,
          cardId: side === "named" ? named : "stn-terran-outpost",
        });
      }
    }
  });

  test("names the 8 Influences in the game for every seat and the public audience", () => {
    const options = { seats: 4, influences: true, kickstarter: false };
    const state = createGame(options, "view-influences");
    const names = [
      "Quarantine",
      "Lunar Alliance",
      "Entropic Cascade",
      "Terran Embargo",
      "Terran Crackdown",
      "Laika's Paradise",
      "Space Cowboy Capitalism",
      "Runaway Bureaucracy",
    ];
    for (const viewer of [0, 1, 2, 3, null]) {
      const view = viewFor(state, viewer);
      expect(view.influencesInGame).toEqual(names);
      expect(view.config).toEqual(options);
    }
    // The view owns its list.
    const view = viewFor(state, 0);
    (view.influencesInGame as string[]).pop();
    expect(viewFor(state, 0).influencesInGame).toEqual(names);
    expect(state.influencesInGame).toEqual(names);
  });

  test("gives the public audience no hand and no private pending fields", () => {
    const state = opening();
    const view = viewFor(state, null);
    expect(view.you).toBeNull();
    expect(view.hand).toEqual([]);
    expect(view.players.map(({ handSize }) => handSize)).toEqual([3, 3]);
    expect(view.players.every(({ base }) => base.station.named === null)).toBe(true);
    expect(view.pending).toEqual({ seat: 0, kind: "main_action" });
    for (const id of state.hands.flat()) expect(instanceIds(view)).not.toContain(id);
  });

  test("gives options and the decision id only to the deciding seat, including off-turn decisions", () => {
    const state = opening();
    if (state.pending === null) throw new Error("No opening decision");
    const pending = { ...state.pending, seat: 1 };
    const waiting = { ...state, pending };
    expect(viewFor(waiting, 1).pending).toEqual(pending);
    expect(viewFor(waiting, 0).pending).toEqual({ seat: 1, kind: pending.kind });
    expect(viewFor(waiting, null).pending).toEqual({ seat: 1, kind: pending.kind });
  });

  test("omits internal keys, even when private state has extra runtime fields", () => {
    const state = { ...opening(), seed: "secret" };
    for (const seat of [0, 1, null]) expect(forbiddenKeys(viewFor(state, seat))).toEqual([]);
  });

  test("owns a JSON snapshot without mutating or retaining references to the state", () => {
    const state = {
      ...opening(),
      result: { reason: "victory" as const, winners: [0], scores: [1, 0] },
    };
    const before = structuredClone(state);
    const view = viewFor(state, 0);
    expect(view.result).toEqual(state.result);
    expect(state).toStrictEqual(before);
    expect(JSON.parse(JSON.stringify(view))).toStrictEqual(view);
    // Change nested source objects after projection; the view must remain a snapshot.
    const snapshot = structuredClone(view);
    state.result.winners.push(1);
    Object.assign(state.config, { seats: 6 });
    Object.assign(state.turn, { number: 999 });
    Object.assign(state.pending?.options[0] ?? {}, { label: "Changed" });
    expect(view).toStrictEqual(snapshot);
  });
});

const randomGame = fc.tuple(fc.string(), fc.integer({ min: 2, max: 6 }), fc.string());

describe.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])("random views, influences=%s, kickstarter=%s", (influences, kickstarter) => {
  test("is unchanged by permutations of hidden places and hidden Station identities", () => {
    const seatsPlayed = new Set<number>();
    fc.assert(
      fc.property(randomGame, ([seed, seats, pickerSeed]) => {
        seatsPlayed.add(seats);
        const { states } = play(
          { ...config, seats, influences, kickstarter },
          seed,
          seededPicker(pickerSeed),
          20,
        );
        for (const state of states) {
          for (const viewer of [null, ...state.hands.map((_, seat) => seat)]) {
            const transparency = state.supply.some(
              (id) => state.cards[id] === "ks-inf-transparency",
            );
            const hidden = [
              ...state.deck.slice(transparency ? 1 : 0),
              ...(transparency ? state.discard : []),
              ...state.removedStations,
              ...state.hands.flatMap((hand, seat) => (seat === viewer ? [] : hand)),
            ];
            const permuted = shuffle(seedToState(pickerSeed), hidden).list;
            const replacement = new Map(hidden.map((id, index) => [id, permuted[index]]));
            const swap = (id: string) => replacement.get(id) ?? id;
            const changed = {
              ...state,
              deck: state.deck.map(swap),
              discard: state.discard.map(swap),
              removedStations: state.removedStations.map(swap),
              hands: state.hands.map((hand) => hand.map(swap)),
            };
            expect(changed.pending).toBe(state.pending);
            expectSame(viewFor(changed, viewer), viewFor(state, viewer));

            // Never-Flipped named sides stay Station identities, with the same public reverse.
            const hiddenStations = [
              ...state.removedStations,
              ...state.bases.flatMap((base, seat) =>
                seat !== viewer && !base.station.revealed ? [base.station.card] : [],
              ),
            ];
            const identities = shuffle(
              seedToState(seed),
              hiddenStations.map((id) => state.cards[id]),
            ).list;
            const cards = {
              ...state.cards,
              ...Object.fromEntries(hiddenStations.map((id, index) => [id, identities[index]])),
            };
            expectSame(viewFor({ ...state, cards }, viewer), viewFor(state, viewer));
          }
        }
      }),
      { numRuns: 100, seed: 191919 },
    );
    expect([...seatsPlayed].sort()).toEqual([2, 3, 4, 5, 6]);
  }, 60_000);

  test("serializes instance ids only from an independent visible-places list", () => {
    const seatsPlayed = new Set<number>();
    fc.assert(
      fc.property(randomGame, ([seed, seats, pickerSeed]) => {
        seatsPlayed.add(seats);
        const { states } = play(
          { ...config, seats, influences, kickstarter },
          seed,
          seededPicker(pickerSeed),
          20,
        );
        for (const state of states) {
          for (const viewer of [null, ...state.hands.map((_, seat) => seat)]) {
            const visible = visiblePlaces(state, viewer);
            const view = viewFor(state, viewer);
            expect(instanceIds(view).filter((id) => !visible.has(id))).toEqual([]);
            expect(forbiddenKeys(view)).toEqual([]);
            // Options may refer to cards by id; those cards must also have a visible identity.
            const paired = [
              ...view.hand,
              ...view.supply,
              ...view.discard,
              ...(view.deckTop == null ? [] : [view.deckTop]),
              ...view.play,
              ...view.players.flatMap(({ base }) => [base.station, ...base.modules]),
            ];
            const identified = new Set(paired.map(({ instance }) => instance));
            expect(instanceIds(view).filter((id) => !identified.has(id))).toEqual([]);
            for (const card of paired) expect(card.cardId).toBeTruthy();
          }
        }
      }),
      { numRuns: 100, seed: 191920 },
    );
    expect([...seatsPlayed].sort()).toEqual([2, 3, 4, 5, 6]);
  }, 60_000);
});
