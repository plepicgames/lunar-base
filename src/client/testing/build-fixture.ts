// A hand-built D6 decision in the engine's format (architecture, Build): skip
// first, then one option per Module, placement and turn, ordered by hand
// position, then y, x and q.

import type { GameView } from "../../protocol/messages.ts";
import { player, view } from "./view-fixture.ts";

const TURNS = ["upright", "turned right", "upside down", "turned left"];
const NAMES: Readonly<Record<string, string>> = {
  "c-1": "Depot",
  "c-2": "Fusion Reactor",
  "c-4": "Lunar Capital",
  "c-8": "Lab",
};

export function buildOption(
  card: string,
  x: number,
  y: number,
  q: number,
  price: number,
  orbs: readonly string[],
) {
  const at = `${String(x)},${String(y)}`;
  return {
    id: `${card}:${at},${String(q)}`,
    label: `Build ${NAMES[card]} at ${at} ${TURNS[q]}, pay ${String(price)}`,
    card,
    x,
    y,
    q,
    price,
    orbs: [...orbs],
  };
}

/** A Depot (c-1, price 1) with three places and a Fusion Reactor (c-2, price 2) with two. */
export const buildOptions = [
  { id: "skip", label: "Do not Build" },
  buildOption("c-1", 1, -1, 3, 1, ["blue"]),
  buildOption("c-1", -1, 0, 0, 1, ["blue"]),
  buildOption("c-1", -1, 0, 1, 1, ["blue", "wild"]),
  buildOption("c-1", 1, 0, 0, 1, ["yellow"]),
  buildOption("c-1", 1, 0, 2, 1, ["yellow", "red"]),
  buildOption("c-1", 1, 0, 3, 1, ["wild"]),
  buildOption("c-2", -1, 0, 2, 2, ["red"]),
  buildOption("c-2", 0, 2, 0, 2, ["yellow", "red"]),
];

/** Ann is asked D6 with a Depot, a Fusion Reactor and an Agent in her hand. */
export function buildView(overrides: Partial<GameView> = {}): GameView {
  return view({
    players: [player(0), player(1)],
    hand: [
      { instance: "c-1", cardId: "mod-depot" },
      { instance: "c-2", cardId: "mod-fusion-reactor" },
      { instance: "c-3", cardId: "agt-investor" },
    ],
    pending: { id: "d6", seat: 0, kind: "build", options: buildOptions },
    ...overrides,
  });
}

/**
 * A Lunar Capital (c-4, price 4) beside an Inflatable Habitat at -1,0: ten
 * placements over eight cells. The one at -1,-1 turned left lies across the
 * Habitat and the Station, and 0,-1 is the bottom cell of that one only.
 */
export const capitalOptions = [
  { id: "skip", label: "Do not Build" },
  buildOption("c-4", -1, -2, 0, 4, ["blue"]),
  buildOption("c-4", -2, -1, 3, 4, ["wild"]),
  buildOption("c-4", -1, -1, 1, 4, ["blue"]),
  buildOption("c-4", -1, -1, 2, 4, ["blue"]),
  buildOption("c-4", -1, -1, 3, 4, ["red", "blue"]),
  buildOption("c-4", 1, -1, 0, 4, ["wild"]),
  buildOption("c-4", 1, 0, 0, 4, ["yellow", "blue"]),
  buildOption("c-4", 1, 0, 2, 4, ["blue"]),
  buildOption("c-4", 1, 0, 3, 4, ["blue"]),
  buildOption("c-4", 2, 0, 1, 4, ["blue"]),
];

/** Ann is asked D6 with a Lunar Capital in her hand and an Inflatable Habitat left of her Station. */
export function capitalView(): GameView {
  const ann = player(0);
  const habitat = { instance: "m-habitat", cardId: "mod-inflatable-habitat", x: -1, y: 0, q: 0 };
  return view({
    players: [player(0, { base: { ...ann.base, modules: [{ ...habitat, q: 0 }] } }), player(1)],
    hand: [{ instance: "c-4", cardId: "mod-lunar-capital" }],
    pending: { id: "d6", seat: 0, kind: "build", options: capitalOptions },
  });
}
