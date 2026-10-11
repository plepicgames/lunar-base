// Test support: the Bases pictured in the printed rulebook (lunar-base-rulebook.pdf),
// read by eye from renders of its sheets. Pages 23 and 24 ("Building a
// Module") come from a 900 dpi render of sheet 14. Engine tests use them;
// engine code does not.

import type { OrbColour } from "../base.ts";
import type { Colour } from "../catalogue.ts";
import type { OrbCounts } from "../price.ts";
import type { BaseSpec, ModuleSpec } from "./build.ts";

// Both pictures show the Station with Terran Outpost up. The named side is
// not pictured; any one stands in.
const STATION = "stn-shackleton";

/**
 * p. 23, CORRECT. The Modules are listed in an order in which each one is
 * legal when it is built; the picture gives no order.
 */
export const PAGE_23_CORRECT: BaseSpec = {
  station: STATION,
  modules: [
    // Upright on the left: RU and RL blue meet the Station's LU and LL blue.
    ["mod-underground-headquarters", -1, 0, 0],
    // Lying across the top, its top to the east: RU red meets the Station's T
    // red, and its blank RL lies on the blank T of the Headquarters.
    ["mod-satellite-2", 0, -1, 1],
    // Upright on the right, half a card higher than the Station: LU yellow
    // meets the Satellite's T yellow, LL yellow meets the Station's RU gray.
    ["mod-oort-dome", 1, -1, 0],
  ],
};

/** The five joints circled in green on p. 23. */
export const PAGE_23_ORBS: readonly OrbColour[] = ["blue", "blue", "red", "yellow", "yellow"];

/**
 * p. 24, INCORRECT: the cards the picture does not fault. The Dome on the
 * right lies half under the Smart Spaceship, which hides its name; its LL
 * yellow meets the Station's RL yellow.
 */
export const PAGE_24_BASE: BaseSpec = {
  station: STATION,
  modules: [["mod-struve-dome", 1, 0, 0]],
};

/** p. 24, INCORRECT: the three cards the picture marks, from left to right. */
export const PAGE_24_INCORRECT: readonly ModuleSpec[] = [
  // Upright on the left: RU red against the Station's LU blue (red circle).
  ["mod-hayashi-dome", -1, 0, 0],
  // Lying across the top, its top to the west: LL yellow against the
  // Station's T red, and LU blue against the blank T of the Hayashi Dome
  // (two red circles).
  ["mod-beruang-engineers", -1, -1, 3],
  // Lying on the right, its top to the west, over the top cell of the Dome
  // (orange border, rule 3 of the page).
  ["mod-smart-spaceship", 1, 0, 3],
];

// The Bases below were read by eye from a 500 dpi render of sheets 11, 12 and
// 18 (task lb-2q8). Each lists its Modules in an order in which every one is
// legal when it is built; the pictures give no order.

/** A joint of a pictured Base: its two cards in Base order, their half-orbs and the Orb. */
export interface JointExample {
  /** The number the book prints at the joint. */
  readonly marker: number;
  readonly cards: readonly [string, string];
  readonly halves: readonly [Colour, Colour];
  readonly orb: OrbColour;
}

/** p. 18, "Orbs": The Oasis with its named side up and three Modules. */
export const PAGE_18_BASE: BaseSpec = {
  station: "stn-the-oasis",
  side: "named",
  modules: [
    // Upright on the left: RU and RL blue meet the Station's LU and LL blue.
    ["mod-inflatable-habitat", -1, 0, 0],
    // Upright on the right: LU gray meets the Station's RU gray, LL gray its RL yellow.
    ["mod-space-elevator", 1, 0, 0],
    // Lying across the top of the Station and the Habitat, its top to the
    // east: RU red meets the Station's T red, RL red the Habitat's T gray.
    ["mod-experimental-borehole", 0, -1, 1],
  ],
};

/** p. 18: the six joints under the markers 1, 2, 3, 4, 4 and 6. */
export const PAGE_18_JOINTS: readonly JointExample[] = [
  // "Red-gray halves form a red Orb."
  {
    marker: 1,
    cards: ["mod-inflatable-habitat", "mod-experimental-borehole"],
    halves: ["gray", "red"],
    orb: "red",
  },
  // "Red-red halves form a red Orb."
  {
    marker: 2,
    cards: ["stn-the-oasis", "mod-experimental-borehole"],
    halves: ["red", "red"],
    orb: "red",
  },
  // "Gray-gray halves form a gray wild Orb."
  {
    marker: 3,
    cards: ["stn-the-oasis", "mod-space-elevator"],
    halves: ["gray", "gray"],
    orb: "wild",
  },
  // "Blue-blue halves form blue Orbs."
  {
    marker: 4,
    cards: ["stn-the-oasis", "mod-inflatable-habitat"],
    halves: ["blue", "blue"],
    orb: "blue",
  },
  {
    marker: 4,
    cards: ["stn-the-oasis", "mod-inflatable-habitat"],
    halves: ["blue", "blue"],
    orb: "blue",
  },
  // "Yellow-gray halves form a yellow Orb."
  {
    marker: 6,
    cards: ["stn-the-oasis", "mod-space-elevator"],
    halves: ["yellow", "gray"],
    orb: "yellow",
  },
];

/** p. 18, marker 5: "The Oasis has blue and red Orbs." */
export const PAGE_18_PRINTED: readonly OrbColour[] = ["blue", "red"];

/** p. 18: the 8 Orbs of the Base, the six joints and the two printed. */
export const PAGE_18_ORBS: OrbCounts = { red: 3, blue: 3, yellow: 1, wild: 1 };

/**
 * p. 20, PLAYER'S BASE: Selene Labs with its named side up and an Inflatable
 * Habitat upright on its left. "You have 2 blue Orbs (from connections) and 2
 * red Orbs (from your Station card)."
 */
export const PAGE_20_BASE: BaseSpec = {
  station: "stn-selene-labs",
  side: "named",
  modules: [["mod-inflatable-habitat", -1, 0, 0]],
};

export const PAGE_20_ORBS: OrbCounts = { red: 2, blue: 2, yellow: 0, wild: 0 };

/** p. 20, PLAYER'S HAND, markers 1 to 3: each card and the Credits the book says it costs. */
export const PAGE_20_HAND: readonly (readonly [card: string, price: number])[] = [
  // "The Experimental Borehole has no Orbs showing as a cost, so it is free to play."
  ["mod-experimental-borehole", 0],
  // "The Mormon Scientist's cost is reduced to 0 and it's free to play."
  ["agt-mormon-scientist", 0],
  // "The Space Elevator costs 2 Credits to play."
  ["mod-space-elevator", 2],
];

/**
 * p. 32, ABOVE: "A colonist victory, 10 colonists in the base." The book
 * prints the Base upside down; here it is turned so that Shackleton, named
 * side up, is upright.
 */
export const PAGE_32_COLONISTS: BaseSpec = {
  station: "stn-shackleton",
  side: "named",
  modules: [
    // Upright on the left: RU and RL blue meet the Station's LU and LL blue.
    ["mod-inflatable-habitat", -1, 0, 0],
    // Lying on the right, its top to the west: T blue meets the Station's RU gray.
    ["mod-indigo-egregore", 1, 0, 3],
    // Upside down beyond the Egregore: RU blue meets the Egregore's B blue.
    ["mod-depot", 3, 0, 2],
    // Lying below those two, its top to the west: RU blue meets the
    // Egregore's LL blue and RL blue the Depot's T blue. No edge of it lies
    // on the Station.
    ["mod-underground-headquarters", 2, 1, 3],
  ],
};

/**
 * p. 32, BELOW: "Not a victory - the player has 5 scientific achievements,
 * but only 4 different ones!" Selene Labs with its named side up.
 */
export const PAGE_32_ACHIEVEMENTS: BaseSpec = {
  station: "stn-selene-labs",
  side: "named",
  modules: [
    // Upright on the left: RU and RL blue meet the Station's LU and LL blue.
    ["mod-fusion-reactor", -1, 0, 0],
    // Lying on the far left, its top to the east: T yellow meets the Reactor's LL yellow.
    ["mod-satellite-1", -2, 1, 1],
    // Lying on the right, its top to the west: T yellow meets the Station's RL yellow.
    ["mod-satellite-2", 1, 1, 3],
  ],
};

/** p. 32, BELOW: the five icons on the cards, and the four different ones. */
export const PAGE_32_ICONS: readonly string[] = ["flask", "dna", "atom", "satellite", "satellite"];
