// The square grid of a Base (rules 5.1): which cells a placed card covers,
// where its six slots point, and which cell edges two cards share. Every
// function is pure and knows nothing about what a card prints in a slot.

import type { HalfOrbSlot } from "./catalogue.ts";

/** A number of clockwise quarter turns (R5.3). */
export type Quarter = 0 | 1 | 2 | 3;

/** A grid cell. y grows downward (R5.3). */
export interface Cell {
  readonly x: number;
  readonly y: number;
}

/** Where a card lies: its top cell is at (x, y) and it is turned q times (R5.3). */
export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly q: Quarter;
}

/** A side of a cell. N is toward smaller y, E toward larger x. */
export type Edge = "N" | "E" | "S" | "W";

export interface CardCells {
  readonly top: Cell;
  readonly bottom: Cell;
}

/** The cell edge a slot sits on. */
export interface SlotEdge {
  readonly cell: Cell;
  readonly edge: Edge;
}

/**
 * A cell edge shared by two cards (R5.5): `edge` of `cell`, a cell of the
 * first card, where the first card has slot `a` and the second has slot `b`.
 */
export interface Joint {
  readonly cell: Cell;
  readonly edge: Edge;
  readonly a: HalfOrbSlot;
  readonly b: HalfOrbSlot;
}

/** The six slots, clockwise from the top (R5.2). */
export const SLOTS: readonly HalfOrbSlot[] = ["T", "RU", "RL", "B", "LL", "LU"];

// Clockwise, so one quarter turn moves an edge to the next entry.
const EDGES: readonly Edge[] = ["N", "E", "S", "W"];

const OPPOSITE: Readonly<Record<Edge, Edge>> = { N: "S", E: "W", S: "N", W: "E" };

const STEP: Readonly<Record<Edge, Cell>> = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
};

// The slot table of rules 5.1: the cell and the edge of each slot at q = 0.
const SLOT_AT_REST: Readonly<Record<HalfOrbSlot, { part: keyof CardCells; edge: Edge }>> = {
  T: { part: "top", edge: "N" },
  RU: { part: "top", edge: "E" },
  RL: { part: "bottom", edge: "E" },
  B: { part: "bottom", edge: "S" },
  LL: { part: "bottom", edge: "W" },
  LU: { part: "top", edge: "W" },
};

function turn(edge: Edge, q: Quarter): Edge {
  return EDGES[(EDGES.indexOf(edge) + q) % 4];
}

function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

/** The cell on the other side of `edge` of `cell`. */
export function neighbourOf(cell: Cell, edge: Edge): Cell {
  const step = STEP[edge];
  return { x: cell.x + step.x, y: cell.y + step.y };
}

/**
 * The two cells a placed card covers (R5.1, R5.3). At q = 0 the bottom cell
 * is south of the top cell; each quarter turn moves it one edge clockwise.
 */
export function cellsOf(placement: Placement): CardCells {
  const top = { x: placement.x, y: placement.y };
  return { top, bottom: neighbourOf(top, turn("S", placement.q)) };
}

/** The cell and the compass edge of each slot of a placed card (R5.2). */
export function slotEdges(placement: Placement): Readonly<Record<HalfOrbSlot, SlotEdge>> {
  const cells = cellsOf(placement);
  const at = (slot: HalfOrbSlot): SlotEdge => {
    const rest = SLOT_AT_REST[slot];
    return { cell: cells[rest.part], edge: turn(rest.edge, placement.q) };
  };
  return { T: at("T"), RU: at("RU"), RL: at("RL"), B: at("B"), LL: at("LL"), LU: at("LU") };
}

/**
 * Every cell edge the two cards share (R5.5), in the slot order of `a`. Two
 * cards that do not overlap share at most two. The list is about edges only:
 * it says nothing about what either card prints there, and it is not a
 * statement about cards that overlap, which a Base never holds (R5.10).
 */
export function jointsOf(a: Placement, b: Placement): Joint[] {
  const ofA = slotEdges(a);
  const ofB = slotEdges(b);
  const joints: Joint[] = [];
  for (const slotA of SLOTS) {
    const { cell, edge } = ofA[slotA];
    const facingCell = neighbourOf(cell, edge);
    const slotB = SLOTS.find(
      (slot) => sameCell(ofB[slot].cell, facingCell) && ofB[slot].edge === OPPOSITE[edge],
    );
    if (slotB !== undefined) {
      joints.push({ cell, edge, a: slotA, b: slotB });
    }
  }
  return joints;
}

/** True exactly when the two cards cover a common cell (R5.10). */
export function overlaps(a: Placement, b: Placement): boolean {
  const ofA = cellsOf(a);
  const ofB = cellsOf(b);
  return [ofA.top, ofA.bottom].some(
    (cell) => sameCell(cell, ofB.top) || sameCell(cell, ofB.bottom),
  );
}
