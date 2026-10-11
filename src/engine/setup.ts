import type { Base } from "./base.ts";
import { deckCards, influenceCards, stationSides } from "./catalogue.ts";
import { nextInt, seedToState, shuffle } from "./rng.ts";
import type { GameConfig, GameState } from "./state.ts";

function validateConfig(config: unknown): GameConfig {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new TypeError("Invalid config: expected an object");
  }
  const { seats, influences, kickstarter, startingSeat } = config as Record<string, unknown>;
  if (typeof seats !== "number" || !Number.isInteger(seats) || seats < 2 || seats > 6) {
    throw new RangeError("Invalid config: seats must be an integer from 2 to 6");
  }
  if (typeof influences !== "boolean" || typeof kickstarter !== "boolean") {
    throw new TypeError("Invalid config: influences and kickstarter must be booleans");
  }
  if (
    startingSeat !== undefined &&
    (typeof startingSeat !== "number" ||
      !Number.isInteger(startingSeat) ||
      startingSeat < 0 ||
      startingSeat >= seats)
  ) {
    throw new RangeError("Invalid config: startingSeat must identify an existing seat");
  }
  // Copy only known fields; never store an undefined optional value in state.
  return {
    seats,
    influences,
    kickstarter,
    ...(startingSeat === undefined ? {} : { startingSeat }),
  };
}

/** R3: deal the setup only. T018 starts resolution and runs to the first decision. */
export function dealGame(config: GameConfig, seed: string): GameState {
  const settings = validateConfig(config);
  const stations = shuffle(
    seedToState(seed),
    stationSides(settings).map((card) => card.id),
  );
  // R3.4: the Influences are in the Deck before any card is dealt, so the deal
  // below can put one into a hand or the Supply, where it stays (R3.8).
  const pool = influenceCards(settings);
  let selectionRng = stations.state;
  let influences = pool;
  if (settings.influences && settings.kickstarter) {
    const picked = shuffle(selectionRng, pool);
    selectionRng = picked.state;
    const ids = new Set(picked.list.slice(0, 8).map((card) => card.id));
    // Publish in catalogue order without exposing the selection's shuffle order.
    influences = pool.filter((card) => ids.has(card.id));
  }
  const shuffled = shuffle(selectionRng, [
    ...deckCards(settings),
    ...influences.map((card) => card.id),
  ]);
  let rng = shuffled.state;
  let startingSeat = settings.startingSeat;
  if (startingSeat === undefined) {
    const starting = nextInt(rng, settings.seats);
    startingSeat = starting.value;
    rng = starting.state;
  }

  const cards: Record<string, string> = {};
  let nextId = 1;
  const instance = (catalogueId: string): string => {
    const id = `c${String(nextId++)}`;
    cards[id] = catalogueId;
    return id;
  };
  // Allocate only after each pool is shuffled; catalogue identity cannot be read from an id.
  const stationIds = stations.list.map(instance);
  const deck = shuffled.list.map(instance);
  const bases: Base[] = stationIds.slice(0, settings.seats).map((card) => ({
    station: { card, side: "terran_outpost", revealed: false },
    modules: [],
  }));
  const hands = Array.from({ length: settings.seats }, () => [] as string[]);
  for (let offset = 0; offset < settings.seats; offset += 1) {
    hands[(startingSeat + offset) % settings.seats] = deck.splice(0, 3);
  }
  // No Discard pile exists yet. If the staged Deck is short, deal what remains (R8.7).
  const supply = deck.splice(0, 3 + settings.seats);
  return {
    config: settings,
    cards,
    deck,
    discard: [],
    supply,
    hands,
    play: [],
    removedStations: stationIds.slice(settings.seats),
    bases,
    credits: Array<number>(settings.seats).fill(3),
    turn: { number: 1, seat: startingSeat, step: "agent", work: 0 },
    stack: [],
    pending: null,
    counters: { frames: 0, decisions: 0 },
    rng,
    // Public names in catalogue order: they say nothing about the shuffle.
    influencesInGame: influences.map((card) => card.name),
    result: null,
  };
}
