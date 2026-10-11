// Where a Module may be built in a Base (rules 5.3). This is the one place
// that applies the placement rules R5.10 to R5.13.

import {
  halfOrb,
  orbOfJoint,
  placedCards,
  type Base,
  type CardOf,
  type OrbColour,
} from "./base.ts";
import type { CardDef, Colour } from "./catalogue.ts";
import {
  cellsOf,
  neighbourOf,
  slotEdges,
  SLOTS,
  type Cell,
  type Placement,
  type Quarter,
} from "./geometry.ts";

/** A legal placement and the Orbs it forms, in the slot order of the new card (R5.2). */
export interface LegalPlacement extends Placement {
  readonly orbs: readonly OrbColour[];
}

const QUARTERS: readonly Quarter[] = [0, 1, 2, 3];

/** The cards of a Base as the placement rules see them. */
interface Outline {
  /** Keys of the cells the cards cover. */
  readonly covered: ReadonlySet<string>;
  /** What a card shows on an outer edge, by `sideKey` of the cell beyond the edge and the card's cell. */
  readonly sides: ReadonlyMap<string, Colour | null>;
  /** The empty cells next to a card. A cell next to two cards is listed twice. */
  readonly open: readonly Cell[];
}

function cellKey(cell: Cell): string {
  return `${String(cell.x)},${String(cell.y)}`;
}

function sideKey(outside: Cell, inside: Cell): string {
  return `${cellKey(outside)}|${cellKey(inside)}`;
}

function outlineOf(base: Base, cardOf: CardOf): Outline {
  const covered = new Set<string>();
  const sides = new Map<string, Colour | null>();
  const beyond: Cell[] = [];
  for (const { card, placement } of placedCards(base, cardOf)) {
    const cells = cellsOf(placement);
    covered.add(cellKey(cells.top)).add(cellKey(cells.bottom));
    const edges = slotEdges(placement);
    for (const slot of SLOTS) {
      const { cell, edge } = edges[slot];
      const outside = neighbourOf(cell, edge);
      sides.set(sideKey(outside, cell), halfOrb(card, slot));
      beyond.push(outside);
    }
  }
  return { covered, sides, open: beyond.filter((cell) => !covered.has(cellKey(cell))) };
}

// The Orbs the card forms at `placement`, in its slot order, or null when the
// placement is not legal.
function orbsFormed(outline: Outline, card: CardDef, placement: Placement): OrbColour[] | null {
  const cells = cellsOf(placement);
  // R5.10: both cells are empty.
  if (outline.covered.has(cellKey(cells.top)) || outline.covered.has(cellKey(cells.bottom))) {
    return null;
  }
  const edges = slotEdges(placement);
  const orbs: OrbColour[] = [];
  for (const slot of SLOTS) {
    const { cell, edge } = edges[slot];
    const theirs = outline.sides.get(sideKey(cell, neighbourOf(cell, edge)));
    // R5.13: an empty cell beyond the edge is never a problem.
    if (theirs === undefined) continue;
    const mine = halfOrb(card, slot);
    // R5.11: nothing against nothing is allowed and forms nothing.
    if (mine === null && theirs === null) continue;
    // R5.11: a half-orb against a blank edge, or two different colours.
    const orb = orbOfJoint(mine, theirs);
    if (orb === null) return null;
    orbs.push(orb);
  }
  // R5.12: at least one joint forms an Orb.
  return orbs.length > 0 ? orbs : null;
}

/**
 * Whether `card` may be built into `base` at `placement` (R5.10 to R5.13).
 * The joint that forms an Orb may be with the Station or with any Module,
 * including one a Steal cut off (R5.12, Q32).
 */
export function isLegal(base: Base, card: CardDef, placement: Placement, cardOf: CardOf): boolean {
  return orbsFormed(outlineOf(base, cardOf), card, placement) !== null;
}

/**
 * Every legal placement of `card` in `base` with the Orbs it forms, ordered
 * by y, then x, then q. The order depends only on the Base and the card, so
 * the option ids built from it are stable.
 */
export function legalPlacements(base: Base, card: CardDef, cardOf: CardOf): LegalPlacement[] {
  const outline = outlineOf(base, cardOf);
  // R5.12 needs a joint, so one cell of the new card lies next to a card of
  // the Base: try each such cell as the top cell and as the bottom cell.
  const candidates = new Map<string, Placement>();
  for (const cell of outline.open) {
    for (const q of QUARTERS) {
      const asTop = { x: cell.x, y: cell.y, q };
      const { bottom } = cellsOf(asTop);
      const asBottom = { x: 2 * cell.x - bottom.x, y: 2 * cell.y - bottom.y, q };
      for (const placement of [asTop, asBottom]) {
        candidates.set(`${cellKey(placement)},${String(q)}`, placement);
      }
    }
  }
  const ordered = [...candidates.values()].sort((a, b) => a.y - b.y || a.x - b.x || a.q - b.q);
  return ordered.flatMap((placement) => {
    const orbs = orbsFormed(outline, card, placement);
    return orbs === null ? [] : [{ ...placement, orbs }];
  });
}
