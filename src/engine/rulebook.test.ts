// The pictured examples of the published rulebook, by printed page. The
// fixtures in ./testing hold what the pictures show; these tests ask the
// engine for the numbers the book prints beside them. The examples of p. 23
// and 24 are in placement.test.ts.

import { beforeAll, describe, expect, test } from "vitest";
import { buildOptions } from "./actions/build.ts";
import {
  achievementsOf,
  colonistsOf,
  halfOrb,
  orbOfJoint,
  orbsOf,
  placedCards,
  visibleSide,
  type CardOf,
} from "./base.ts";
import { cardById } from "./catalogue.ts";
import type { GameEvent } from "./events.ts";
import { gameRegistry } from "./game.ts";
import { jointsOf } from "./geometry.ts";
import { applyChoice, run, type Registry } from "./loop.ts";
import { isLegal } from "./placement.ts";
import { priceOf } from "./price.ts";
import { dealGame } from "./setup.ts";
import type { DecisionOption, GameState, JsonValue, Seat } from "./state.ts";
import { buildBase, buildState, type BaseSpec } from "./testing/build.ts";
import {
  PAGE_18_BASE,
  PAGE_18_JOINTS,
  PAGE_18_ORBS,
  PAGE_18_PRINTED,
  PAGE_20_BASE,
  PAGE_20_HAND,
  PAGE_20_ORBS,
  PAGE_32_ACHIEVEMENTS,
  PAGE_32_COLONISTS,
  PAGE_32_ICONS,
  type JointExample,
} from "./testing/rulebook-bases.ts";
import {
  ALICE,
  ALICE_ORBS_AT_START,
  ALICE_ORBS_WITH_BOREHOLE,
  ALICE_ORBS_WITH_DEPOT,
  BOB,
  BOB_DEPOT_AT,
  BOB_HEADQUARTERS_AT,
  BOB_ORBS_AFTER_STEAL,
  BOB_ORBS_AT_START,
  BOREHOLE,
  BOREHOLE_AT,
  CREDITS,
  DECK_REST,
  DEPOT,
  DEPOT_AT,
  DOME,
  FUSION_REACTOR,
  HABITAT,
  HAND_AT_START,
  ROVER_DISCARDED,
  ROVER_KEPT,
  sampleTurnStart,
  SOLICITOR,
  SUPPLY,
} from "./testing/rulebook-sample-turn.ts";
import { agentOptions, pushTurn } from "./turn.ts";
import { checkVictory } from "./victory.ts";

function cardOfGame(state: GameState): CardOf {
  return (instance) => cardById(state.cards[instance]);
}

function orbsIn(state: GameState, seat: Seat) {
  return orbsOf(state.bases[seat], cardOfGame(state));
}

/** Whether every Module of the Base was a legal placement when it was built, in the order written. */
function legalCardByCard(spec: BaseSpec): boolean {
  const modules = spec.modules ?? [];
  return modules.every(([id, x, y, q], index) => {
    const { base, cardOf } = buildBase({ ...spec, modules: modules.slice(0, index) });
    return isLegal(base, cardById(id), { x, y, q }, cardOf);
  });
}

/** Every joint of the Base that forms an Orb: its cards in Base order, their half-orbs, the Orb. */
function orbJoints(spec: BaseSpec): Omit<JointExample, "marker">[] {
  const { base, cardOf } = buildBase(spec);
  const placed = placedCards(base, cardOf);
  return placed.flatMap((first, index) =>
    placed.slice(index + 1).flatMap((second) =>
      jointsOf(first.placement, second.placement).flatMap((joint) => {
        const a = halfOrb(first.card, joint.a);
        const b = halfOrb(second.card, joint.b);
        const orb = orbOfJoint(a, b);
        if (a === null || b === null || orb === null) return [];
        return [{ cards: [first.card.id, second.card.id] as const, halves: [a, b] as const, orb }];
      }),
    ),
  );
}

function sorted(joints: readonly Omit<JointExample, "marker">[]): string[] {
  return joints.map(({ cards, halves, orb }) => JSON.stringify({ cards, halves, orb })).sort();
}

/**
 * A whole state around hand-built Bases, at the first decision of seat 0's
 * turn. Seat 0 holds `hand`, written as catalogue ids: instances h0, h1, ...
 * Every seat has the 3 Credits of the setup and every pile is empty.
 */
function gameOf(specs: readonly BaseSpec[], hand: readonly string[]): GameState {
  const built = buildState(specs);
  const cards: Record<string, string> = { ...built.cards };
  const held = hand.map((id, index) => {
    const key = `h${String(index)}`;
    cards[key] = id;
    return key;
  });
  const config = { seats: specs.length, influences: false, kickstarter: false, startingSeat: 0 };
  const state: GameState = {
    ...dealGame(config, "rulebook"),
    ...built,
    cards,
    hands: specs.map((_, seat) => (seat === 0 ? held : [])),
    deck: [],
    supply: [],
    discard: [],
    removedStations: [],
  };
  return run(pushTurn(state), gameRegistry).state;
}

/** One answer to the pending decision and all that followed it. */
interface Move {
  /** The option that was taken, as the engine offered it. */
  readonly option: DecisionOption;
  /** The state after each step (R8.5) up to the next decision. */
  readonly steps: readonly GameState[];
  readonly events: readonly GameEvent[];
  /** The state at the next decision. */
  readonly state: GameState;
}

/** The one option of the pending decision that has every field of `wanted`. */
function optionWith(state: GameState, wanted: Readonly<Record<string, JsonValue>>): DecisionOption {
  const pending = state.pending;
  if (pending === null) throw new Error("Expected a decision");
  const found = pending.options.filter((option) =>
    Object.entries(wanted).every(([key, value]) => option[key] === value),
  );
  if (found.length !== 1) {
    const labels = pending.options.map(({ label }) => label).join("; ");
    throw new Error(
      `Expected one option of ${pending.kind} with ${JSON.stringify(wanted)}, found ${String(found.length)} in: ${labels}`,
    );
  }
  return found[0];
}

/** Answers the pending decision through `applyChoice` and records every step. */
function take(state: GameState, wanted: Readonly<Record<string, JsonValue>>): Move {
  const option = optionWith(state, wanted);
  const steps: GameState[] = [];
  const watched: Registry = {
    handlers: gameRegistry.handlers,
    afterStep: (stepped, frame) => {
      const checked = gameRegistry.afterStep(stepped, frame);
      steps.push(checked.state);
      return checked;
    },
  };
  const pending = state.pending;
  if (pending === null) throw new Error("Expected a decision");
  const choice = { seat: pending.seat, decision: pending.id, option: option.id };
  const result = applyChoice(state, choice, watched);
  if (!result.ok) throw new Error(result.error.message);
  return { option, steps, events: result.events, state: result.state };
}

function eventsOf<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((event): event is Extract<GameEvent, { type: T }> => event.type === type);
}

/** The values a list takes, without the repeats of a value that did not change. */
function changes<T>(values: readonly T[]): T[] {
  return values.filter(
    (value, index) => index === 0 || JSON.stringify(value) !== JSON.stringify(values[index - 1]),
  );
}

describe("rulebook p. 12: Double Agent", () => {
  // Three Stations as dealt: no Base has an Orb. Seat 0 holds the Double Agent.
  const start = (): GameState =>
    gameOf(
      [{ station: "stn-shackleton" }, { station: "stn-imbrium" }, { station: "stn-dark-side" }],
      ["agt-double-agent"],
    );

  test("p. 12: the card shows a blue and a yellow Orb as its cost", () => {
    expect(cardById("agt-double-agent").cost).toEqual(["blue", "yellow"]);
  });

  test('p. 12: "Double Agent can be played for the cost of 2 Credits"', () => {
    const state = start();
    expect(orbsIn(state, 0)).toEqual({ red: 0, blue: 0, yellow: 0, wild: 0 });
    expect(agentOptions(state, 0)).toMatchObject([{ card: "h0", price: 2 }]);
    const played = take(state, { card: "h0" });
    expect(eventsOf(played.events, "agent_played")).toMatchObject([{ seat: 0, cost: 2 }]);
    expect(played.state.credits).toEqual([1, 3, 3]);
  });

  test('p. 12: "players sitting next to the chosen target Flip their Stations"', () => {
    const played = take(start(), { card: "h0" });
    expect(played.state.pending).toMatchObject({ seat: 0, kind: "target" });
    const flipped = take(played.state, { target: 1 });
    expect(flipped.state.bases.map((base) => base.station.side)).toEqual([
      "named",
      "terran_outpost",
      "named",
    ]);
  });

  test('p. 12, step 3: "Place it face-up on the discard pile"', () => {
    const played = take(start(), { card: "h0" });
    expect(played.state.play).toEqual(["h0"]);
    expect(played.state.discard).toEqual([]);
    const flipped = take(played.state, { target: 1 });
    expect(flipped.state.play).toEqual([]);
    expect(flipped.state.discard).toEqual(["h0"]);
  });
});

describe("rulebook p. 18: the Base of The Oasis and its 8 Orbs", () => {
  test("p. 18: the Base is legal card by card", () => {
    expect(legalCardByCard(PAGE_18_BASE)).toBe(true);
  });

  test.each(PAGE_18_JOINTS)(
    "p. 18 marker $marker: $halves.0 and $halves.1 form a $orb Orb",
    ({ cards, halves, orb }) => {
      expect(orbOfJoint(halves[0], halves[1])).toBe(orb);
      expect(sorted(orbJoints(PAGE_18_BASE))).toContain(sorted([{ cards, halves, orb }])[0]);
    },
  );

  test("p. 18: the six marked joints are all the joints that form an Orb", () => {
    expect(sorted(orbJoints(PAGE_18_BASE))).toEqual(sorted(PAGE_18_JOINTS));
  });

  test('p. 18 marker 5: "The Oasis has blue and red Orbs"', () => {
    const { base, cardOf } = buildBase(PAGE_18_BASE);
    expect(visibleSide(base.station, cardOf).orbs).toEqual(PAGE_18_PRINTED);
  });

  test("p. 18: the Base has 8 Orbs: 3 red, 3 blue, 1 yellow and 1 wild", () => {
    const { base, cardOf } = buildBase(PAGE_18_BASE);
    const orbs = orbsOf(base, cardOf);
    expect(orbs).toEqual(PAGE_18_ORBS);
    expect(orbs.red + orbs.blue + orbs.yellow + orbs.wild).toBe(8);
  });
});

describe("rulebook p. 20: paying costs with 2 blue and 2 red Orbs", () => {
  // The player of the example and an opponent with a Station as dealt.
  const start = (): GameState =>
    gameOf(
      [PAGE_20_BASE, { station: "stn-imbrium" }],
      PAGE_20_HAND.map(([card]) => card),
    );
  const [BOREHOLE_CARD, SCIENTIST, ELEVATOR] = ["h0", "h1", "h2"];

  test("p. 20: the Base is legal and has 2 blue Orbs from connections and 2 red from the Station", () => {
    expect(legalCardByCard(PAGE_20_BASE)).toBe(true);
    const { base, cardOf } = buildBase(PAGE_20_BASE);
    expect(orbsOf(base, cardOf)).toEqual(PAGE_20_ORBS);
    expect(visibleSide(base.station, cardOf).orbs).toEqual(["red", "red"]);
    expect(orbJoints(PAGE_20_BASE).map(({ orb }) => orb)).toEqual(["blue", "blue"]);
  });

  test.each(PAGE_20_HAND)("p. 20: %s costs %i Credits", (card, price) => {
    expect(priceOf(cardById(card).cost, PAGE_20_ORBS)).toBe(price);
  });

  test("p. 20 marker 1: the engine offers the Experimental Borehole for 0 Credits", () => {
    expect(cardById("mod-experimental-borehole").cost).toEqual([]);
    const offered = buildOptions(start(), 0).filter(({ card }) => card === BOREHOLE_CARD);
    expect(offered.length).toBeGreaterThan(0);
    expect(new Set(offered.map(({ price }) => price))).toEqual(new Set([0]));
  });

  test("p. 20 marker 2: the engine offers the Mormon Scientist for 0 Credits", () => {
    expect(agentOptions(start(), 0)).toMatchObject([{ card: SCIENTIST, price: 0 }]);
  });

  test("p. 20 marker 3: the engine offers the Space Elevator for 2 Credits and takes them", () => {
    const state = start();
    const offered = buildOptions(state, 0).filter(({ card }) => card === ELEVATOR);
    expect(offered.length).toBeGreaterThan(0);
    expect(new Set(offered.map(({ price }) => price))).toEqual(new Set([2]));

    // Go on to the Main Action, take the Build box of Selene Labs and Build it.
    const box = take(take(state, { id: "go_on" }).state, { card: "c1", box: 1 });
    const [first] = offered;
    const built = take(box.state, { card: ELEVATOR, x: first.x, y: first.y, q: first.q });
    expect(eventsOf(built.events, "credits_changed")[0]).toEqual({
      type: "credits_changed",
      seat: 0,
      delta: -2,
      credits: 1,
    });
    expect(eventsOf(built.events, "module_built")).toMatchObject([{ seat: 0, cost: 2 }]);
  });
});

describe("rulebook p. 32: the end of the game", () => {
  // The pictured Base of seat 0 and an opponent with a Station as dealt.
  const against = (spec: BaseSpec): GameState => gameOf([spec, { station: "stn-imbrium" }], []);

  test("p. 32 above: the Base is legal card by card", () => {
    expect(legalCardByCard(PAGE_32_COLONISTS)).toBe(true);
  });

  test('p. 32 above: "A colonist victory, 10 colonists in the base"', () => {
    const { base, cardOf } = buildBase(PAGE_32_COLONISTS);
    expect(colonistsOf(base, cardOf)).toBe(10);
    // Shackleton 2, Habitat 2, Egregore 3, Depot 1, Headquarters 2.
    expect(placedCards(base, cardOf).map(({ card }) => card.colonists)).toEqual([2, 2, 3, 1, 2]);
    expect(checkVictory(against(PAGE_32_COLONISTS)).state.result).toEqual({
      reason: "victory",
      winners: [0],
      scores: [1, 0],
    });
  });

  test("p. 32 below: the Base is legal card by card", () => {
    expect(legalCardByCard(PAGE_32_ACHIEVEMENTS)).toBe(true);
  });

  test('p. 32 below: "5 scientific achievements, but only 4 different ones" is not a victory', () => {
    const { base, cardOf } = buildBase(PAGE_32_ACHIEVEMENTS);
    const icons = placedCards(base, cardOf).flatMap(({ card }) => card.achievements);
    expect(icons).toEqual(PAGE_32_ICONS);
    expect(icons).toHaveLength(5);
    expect(achievementsOf(base, cardOf)).toEqual(new Set(PAGE_32_ICONS));
    expect(achievementsOf(base, cardOf).size).toBe(4);
    expect(checkVictory(against(PAGE_32_ACHIEVEMENTS)).state.result).toBeNull();
  });
});

describe("rulebook pp. 27 to 30: the sample turn", () => {
  // The state at Alice's first decision, then one Move for each answer she gives.
  let start: GameState;
  let solicitor: Move;
  let steal: Move;
  let box: Move;
  let depot: Move;
  let resolve: Move;
  let borehole: Move;
  let discard: Move;

  beforeAll(() => {
    start = run(pushTurn(sampleTurnStart()), gameRegistry).state;
    solicitor = take(start, { card: SOLICITOR });
    steal = take(solicitor.state, { label: "Steal Module: Inflatable Habitat" });
    box = take(steal.state, { card: FUSION_REACTOR, box: 0 });
    depot = take(box.state, { ...DEPOT_AT });
    resolve = take(depot.state, { id: "now" });
    borehole = take(resolve.state, { ...BOREHOLE_AT });
    discard = take(borehole.state, { card: ROVER_DISCARDED });
  });

  test("p. 28: before the turn both Bases are legal, Alice has 2 blue Orbs and holds three cards", () => {
    const state = sampleTurnStart();
    const cardOf = cardOfGame(state);
    for (const base of state.bases) {
      base.modules.forEach((module, index) => {
        const before = { ...base, modules: base.modules.slice(0, index) };
        expect(isLegal(before, cardOf(module.card), module, cardOf)).toBe(true);
      });
    }
    expect(orbsIn(state, ALICE)).toEqual(ALICE_ORBS_AT_START);
    expect(orbsIn(state, BOB)).toEqual(BOB_ORBS_AT_START);
    expect(state.hands[ALICE]).toEqual(HAND_AT_START);
    expect(start.pending).toMatchObject({ seat: ALICE, kind: "agent" });
    expect(start.turn).toMatchObject({ number: 1, seat: ALICE, step: "agent" });
  });

  test("p. 27 step 1: the Solicitor costs 2 blue and 2 yellow Orbs; with 2 blue Orbs Alice pays 2 Credits", () => {
    expect([...cardById("agt-solicitor").cost].sort()).toEqual([
      "blue",
      "blue",
      "yellow",
      "yellow",
    ]);
    expect(solicitor.option).toMatchObject({ card: SOLICITOR, price: 2 });
    expect(eventsOf(solicitor.events, "agent_played")).toMatchObject([{ seat: ALICE, cost: 2 }]);
    expect(solicitor.state.credits).toEqual([CREDITS[ALICE] - 2, CREDITS[BOB]]);
    expect(solicitor.state.hands[ALICE]).toEqual([BOREHOLE, DEPOT]);
    expect(solicitor.state.play).toEqual([SOLICITOR]);
    expect(orbsIn(solicitor.state, ALICE)).toEqual(ALICE_ORBS_AT_START);
  });

  test("p. 27 step 2: Alice Steals the Inflatable Habitat from Bob's Base into her hand", () => {
    expect(eventsOf(steal.events, "module_stolen")).toEqual([
      {
        type: "module_stolen",
        thief: ALICE,
        victim: BOB,
        card: { instance: HABITAT, cardId: "mod-inflatable-habitat" },
      },
    ]);
    // p. 28, ALICE'S HAND, left to right.
    expect(steal.state.hands[ALICE]).toEqual([BOREHOLE, DEPOT, HABITAT]);
    // p. 30, BOB'S BASE: the Depot and the Headquarters lie where they lay.
    expect(steal.state.bases[BOB].modules).toEqual([BOB_DEPOT_AT, BOB_HEADQUARTERS_AT]);
    expect(orbsIn(steal.state, BOB)).toEqual(BOB_ORBS_AFTER_STEAL);
    expect(orbsIn(steal.state, ALICE)).toEqual(ALICE_ORBS_AT_START);
    // p. 28: the played Solicitor lies on the Discard pile.
    expect(steal.state.play).toEqual([]);
    expect(steal.state.discard).toEqual([SOLICITOR]);
    expect(steal.state.credits).toEqual([CREDITS[ALICE] - 2, CREDITS[BOB]]);
  });

  test("p. 27 step 3: Alice chooses the Fusion Reactor's Main Action: Build, Draw, Discard", () => {
    expect(steal.state.pending).toMatchObject({ seat: ALICE, kind: "main_action" });
    expect(box.option.label).toBe("Fusion Reactor: Build, Draw, Discard");
    expect(eventsOf(box.events, "box_chosen")).toMatchObject([
      { seat: ALICE, card: { instance: FUSION_REACTOR }, box: 0 },
    ]);
    expect(box.state.pending).toMatchObject({ seat: ALICE, kind: "build" });
    expect(box.state.hands[ALICE]).toEqual([BOREHOLE, DEPOT, HABITAT]);
  });

  test("p. 27 step 4: Alice Builds the Depot for free, where the book shows it", () => {
    expect(cardById("mod-depot").cost).toEqual(["blue", "blue"]);
    expect(depot.option).toMatchObject({ ...DEPOT_AT, price: 0, orbs: ["blue"] });
    expect(eventsOf(depot.events, "module_built")).toMatchObject([
      { seat: ALICE, card: { instance: DEPOT }, x: -1, y: 2, q: 0, cost: 0 },
    ]);
    expect(depot.state.bases[ALICE].modules).toEqual([
      { card: FUSION_REACTOR, x: -1, y: 0, q: 0 },
      DEPOT_AT,
    ]);
    expect(orbsIn(depot.state, ALICE)).toEqual(ALICE_ORBS_WITH_DEPOT);
    expect(depot.state.hands[ALICE]).toEqual([BOREHOLE, HABITAT]);
    expect(depot.state.credits).toEqual([CREDITS[ALICE] - 2, CREDITS[BOB]]);
  });

  test("p. 29 step 5: Alice resolves the Depot's text now and may Build again or not", () => {
    // p. 13: she may resolve it before or after the rest of the Fusion Reactor's box.
    expect(depot.state.pending).toMatchObject({ seat: ALICE, kind: "defer" });
    expect(depot.state.pending?.options.map(({ id }) => id)).toEqual(["now", "later"]);
    expect(resolve.option.label).toBe("Resolve the text of Depot now");
    expect(resolve.state.pending).toMatchObject({ seat: ALICE, kind: "build" });
    // "Build actions are always optional."
    expect(resolve.state.pending?.options[0]).toMatchObject({ id: "skip" });
    expect(resolve.state.hands[ALICE]).toEqual([BOREHOLE, HABITAT]);
    expect(orbsIn(resolve.state, ALICE)).toEqual(ALICE_ORBS_WITH_DEPOT);
  });

  test("p. 29 step 6: Alice Builds the Experimental Borehole for free, where the book shows it", () => {
    expect(borehole.option).toMatchObject({ ...BOREHOLE_AT, price: 0, orbs: ["red"] });
    expect(eventsOf(borehole.events, "module_built")).toMatchObject([
      { seat: ALICE, card: { instance: BOREHOLE }, x: -3, y: 0, q: 3, cost: 0 },
    ]);
    // The first step after the Build: nothing is Drawn yet.
    const built = borehole.steps.find((step) => step.bases[ALICE].modules.length === 3);
    expect(built?.bases[ALICE].modules).toEqual([
      { card: FUSION_REACTOR, x: -1, y: 0, q: 0 },
      DEPOT_AT,
      BOREHOLE_AT,
    ]);
    expect(built?.hands[ALICE]).toEqual([HABITAT]);
    expect(built && orbsIn(built, ALICE)).toEqual(ALICE_ORBS_WITH_BOREHOLE);
    expect(built?.credits).toEqual([CREDITS[ALICE] - 2, CREDITS[BOB]]);
  });

  test("p. 29 step 7: the Borehole's text resolves at once and Alice Draws 2 Rovers", () => {
    // The Depot's text has no action left, so the engine asks nothing (R8.3).
    const drawn = eventsOf(borehole.events, "card_drawn");
    expect(drawn.slice(0, 2)).toMatchObject([
      { seat: ALICE, card: { instance: ROVER_DISCARDED, cardId: "mod-rover-2" } },
      { seat: ALICE, card: { instance: ROVER_KEPT, cardId: "mod-rover-4" } },
    ]);
    // One card at a time (R8.5), from the Build to the next decision.
    expect(changes(borehole.steps.map((step) => step.hands[ALICE]))).toEqual([
      [BOREHOLE, HABITAT],
      [HABITAT],
      [HABITAT, ROVER_DISCARDED],
      [HABITAT, ROVER_DISCARDED, ROVER_KEPT],
      [HABITAT, ROVER_DISCARDED, ROVER_KEPT, DOME],
    ]);
  });

  test("p. 29 step 8: the Fusion Reactor's box goes on: Alice Draws a Dome and Discards a Rover", () => {
    expect(eventsOf(borehole.events, "card_drawn")[2]).toMatchObject({
      seat: ALICE,
      card: { instance: DOME, cardId: "mod-struve-dome" },
    });
    expect(borehole.state.pending).toMatchObject({ seat: ALICE, kind: "discard" });
    expect(borehole.state.hands[ALICE]).toEqual([HABITAT, ROVER_DISCARDED, ROVER_KEPT, DOME]);
    expect(eventsOf(discard.events, "card_discarded")).toMatchObject([
      { seat: ALICE, card: { instance: ROVER_DISCARDED } },
    ]);
  });

  test("p. 30: the end of the turn matches the picture", () => {
    const end = discard.state;
    // ALICE'S HAND, left to right: Inflatable Habitat, Rover, Struve Dome.
    expect(end.hands[ALICE]).toEqual([HABITAT, ROVER_KEPT, DOME]);
    // DISCARD: the Rover lies on the Solicitor.
    expect(end.discard).toEqual([SOLICITOR, ROVER_DISCARDED]);
    expect(end.bases[ALICE].modules).toEqual([
      { card: FUSION_REACTOR, x: -1, y: 0, q: 0 },
      DEPOT_AT,
      BOREHOLE_AT,
    ]);
    expect(end.bases[ALICE].station.side).toBe("terran_outpost");
    expect(end.bases[BOB].modules).toEqual([BOB_DEPOT_AT, BOB_HEADQUARTERS_AT]);
    expect(orbsIn(end, ALICE)).toEqual(ALICE_ORBS_WITH_BOREHOLE);
    expect(orbsIn(end, BOB)).toEqual(BOB_ORBS_AFTER_STEAL);
    // The only Credits of the turn are the 2 for the Solicitor.
    expect(end.credits).toEqual([CREDITS[ALICE] - 2, CREDITS[BOB]]);
    expect(end.deck).toEqual([DECK_REST]);
  });

  test('p. 29: "Alice Built 2 Modules, Stole 1 Module from Bob, Drew 3 cards and Discarded 1 card"', () => {
    const events = [solicitor, steal, box, depot, resolve, borehole, discard].flatMap(
      (move) => move.events,
    );
    expect(eventsOf(events, "module_built")).toHaveLength(2);
    expect(eventsOf(events, "module_stolen")).toHaveLength(1);
    expect(eventsOf(events, "card_drawn")).toHaveLength(3);
    expect(eventsOf(events, "card_discarded")).toHaveLength(1);
    // The book does not count the played Agent as a Discard; nor does the engine.
    expect(eventsOf(events, "agent_discarded")).toHaveLength(1);
  });

  test("after the sample turn no Shuttle arrives and the turn passes to Bob", () => {
    // Not in the book: the fixture's Supply holds a Module and an Agent (R4.7).
    expect(eventsOf(discard.events, "shuttles_arrived")).toEqual([]);
    expect(discard.state.supply).toEqual(SUPPLY);
    expect(discard.state.turn).toMatchObject({ number: 2, seat: BOB });
    expect(discard.state.pending).toMatchObject({ seat: BOB, kind: "main_action" });
    expect(discard.state.result).toBeNull();
  });
});
