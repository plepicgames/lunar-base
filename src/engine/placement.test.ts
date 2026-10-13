import { describe, expect, test } from "vitest";
import { halfOrb, orbOfJoint, orbsOf, placedCards, type OrbColour } from "./base.ts";
import { cardById, type CardDef } from "./catalogue.ts";
import { jointsOf, overlaps, type Placement, type Quarter } from "./geometry.ts";
import { isLegal, legalPlacements, type LegalPlacement } from "./placement.ts";
import { buildBase, type BaseSpec, type ModuleSpec } from "./testing/build.ts";
import {
  PAGE_23_CORRECT,
  PAGE_23_ORBS,
  PAGE_24_BASE,
  PAGE_24_INCORRECT,
} from "./testing/rulebook-bases.ts";

// Every Station side prints T red, RU gray, RL yellow, LL blue, LU blue and
// nothing at B (rules 9.1). At (0, 0, 0) that is: red on the N edge of
// (0, 0), gray on its E edge, yellow on the E edge of (0, 1), blue on both W
// edges and nothing on the S edge of (0, 1).

const QUARTERS: readonly Quarter[] = [0, 1, 2, 3];

const STATION_ALONE: BaseSpec = { station: "stn-shackleton" };

// A Terran Outpost with an Underground Headquarters upright on its left. The
// Headquarters shows nothing on its T, LL and LU edges.
const WITH_HEADQUARTERS: BaseSpec = {
  station: "stn-shackleton",
  modules: [["mod-underground-headquarters", -1, 0, 0]],
};

function withModules(spec: BaseSpec, ...modules: ModuleSpec[]): BaseSpec {
  return { ...spec, modules: [...(spec.modules ?? []), ...modules] };
}

/** Whether the Module of `spec` may be built into the Base of `baseSpec`. */
function legal(baseSpec: BaseSpec, [id, x, y, q]: ModuleSpec): boolean {
  const { base, cardOf } = buildBase(baseSpec);
  return isLegal(base, cardById(id), { x, y, q }, cardOf);
}

function listed(baseSpec: BaseSpec, id: string): LegalPlacement[] {
  const { base, cardOf } = buildBase(baseSpec);
  return legalPlacements(base, cardById(id), cardOf);
}

// Every placement whose top cell lies within `reach` cells of the Station, in
// the order y, then x, then q.
function placementsNear(reach: number): Placement[] {
  const result: Placement[] = [];
  for (let y = -reach; y <= reach; y += 1) {
    for (let x = -reach; x <= reach; x += 1) {
      for (const q of QUARTERS) result.push({ x, y, q });
    }
  }
  return result;
}

describe("R5.10: both cells are empty", () => {
  // Space Elevator is gray on all six slots, so no colour stands in its way.
  test.each<ModuleSpec>([
    ["mod-space-elevator", 0, 0, 0],
    ["mod-space-elevator", 0, -1, 0],
    ["mod-space-elevator", 0, 1, 0],
    ["mod-space-elevator", 1, 0, 1],
    ["mod-space-elevator", -1, 1, 3],
    ["mod-space-elevator", 0, 2, 2],
  ])("%s at (%i, %i, %i) covers a cell of the Station and is rejected", (...spec) => {
    expect(legal(STATION_ALONE, spec)).toBe(false);
  });

  test("a cell of a Module is occupied too", () => {
    // The Space Elevator's top cell is free; its bottom cell is the top cell of the Headquarters.
    expect(legal(WITH_HEADQUARTERS, ["mod-space-elevator", -1, -1, 0])).toBe(false);
  });

  test("the same card beside the Station is accepted", () => {
    expect(legal(STATION_ALONE, ["mod-space-elevator", 1, 0, 0])).toBe(true);
  });
});

describe("R5.11: a half-orb against an edge with no half-orb", () => {
  // Bacon Printer lying across the top, its top to the east: RU red meets the
  // Station's T red, RL red points south from (-1, -1).
  const printer: ModuleSpec = ["mod-bacon-printer", 0, -1, 1];

  test("the new card's half-orb against a blank edge of the Base is rejected", () => {
    // RL red lies on the blank T of the Headquarters, though RU forms an Orb.
    expect(legal(WITH_HEADQUARTERS, printer)).toBe(false);
  });

  test("the same placement is accepted while that half-orb faces an empty cell", () => {
    expect(legal(STATION_ALONE, printer)).toBe(true);
  });

  test("a half-orb of the Base against a blank edge of the new card is rejected", () => {
    // Lang Huan Concrete on the right: its blank LU lies on the Station's RU
    // gray, though LL gray forms an Orb with the Station's RL yellow.
    expect(legal(STATION_ALONE, ["mod-lang-huan-concrete", 1, 0, 0])).toBe(false);
    // Indigo Egregore on the left: its blank RU lies on the Station's LU
    // blue, though RL blue forms an Orb with the Station's LL blue.
    expect(legal(STATION_ALONE, ["mod-indigo-egregore", -1, 0, 0])).toBe(false);
  });

  test("a half-orb against the Station's blank B is rejected", () => {
    // Bacon Printer below the Station: its T red is its only joint.
    expect(legal(STATION_ALONE, ["mod-bacon-printer", 0, 2, 0])).toBe(false);
  });
});

describe("R5.11: two different colours", () => {
  test("a joint of two different colours is rejected, though another joint forms an Orb", () => {
    // Rover on the right: LU red forms an Orb with the Station's RU gray, LL
    // red lies on the Station's RL yellow.
    expect(legal(STATION_ALONE, ["mod-rover-1", 1, 0, 0])).toBe(false);
  });

  test("two different colours at every joint are rejected", () => {
    // Experimental Borehole on the left: RU and RL red on the Station's two blues.
    expect(legal(STATION_ALONE, ["mod-experimental-borehole", -1, 0, 0])).toBe(false);
  });

  test("gray matches every colour and gray", () => {
    // Laika Memorial above the Station: B gray on the Station's T red.
    expect(legal(STATION_ALONE, ["mod-laika-memorial", 0, -2, 0])).toBe(true);
    // Space Elevator on the left and on the right: gray on blue, gray and yellow.
    expect(legal(STATION_ALONE, ["mod-space-elevator", -1, 0, 0])).toBe(true);
    expect(legal(STATION_ALONE, ["mod-space-elevator", 1, 0, 0])).toBe(true);
  });
});

describe("R5.11, R5.12: blank against blank", () => {
  test("is rejected when it is the only joint", () => {
    // Beruang Engineers below the Station: its blank T on the Station's blank B.
    expect(legal(STATION_ALONE, ["mod-beruang-engineers", 0, 2, 0])).toBe(false);
    // Beruang Engineers left of the Headquarters: blank RU and RL on blank LU and LL.
    expect(legal(WITH_HEADQUARTERS, ["mod-beruang-engineers", -2, 0, 0])).toBe(false);
  });

  test("is accepted when another joint forms an Orb", () => {
    // The Satellite of p. 23: its blank RL on the blank T of the Headquarters,
    // its RU red on the Station's T red.
    expect(legal(WITH_HEADQUARTERS, ["mod-satellite-2", 0, -1, 1])).toBe(true);
  });
});

describe("R5.12: at least one joint forms an Orb", () => {
  test("a card that touches no card of the Base is rejected", () => {
    expect(legal(STATION_ALONE, ["mod-space-elevator", 3, 0, 0])).toBe(false);
    // Corner to corner with the Station: no shared edge.
    expect(legal(STATION_ALONE, ["mod-space-elevator", 1, -2, 0])).toBe(false);
  });

  test("Q32: a placement that joins only a Module with no joint to the Station is legal", () => {
    // A Space Elevator as a Steal can leave it: far from the Station (R5.16).
    const cutOff = withModules(STATION_ALONE, ["mod-space-elevator", 5, 0, 0]);
    const dome: ModuleSpec = ["mod-hayashi-dome", 6, 0, 0];
    expect(legal(cutOff, dome)).toBe(true);
    expect(listed(cutOff, "mod-hayashi-dome")).toContainEqual({
      x: 6,
      y: 0,
      q: 0,
      orbs: ["yellow", "yellow"],
    });
    // Without the cut-off Module nothing is there to join.
    expect(legal(STATION_ALONE, dome)).toBe(false);
  });
});

describe("R5.13: any quarter turn; empty cells are never a problem", () => {
  test.each<ModuleSpec>([
    ["mod-space-elevator", 1, 0, 0],
    ["mod-space-elevator", 2, 0, 1],
    ["mod-space-elevator", 1, 0, 2],
    ["mod-space-elevator", 1, 0, 3],
  ])("%s at (%i, %i, %i) is accepted", (...spec) => {
    expect(legal(STATION_ALONE, spec)).toBe(true);
  });

  test("half-orbs that face empty cells do not count against a placement", () => {
    // Artificial Intellect lying across the top: RU red meets the Station's
    // T red; its five other half-orbs face empty cells.
    expect(legal(STATION_ALONE, ["mod-artificial-intellect", 0, -1, 1])).toBe(true);
  });
});

describe("rulebook p. 23: the CORRECT Base", () => {
  const modules = PAGE_23_CORRECT.modules ?? [];

  test("is legal card by card and forms the Orbs blue, blue, red, yellow, yellow", () => {
    const formed: OrbColour[] = [];
    modules.forEach((module, index) => {
      const before = { ...PAGE_23_CORRECT, modules: modules.slice(0, index) };
      expect(legal(before, module)).toBe(true);
      const [id, x, y, q] = module;
      const entry = listed(before, id).find((p) => p.x === x && p.y === y && p.q === q);
      formed.push(...(entry?.orbs ?? []));
    });
    expect(formed).toEqual(PAGE_23_ORBS);
  });

  test("has the Orbs blue, blue, red, yellow, yellow", () => {
    const { base, cardOf } = buildBase(PAGE_23_CORRECT);
    expect(orbsOf(base, cardOf)).toEqual({ blue: 2, red: 1, yellow: 2, wild: 0 });
  });

  test("is legal card by card in every build order", () => {
    const [a, b, c] = modules;
    const orders = [
      [a, b, c],
      [a, c, b],
      [b, a, c],
      [b, c, a],
      [c, a, b],
      [c, b, a],
    ];
    for (const order of orders) {
      order.forEach((module, index) => {
        expect(legal({ ...PAGE_23_CORRECT, modules: order.slice(0, index) }, module)).toBe(true);
      });
    }
  });
});

describe("rulebook p. 24: the INCORRECT Base", () => {
  test("the Dome the picture does not fault is legal", () => {
    const [dome] = PAGE_24_BASE.modules ?? [];
    expect(legal({ ...PAGE_24_BASE, modules: [] }, dome)).toBe(true);
  });

  test.each(PAGE_24_INCORRECT)("%s at (%i, %i, %i) is rejected", (...spec) => {
    // Against the cards the picture does not fault.
    expect(legal(PAGE_24_BASE, spec)).toBe(false);
    // Against the Base as pictured, with the two other marked cards in it.
    const others = PAGE_24_INCORRECT.filter((other) => other[0] !== spec[0]);
    expect(legal(withModules(PAGE_24_BASE, ...others), spec)).toBe(false);
  });

  test("the Smart Spaceship is rejected only for the card it lies over", () => {
    const spaceship = PAGE_24_INCORRECT[2];
    expect(legal({ ...PAGE_24_BASE, modules: [] }, spaceship)).toBe(true);
  });
});

describe("legalPlacements", () => {
  const cards = ["mod-satellite-2", "mod-oort-dome", "mod-space-elevator", "mod-rover-1"];

  test("lists the four places of a Satellite at a Station that stands alone", () => {
    // T yellow fits the Station's RU gray and RL yellow; RU red fits its T
    // red and RU gray. Every other edge of a Satellite is blank.
    expect(listed(STATION_ALONE, "mod-satellite-2")).toEqual([
      { x: 0, y: -1, q: 1, orbs: ["red"] },
      { x: 1, y: 0, q: 2, orbs: ["red"] },
      { x: 1, y: 0, q: 3, orbs: ["yellow"] },
      { x: 1, y: 1, q: 3, orbs: ["yellow"] },
    ]);
  });

  test("lists the ten places of a Lunar Capital at a Terran Outpost with an Inflatable Habitat on its left", () => {
    const base: BaseSpec = {
      station: "stn-shackleton",
      modules: [["mod-inflatable-habitat", -1, 0, 0]],
    };
    // The fifth lies across both cards: its LL gray meets the Station's T red
    // and its B blue meets the Habitat's T gray. Gray fits any colour.
    expect(listed(base, "mod-lunar-capital")).toEqual([
      { x: -1, y: -2, q: 0, orbs: ["blue"] },
      { x: -2, y: -1, q: 3, orbs: ["wild"] },
      { x: -1, y: -1, q: 1, orbs: ["blue"] },
      { x: -1, y: -1, q: 2, orbs: ["blue"] },
      { x: -1, y: -1, q: 3, orbs: ["red", "blue"] },
      { x: 1, y: -1, q: 0, orbs: ["wild"] },
      { x: 1, y: 0, q: 0, orbs: ["yellow", "blue"] },
      { x: 1, y: 0, q: 2, orbs: ["blue"] },
      { x: 1, y: 0, q: 3, orbs: ["blue"] },
      { x: 2, y: 0, q: 1, orbs: ["blue"] },
    ]);
  });

  test.each(cards)("returns the same list in the same order on two calls: %s", (id) => {
    const { base, cardOf } = buildBase(PAGE_23_CORRECT);
    const first = legalPlacements(base, cardById(id), cardOf);
    const second = legalPlacements(base, cardById(id), cardOf);
    expect(first.length).toBeGreaterThan(0);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  test.each(cards)("every entry passes isLegal: %s", (id) => {
    const { base, cardOf } = buildBase(PAGE_23_CORRECT);
    for (const { x, y, q } of legalPlacements(base, cardById(id), cardOf)) {
      expect(isLegal(base, cardById(id), { x, y, q }, cardOf)).toBe(true);
    }
  });

  test.each(cards)("lists every legal placement, ordered by y, then x, then q: %s", (id) => {
    const { base, cardOf } = buildBase(PAGE_23_CORRECT);
    const all = placementsNear(6).filter((p) => isLegal(base, cardById(id), p, cardOf));
    const found = legalPlacements(base, cardById(id), cardOf).map(({ x, y, q }) => ({ x, y, q }));
    expect(found).toEqual(all);
  });

  test.each(cards)("names the Orbs each placement adds to the Base: %s", (id) => {
    const { base, cardOf } = buildBase(PAGE_23_CORRECT);
    const before = orbsOf(base, cardOf);
    for (const { x, y, q, orbs } of listed(PAGE_23_CORRECT, id)) {
      const built = buildBase(withModules(PAGE_23_CORRECT, [id, x, y, q]));
      const after = { ...before };
      for (const orb of orbs) after[orb] += 1;
      expect(orbs.length).toBeGreaterThan(0);
      expect(orbsOf(built.base, built.cardOf)).toEqual(after);
    }
  });

  test("lists nothing for a card with no half-orbs", () => {
    expect(listed(STATION_ALONE, "agt-double-agent")).toEqual([]);
  });

  test("leaves the Base as it was", () => {
    const { base, cardOf } = buildBase(PAGE_23_CORRECT);
    const before = JSON.stringify(base);
    legalPlacements(base, cardById("mod-space-elevator"), cardOf);
    expect(JSON.stringify(base)).toBe(before);
  });
});

// The rules of 5.3 written a second way, with the joints geometry.ts lists.
function legalByJoints(spec: BaseSpec, card: CardDef, placement: Placement): boolean {
  const { base, cardOf } = buildBase(spec);
  let orbs = 0;
  for (const placed of placedCards(base, cardOf)) {
    if (overlaps(placement, placed.placement)) return false;
    for (const joint of jointsOf(placement, placed.placement)) {
      const mine = halfOrb(card, joint.a);
      const theirs = halfOrb(placed.card, joint.b);
      if (mine === null && theirs === null) continue;
      if (orbOfJoint(mine, theirs) === null) return false;
      orbs += 1;
    }
  }
  return orbs > 0;
}

test.each([
  "mod-fusion-reactor",
  "mod-beruang-engineers",
  "mod-lunar-capital",
  "mod-laika-memorial",
  "mod-artificial-intellect",
])("isLegal agrees with the joints of geometry.ts at every placement: %s", (id) => {
  const { base, cardOf } = buildBase(PAGE_23_CORRECT);
  for (const placement of placementsNear(5)) {
    expect(isLegal(base, cardById(id), placement, cardOf), JSON.stringify(placement)).toBe(
      legalByJoints(PAGE_23_CORRECT, cardById(id), placement),
    );
  }
});
