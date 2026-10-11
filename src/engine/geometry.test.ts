import { describe, expect, test } from "vitest";
import type { HalfOrbSlot } from "./catalogue.ts";
import {
  cellsOf,
  jointsOf,
  neighbourOf,
  overlaps,
  slotEdges,
  SLOTS,
  type Cell,
  type Edge,
  type Placement,
  type Quarter,
} from "./geometry.ts";

const QUARTERS: readonly Quarter[] = [0, 1, 2, 3];
const ORIGINS: readonly Cell[] = [
  { x: 0, y: 0 },
  { x: 4, y: -3 },
  { x: -2, y: 5 },
];

function key(cell: Cell): string {
  return `${String(cell.x)},${String(cell.y)}`;
}

// Every placement whose top cell lies within `reach` cells of the origin.
function placementsNear(reach: number): Placement[] {
  const result: Placement[] = [];
  for (let y = -reach; y <= reach; y += 1) {
    for (let x = -reach; x <= reach; x += 1) {
      for (const q of QUARTERS) {
        result.push({ x, y, q });
      }
    }
  }
  return result;
}

describe("cellsOf", () => {
  test("R5.3: the top cell of (x, y, q) is (x, y) for every q", () => {
    for (const { x, y } of ORIGINS) {
      for (const q of QUARTERS) {
        expect(cellsOf({ x, y, q }).top).toEqual({ x, y });
      }
    }
  });

  test("R5.3: the bottom cell of (x, y, q) is (x, y+1), (x-1, y), (x, y-1), (x+1, y) for q = 0, 1, 2, 3", () => {
    for (const { x, y } of ORIGINS) {
      expect(cellsOf({ x, y, q: 0 }).bottom).toEqual({ x, y: y + 1 });
      expect(cellsOf({ x, y, q: 1 }).bottom).toEqual({ x: x - 1, y });
      expect(cellsOf({ x, y, q: 2 }).bottom).toEqual({ x, y: y - 1 });
      expect(cellsOf({ x, y, q: 3 }).bottom).toEqual({ x: x + 1, y });
    }
  });

  test("R5.1: the two cells of a card share an edge", () => {
    for (const q of QUARTERS) {
      const { top, bottom } = cellsOf({ x: 2, y: -1, q });
      expect(Math.abs(top.x - bottom.x) + Math.abs(top.y - bottom.y)).toBe(1);
    }
  });
});

describe("slotEdges", () => {
  test("R5.2: the slot table of rules 5.1 holds at q = 0", () => {
    for (const { x, y } of ORIGINS) {
      const top = { x, y };
      const bottom = { x, y: y + 1 };
      expect(slotEdges({ x, y, q: 0 })).toEqual({
        T: { cell: top, edge: "N" },
        RU: { cell: top, edge: "E" },
        RL: { cell: bottom, edge: "E" },
        B: { cell: bottom, edge: "S" },
        LL: { cell: bottom, edge: "W" },
        LU: { cell: top, edge: "W" },
      });
    }
  });

  test("R5.2: each slot's edge turns N to E to S to W with q", () => {
    const turned: Record<HalfOrbSlot, readonly Edge[]> = {
      T: ["N", "E", "S", "W"],
      RU: ["E", "S", "W", "N"],
      RL: ["E", "S", "W", "N"],
      B: ["S", "W", "N", "E"],
      LL: ["W", "N", "E", "S"],
      LU: ["W", "N", "E", "S"],
    };
    for (const q of QUARTERS) {
      const edges = slotEdges({ x: 3, y: 7, q });
      for (const slot of SLOTS) {
        expect(edges[slot].edge, `${slot} at q = ${String(q)}`).toBe(turned[slot][q]);
      }
    }
  });

  test("R5.2: a slot stays on its top or bottom cell for every q", () => {
    for (const q of QUARTERS) {
      const placement: Placement = { x: -1, y: 2, q };
      const { top, bottom } = cellsOf(placement);
      const edges = slotEdges(placement);
      expect([edges.T.cell, edges.RU.cell, edges.LU.cell]).toEqual([top, top, top]);
      expect([edges.RL.cell, edges.B.cell, edges.LL.cell]).toEqual([bottom, bottom, bottom]);
    }
  });

  test("R5.2: the six slots are six different outer edges of the card for every q", () => {
    for (const q of QUARTERS) {
      const placement: Placement = { x: 0, y: 0, q };
      const { top, bottom } = cellsOf(placement);
      const own = new Set([key(top), key(bottom)]);
      const edges = SLOTS.map((slot) => slotEdges(placement)[slot]);
      expect(new Set(edges.map(({ cell, edge }) => `${key(cell)} ${edge}`)).size).toBe(6);
      for (const { cell, edge } of edges) {
        expect(own.has(key(neighbourOf(cell, edge)))).toBe(false);
      }
    }
  });

  test("R5.2: the slots are listed in the order T, RU, RL, B, LL, LU", () => {
    expect(SLOTS).toEqual(["T", "RU", "RL", "B", "LL", "LU"]);
  });
});

describe("neighbourOf", () => {
  test("R5.3: y grows downward, so N is y - 1 and S is y + 1", () => {
    const cell = { x: 2, y: 5 };
    expect(neighbourOf(cell, "N")).toEqual({ x: 2, y: 4 });
    expect(neighbourOf(cell, "E")).toEqual({ x: 3, y: 5 });
    expect(neighbourOf(cell, "S")).toEqual({ x: 2, y: 6 });
    expect(neighbourOf(cell, "W")).toEqual({ x: 1, y: 5 });
  });
});

describe("jointsOf", () => {
  const station: Placement = { x: 0, y: 0, q: 0 };

  test("R5.5: two cards side by side at q = 0 share two joints, RU against LU and RL against LL", () => {
    expect(jointsOf(station, { x: 1, y: 0, q: 0 })).toEqual([
      { cell: { x: 0, y: 0 }, edge: "E", a: "RU", b: "LU" },
      { cell: { x: 0, y: 1 }, edge: "E", a: "RL", b: "LL" },
    ]);
  });

  test("R5.5: a card at q = 1 across the top of two upright cards shares one joint with each", () => {
    const left = station;
    const right: Placement = { x: 1, y: 0, q: 0 };
    const across: Placement = { x: 1, y: -1, q: 1 };
    expect(cellsOf(across)).toEqual({ top: { x: 1, y: -1 }, bottom: { x: 0, y: -1 } });
    expect(jointsOf(across, left)).toEqual([{ cell: { x: 0, y: -1 }, edge: "S", a: "RL", b: "T" }]);
    expect(jointsOf(across, right)).toEqual([
      { cell: { x: 1, y: -1 }, edge: "S", a: "RU", b: "T" },
    ]);
  });

  test("R5.5: a card half a card lower than its neighbour shares one joint, RL against LU", () => {
    expect(jointsOf(station, { x: 1, y: 1, q: 0 })).toEqual([
      { cell: { x: 0, y: 1 }, edge: "E", a: "RL", b: "LU" },
    ]);
  });

  test("R5.5: a card below another at q = 0 shares one joint, B against T", () => {
    expect(jointsOf(station, { x: 0, y: 2, q: 0 })).toEqual([
      { cell: { x: 0, y: 1 }, edge: "S", a: "B", b: "T" },
    ]);
  });

  test("R5.5: a card turned upside down beside an upright card joins RU to RL and RL to RU", () => {
    expect(jointsOf(station, { x: 1, y: 1, q: 2 })).toEqual([
      { cell: { x: 0, y: 0 }, edge: "E", a: "RU", b: "RL" },
      { cell: { x: 0, y: 1 }, edge: "E", a: "RL", b: "RU" },
    ]);
  });

  test("R5.5: cards that touch only at a corner or lie apart share no joint", () => {
    expect(jointsOf(station, { x: 1, y: 2, q: 0 })).toEqual([]);
    expect(jointsOf(station, { x: 2, y: 0, q: 0 })).toEqual([]);
    expect(jointsOf(station, { x: 5, y: 5, q: 3 })).toEqual([]);
  });

  test("R5.5: a card shares no joint with itself", () => {
    for (const q of QUARTERS) {
      expect(jointsOf({ x: 0, y: 0, q }, { x: 0, y: 0, q })).toEqual([]);
    }
  });

  test("R5.5: the joints of (b, a) are the joints of (a, b) seen from the other side", () => {
    const opposite: Record<Edge, Edge> = { N: "S", E: "W", S: "N", W: "E" };
    const others = placementsNear(3);
    for (const q of QUARTERS) {
      const a: Placement = { x: 0, y: 0, q };
      for (const b of others) {
        const mirrored = jointsOf(a, b).map((joint) => ({
          cell: neighbourOf(joint.cell, joint.edge),
          edge: opposite[joint.edge],
          a: joint.b,
          b: joint.a,
        }));
        const reverse = jointsOf(b, a);
        expect(reverse).toHaveLength(mirrored.length);
        expect(reverse).toEqual(expect.arrayContaining(mirrored));
      }
    }
  });

  test("R5.5: each joint names the slot of a on that edge and the slot of b that faces it", () => {
    const others = placementsNear(3);
    for (const q of QUARTERS) {
      const a: Placement = { x: 0, y: 0, q };
      for (const b of others) {
        for (const joint of jointsOf(a, b)) {
          expect(slotEdges(a)[joint.a]).toEqual({ cell: joint.cell, edge: joint.edge });
          const facing = slotEdges(b)[joint.b];
          expect(neighbourOf(facing.cell, facing.edge)).toEqual(joint.cell);
          expect(neighbourOf(joint.cell, joint.edge)).toEqual(facing.cell);
        }
      }
    }
  });

  test("R5.5: two cards that do not overlap share at most two joints, listed in the slot order of a", () => {
    const others = placementsNear(3);
    for (const q of QUARTERS) {
      const a: Placement = { x: 0, y: 0, q };
      for (const b of others) {
        if (overlaps(a, b)) {
          continue;
        }
        const order = jointsOf(a, b).map((joint) => SLOTS.indexOf(joint.a));
        expect(order.length).toBeLessThanOrEqual(2);
        expect(order).toEqual([...order].sort((i, j) => i - j));
      }
    }
  });
});

describe("overlaps", () => {
  test("R5.10: overlaps is true exactly when the two cards share a cell", () => {
    const others = placementsNear(3);
    let overlapping = 0;
    for (const q of QUARTERS) {
      const a: Placement = { x: 0, y: 0, q };
      const cellsOfA = cellsOf(a);
      const occupied = new Set([key(cellsOfA.top), key(cellsOfA.bottom)]);
      for (const b of others) {
        const { top, bottom } = cellsOf(b);
        const shared = occupied.has(key(top)) || occupied.has(key(bottom));
        expect(overlaps(a, b), JSON.stringify({ a, b })).toBe(shared);
        expect(overlaps(b, a)).toBe(shared);
        overlapping += shared ? 1 : 0;
      }
    }
    // Eight placements cover each cell of a. Two of them cover both cells: a
    // itself and the card lying the other way round. That leaves 14 for each q.
    expect(overlapping).toBe(4 * 14);
  });

  test("R5.10: a card overlaps itself and a card on either of its cells", () => {
    const a: Placement = { x: 0, y: 0, q: 0 };
    expect(overlaps(a, a)).toBe(true);
    expect(overlaps(a, { x: 0, y: 1, q: 0 })).toBe(true);
    expect(overlaps(a, { x: 0, y: 1, q: 2 })).toBe(true);
    expect(overlaps(a, { x: 1, y: 1, q: 1 })).toBe(true);
    expect(overlaps(a, { x: 0, y: -1, q: 0 })).toBe(true);
  });

  test("R5.10: cards that only share an edge or a corner do not overlap", () => {
    const a: Placement = { x: 0, y: 0, q: 0 };
    expect(overlaps(a, { x: 1, y: 0, q: 0 })).toBe(false);
    expect(overlaps(a, { x: 0, y: 2, q: 0 })).toBe(false);
    expect(overlaps(a, { x: 1, y: -1, q: 1 })).toBe(false);
    expect(overlaps(a, { x: 1, y: 2, q: 0 })).toBe(false);
  });
});
