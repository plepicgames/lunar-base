// A Base (rules 5): a Station and the Modules built around it, and what the
// Base counts. Orbs, colonists and achievements are derived here each time
// they are needed and are never stored in the state (R5.8).

import { cardById, type CardDef, type Colour, type HalfOrbSlot } from "./catalogue.ts";
import { jointsOf, type Placement } from "./geometry.ts";
import type { OrbCounts } from "./price.ts";

/** Which side of a Station card is up (R1.3). */
export type StationSide = "terran_outpost" | "named";

export interface BaseStation {
  /** Instance id of the Station card. It resolves to the named side. */
  readonly card: string;
  readonly side: StationSide;
  /** True once the Station was Flipped: the named side is public from then on (R2.4). */
  readonly revealed: boolean;
}

/** A built Module: its instance id and where it lies (R5.3). */
export interface BaseModule extends Placement {
  readonly card: string;
}

export interface Base {
  readonly station: BaseStation;
  readonly modules: readonly BaseModule[];
}

/** Resolves an instance id to its card. A Station resolves to its named side. */
export type CardOf = (instance: string) => CardDef;

export type OrbColour = keyof OrbCounts;

/** A card of a Base as it lies on the grid, with the side that is visible. */
export interface PlacedCard {
  readonly card: CardDef;
  readonly placement: Placement;
}

/** R5.4: the Station never moves. */
export const STATION_PLACEMENT: Placement = { x: 0, y: 0, q: 0 };

/** The side of the Station that is up: only this side counts (R5.7, R5.14, R5.15). */
export function visibleSide(station: BaseStation, cardOf: CardOf): CardDef {
  const named = cardOf(station.card);
  if (station.side === "named") return named;
  if (!named.other_side) throw new Error(`Card ${named.id} has no other side`);
  return cardById(named.other_side);
}

/** The Station's visible side, then the Modules in the order they were built. */
export function placedCards(base: Base, cardOf: CardOf): PlacedCard[] {
  return [
    { card: visibleSide(base.station, cardOf), placement: STATION_PLACEMENT },
    ...base.modules.map((module) => ({ card: cardOf(module.card), placement: module })),
  ];
}

// R1.4: gray is wild.
function orbOf(colour: Colour): OrbColour {
  return colour === "gray" ? "wild" : colour;
}

/** The half-orb a card prints in a slot, or null (R5.2). */
export function halfOrb(card: CardDef, slot: HalfOrbSlot): Colour | null {
  return card.half_orbs?.[slot] ?? null;
}

/**
 * The Orb a joint forms from the half-orbs on its two sides, or null (R5.5,
 * R5.6). Two different colours name no Orb: R5.11 forbids that joint, so a
 * Base never holds one.
 */
export function orbOfJoint(a: Colour | null, b: Colour | null): OrbColour | null {
  if (a === null || b === null) return null;
  if (a === "gray") return orbOf(b);
  return b === "gray" || a === b ? a : null;
}

/** R5.8: the printed Orbs of the visible sides (R5.7) plus one Orb for each joint that forms one. */
export function orbsOf(base: Base, cardOf: CardOf): OrbCounts {
  const counts = { red: 0, blue: 0, yellow: 0, wild: 0 };
  const placed = placedCards(base, cardOf);
  placed.forEach((first, index) => {
    for (const colour of first.card.orbs) counts[orbOf(colour)] += 1;
    for (const second of placed.slice(index + 1)) {
      for (const joint of jointsOf(first.placement, second.placement)) {
        const orb = orbOfJoint(halfOrb(first.card, joint.a), halfOrb(second.card, joint.b));
        if (orb !== null) counts[orb] += 1;
      }
    }
  });
  return counts;
}

/** R5.14: the colonists on the Station's visible side and on every Module. */
export function colonistsOf(base: Base, cardOf: CardOf): number {
  return placedCards(base, cardOf).reduce((sum, placed) => sum + placed.card.colonists, 0);
}

/** R5.15: the different achievement icons of the Base. Two of one kind count once. */
export function achievementsOf(base: Base, cardOf: CardOf): ReadonlySet<string> {
  return new Set(placedCards(base, cardOf).flatMap((placed) => placed.card.achievements));
}
