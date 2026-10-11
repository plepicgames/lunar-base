// Test support: the sample turn of rulebook pages 27 to 30, read by eye from
// a 500 dpi render of sheets 16 and 17 of docs/inputs/lunar-base-rulebook.pdf.
// Engine tests use it; engine code does not.

import type { Base, BaseModule } from "../base.ts";
import type { OrbCounts } from "../price.ts";
import { dealGame } from "../setup.ts";
import type { GameState, Seat } from "../state.ts";

export const ALICE: Seat = 0;
export const BOB: Seat = 1;

// Instance ids of the cards the book names. A Rover and a Dome are drawn
// twice and once; the pictures show which artworks.
export const FUSION_REACTOR = "alice-fusion-reactor";
export const BOREHOLE = "alice-borehole";
export const SOLICITOR = "alice-solicitor";
export const DEPOT = "alice-depot";
export const HABITAT = "bob-habitat";
export const BOB_DEPOT = "bob-depot";
export const BOB_HEADQUARTERS = "bob-headquarters";
/** "IN CASE OF EMERGENCY USE HAMMER TO BREAK GLASS": the Rover Alice Discards. */
export const ROVER_DISCARDED = "deck-rover-2";
/** "NO TIME TO EXPLAIN GET IN THE ROVER!": the Rover Alice keeps. */
export const ROVER_KEPT = "deck-rover-4";
export const DOME = "deck-struve-dome";

// The book does not show these. The fixture needs them to be a whole state.
const ALICE_STATION = "alice-station";
const BOB_STATION = "bob-station";
/** One card under the three that Alice Draws: p. 30 still shows a Deck. */
export const DECK_REST = "deck-rest";
/** A Module and an Agent in the Supply, so that no Shuttle arrives (R4.7). */
export const SUPPLY: readonly string[] = ["supply-module", "supply-agent"];
/** Both players have the Credits of the setup (R3.7). The book gives no totals. */
export const CREDITS: readonly number[] = [3, 3];

const CARDS: Readonly<Record<string, string>> = {
  // Both Stations show Terran Outpost. The named sides are not pictured.
  [ALICE_STATION]: "stn-the-oasis",
  [BOB_STATION]: "stn-taikotech",
  [FUSION_REACTOR]: "mod-fusion-reactor",
  [BOREHOLE]: "mod-experimental-borehole",
  [SOLICITOR]: "agt-solicitor",
  [DEPOT]: "mod-depot",
  [HABITAT]: "mod-inflatable-habitat",
  [BOB_DEPOT]: "mod-depot",
  [BOB_HEADQUARTERS]: "mod-underground-headquarters",
  [ROVER_DISCARDED]: "mod-rover-2",
  [ROVER_KEPT]: "mod-rover-4",
  [DOME]: "mod-struve-dome",
  [DECK_REST]: "mod-lang-huan-concrete",
  "supply-module": "mod-bacon-printer",
  "supply-agent": "agt-investor",
};

/**
 * p. 28, ALICE'S BASE before the turn: a Fusion Reactor upright on the left
 * of the Terran Outpost. Its RU and RL blue meet the Station's LU and LL
 * blue: the "2 blue Orbs (A)".
 */
const ALICE_BASE: Base = {
  station: { card: ALICE_STATION, side: "terran_outpost", revealed: false },
  modules: [{ card: FUSION_REACTOR, x: -1, y: 0, q: 0 }],
};

// p. 28, BOB'S BASE. The book prints it with the Station lying on its side,
// its top to the east; here it is turned so that the Station is upright.
/** Upright on the left: RU and RL blue meet the Station's LU and LL blue. */
export const BOB_DEPOT_AT: BaseModule = { card: BOB_DEPOT, x: -1, y: 0, q: 0 };
/** Lying on the right, its top to the west: T gray meets the Station's RU gray. */
const BOB_HABITAT_AT: BaseModule = { card: HABITAT, x: 1, y: 0, q: 3 };
/**
 * Lying above the Habitat, its top to the east: RU and RL blue meet the
 * Habitat's RL and RU blue. No edge of it lies on the Station, so the Steal
 * cuts it off (R5.16); p. 30 shows it in its place.
 */
export const BOB_HEADQUARTERS_AT: BaseModule = { card: BOB_HEADQUARTERS, x: 2, y: -1, q: 1 };

const BOB_BASE: Base = {
  station: { card: BOB_STATION, side: "terran_outpost", revealed: false },
  modules: [BOB_DEPOT_AT, BOB_HABITAT_AT, BOB_HEADQUARTERS_AT],
};

/** p. 28, marker 4, "She places it as shown": upright below the Fusion Reactor, T blue on its B blue. */
export const DEPOT_AT: BaseModule = { card: DEPOT, x: -1, y: 2, q: 0 };
/**
 * p. 30, marker 6: lying on the left of the Fusion Reactor, its top to the
 * west. B red meets the Reactor's LU red.
 */
export const BOREHOLE_AT: BaseModule = { card: BOREHOLE, x: -3, y: 0, q: 3 };

/** The Orbs of a Base at one moment of the turn. */
function orbs(counts: Partial<OrbCounts>): OrbCounts {
  return { red: 0, blue: 0, yellow: 0, wild: 0, ...counts };
}

/** p. 27, step 1: "Alice has 2 blue Orbs (A) in her Base". */
export const ALICE_ORBS_AT_START = orbs({ blue: 2 });
/** After step 4: the Depot's T blue on the Fusion Reactor's B blue adds one. */
export const ALICE_ORBS_WITH_DEPOT = orbs({ blue: 3 });
/** After step 6: the Borehole's B red on the Fusion Reactor's LU red adds one. */
export const ALICE_ORBS_WITH_BOREHOLE = orbs({ blue: 3, red: 1 });
/** Bob's joints on p. 28: two with the Depot, one gray on gray, two between Habitat and Headquarters. */
export const BOB_ORBS_AT_START = orbs({ blue: 4, wild: 1 });
/** p. 30: only the Depot's two joints are left. */
export const BOB_ORBS_AFTER_STEAL = orbs({ blue: 2 });

/** p. 28, ALICE'S HAND, left to right, before the Habitat arrives. */
export const HAND_AT_START: readonly string[] = [BOREHOLE, SOLICITOR, DEPOT];

/**
 * The state before Alice's turn begins: the Bases, hand and Deck of the
 * pictures and the parts the book leaves out. Nothing is on the stack.
 */
export function sampleTurnStart(): GameState {
  const config = { seats: 2, influences: false, kickstarter: false, startingSeat: ALICE };
  return {
    ...dealGame(config, "rulebook-sample-turn"),
    cards: CARDS,
    bases: [ALICE_BASE, BOB_BASE],
    hands: [HAND_AT_START, []],
    // Step 7: "She Draws 2 Rovers from the deck." Step 8: "Draws a Dome".
    deck: [ROVER_DISCARDED, ROVER_KEPT, DOME, DECK_REST],
    supply: SUPPLY,
    discard: [],
    play: [],
    removedStations: [],
    credits: CREDITS,
  };
}
