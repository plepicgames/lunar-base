import { describe, expect, test } from "vitest";
import { achievementsOf, colonistsOf, orbOfJoint, orbsOf, visibleSide } from "./base.ts";
import type { OrbCounts } from "./price.ts";
import { buildBase, type ModuleSpec } from "./testing/build.ts";

// Every Station side prints T red, RU gray, RL yellow, LL blue, LU blue and
// nothing at B (rules 9.1). At (0, 0, 0) that is: red on the N edge of
// (0, 0), gray on its E edge, yellow on the E edge of (0, 1), and blue on
// both W edges.

function orbs(part: Partial<OrbCounts> = {}): OrbCounts {
  return { red: 0, blue: 0, yellow: 0, wild: 0, ...part };
}

// A Terran Outpost with these Modules: no printed Orbs, colonists or achievements of its own.
function outpostWith(...modules: ModuleSpec[]) {
  return buildBase({ station: "stn-shackleton", modules });
}

describe("orbOfJoint", () => {
  test.each([
    ["red", "red", "red"],
    ["blue", "blue", "blue"],
    ["yellow", "yellow", "yellow"],
  ] as const)("R5.6: %s with %s forms a %s Orb", (a, b, expected) => {
    expect(orbOfJoint(a, b)).toBe(expected);
  });

  test.each(["red", "blue", "yellow"] as const)(
    "R5.6: gray with %s forms that colour, on either side",
    (colour) => {
      expect(orbOfJoint("gray", colour)).toBe(colour);
      expect(orbOfJoint(colour, "gray")).toBe(colour);
    },
  );

  test("R5.6: gray with gray forms a wild Orb", () => {
    expect(orbOfJoint("gray", "gray")).toBe("wild");
  });

  test("R5.5: a joint without a half-orb on both sides forms nothing", () => {
    expect(orbOfJoint(null, null)).toBeNull();
    for (const colour of ["red", "blue", "yellow", "gray"] as const) {
      expect(orbOfJoint(colour, null)).toBeNull();
      expect(orbOfJoint(null, colour)).toBeNull();
    }
  });

  test("R5.6: two different colours name no Orb (R5.11 forbids the joint)", () => {
    expect(orbOfJoint("red", "blue")).toBeNull();
    expect(orbOfJoint("yellow", "red")).toBeNull();
    expect(orbOfJoint("blue", "yellow")).toBeNull();
  });
});

describe("orbsOf: joints", () => {
  test("R5.5: a half-orb beside an empty cell forms nothing", () => {
    const { base, cardOf } = outpostWith();
    expect(orbsOf(base, cardOf)).toEqual(orbs());
  });

  test("R5.6: two halves of one colour form that colour", () => {
    // Bacon Printer above the Station: its B red meets the Station's T red.
    const { base, cardOf } = outpostWith(["mod-bacon-printer", 0, -2, 0]);
    expect(orbsOf(base, cardOf)).toEqual(orbs({ red: 1 }));
  });

  test("R5.6: gray on the Station with a colour on the Module forms that colour", () => {
    // Satellite turned so its T yellow points west at the Station's RU gray.
    const { base, cardOf } = outpostWith(["mod-satellite-1", 1, 0, 3]);
    expect(orbsOf(base, cardOf)).toEqual(orbs({ yellow: 1 }));
  });

  test("R5.6: gray on the Module with a colour on the Station forms that colour", () => {
    // Laika Memorial above the Station: its B gray meets the Station's T red.
    const { base, cardOf } = outpostWith(["mod-laika-memorial", 0, -2, 0]);
    expect(orbsOf(base, cardOf)).toEqual(orbs({ red: 1 }));
  });

  test("R5.6: gray with gray forms a wild Orb", () => {
    // Laika Memorial turned so its T gray points west at the Station's RU gray.
    const { base, cardOf } = outpostWith(["mod-laika-memorial", 1, 0, 3]);
    expect(orbsOf(base, cardOf)).toEqual(orbs({ wild: 1 }));
  });

  test("R5.5: a card can form an Orb at each of its joints", () => {
    // A Dome to the right: LU yellow meets RU gray, LL yellow meets RL yellow.
    const dome = outpostWith(["mod-hayashi-dome", 1, 0, 0]);
    expect(orbsOf(dome.base, dome.cardOf)).toEqual(orbs({ yellow: 2 }));
    // An Inflatable Habitat to the left: RU and RL blue meet LU and LL blue.
    const habitat = outpostWith(["mod-inflatable-habitat", -1, 0, 0]);
    expect(orbsOf(habitat.base, habitat.cardOf)).toEqual(orbs({ blue: 2 }));
  });

  test("R5.5: a half-orb against a card edge with no half-orb forms nothing", () => {
    // Bacon Printer below the Station: its T red meets the Station's empty B.
    const { base, cardOf } = outpostWith(["mod-bacon-printer", 0, 2, 0]);
    expect(orbsOf(base, cardOf)).toEqual(orbs());
  });

  test("R5.6: two different colours form nothing", () => {
    // A Dome turned upside down on the left: both its yellows meet the Station's blues.
    const { base, cardOf } = outpostWith(["mod-hayashi-dome", -1, 1, 2]);
    expect(orbsOf(base, cardOf)).toEqual(orbs());
  });

  test("R5.3: joints follow the quarter turns of a Module", () => {
    // Lunar Capital upside down on the left: LU blue meets LL blue, LL gray meets LU blue.
    const { base, cardOf } = outpostWith(["mod-lunar-capital", -1, 1, 2]);
    expect(orbsOf(base, cardOf)).toEqual(orbs({ blue: 2 }));
  });

  test("R5.5: a joint between two Modules forms an Orb, counted once", () => {
    // Two Space Elevators (all gray) in a row to the right of the Station.
    const { base, cardOf } = outpostWith(
      ["mod-space-elevator", 1, 0, 0],
      ["mod-space-elevator", 2, 0, 0],
    );
    expect(orbsOf(base, cardOf)).toEqual(orbs({ wild: 3, yellow: 1 }));
  });
});

describe("orbsOf: printed Orbs", () => {
  test("R5.7: a Station showing Shackleton counts two blue printed Orbs", () => {
    const { base, cardOf } = buildBase({ station: "stn-shackleton", side: "named" });
    expect(orbsOf(base, cardOf)).toEqual(orbs({ blue: 2 }));
  });

  test("R5.7: the same Station showing Terran Outpost counts none", () => {
    const { base, cardOf } = buildBase({ station: "stn-shackleton", side: "terran_outpost" });
    expect(orbsOf(base, cardOf)).toEqual(orbs());
  });

  test("R5.7: Kafka prints no Orb", () => {
    const { base, cardOf } = buildBase({ station: "ks-stn-kafka", side: "named" });
    expect(orbsOf(base, cardOf)).toEqual(orbs());
  });

  test("R5.7: Artificial Intellect counts one red", () => {
    // Turned so its RU red points south at the Station's T red: one joint, one printed.
    const { base, cardOf } = outpostWith(["mod-artificial-intellect", 0, -1, 1]);
    expect(orbsOf(base, cardOf)).toEqual(orbs({ red: 2 }));
  });

  test("R5.8: the Orbs of a Base are its printed Orbs plus its joint Orbs", () => {
    const { base, cardOf } = buildBase({
      station: "stn-the-oasis",
      side: "named",
      modules: [
        ["mod-inflatable-habitat", -1, 0, 0],
        ["mod-hayashi-dome", 1, 0, 0],
      ],
    });
    expect(orbsOf(base, cardOf)).toEqual(orbs({ blue: 3, red: 1, yellow: 2 }));
  });
});

describe("visibleSide", () => {
  test("R1.3: a Station shows its named side or Terran Outpost", () => {
    const named = buildBase({ station: "stn-imbrium", side: "named" });
    expect(visibleSide(named.base.station, named.cardOf).id).toBe("stn-imbrium");
    const outpost = buildBase({ station: "stn-imbrium", side: "terran_outpost" });
    expect(visibleSide(outpost.base.station, outpost.cardOf).id).toBe("stn-terran-outpost");
  });
});

describe("colonistsOf and achievementsOf", () => {
  // Legal places for two Domes: one to the right, one turned above the Station.
  const twoDomes: ModuleSpec[] = [
    ["mod-hayashi-dome", 1, 0, 0],
    ["mod-oort-dome", 0, -1, 1],
  ];

  test("R5.14, R5.15: two Domes count 4 colonists and 1 achievement", () => {
    const { base, cardOf } = outpostWith(...twoDomes);
    expect(colonistsOf(base, cardOf)).toBe(4);
    expect(achievementsOf(base, cardOf)).toEqual(new Set(["dome"]));
  });

  test("R5.14: only the visible side of the Station adds colonists", () => {
    const named = buildBase({ station: "stn-shackleton", side: "named", modules: twoDomes });
    expect(colonistsOf(named.base, named.cardOf)).toBe(6);
    const outpost = buildBase({ station: "stn-shackleton", modules: twoDomes });
    expect(colonistsOf(outpost.base, outpost.cardOf)).toBe(4);
  });

  test("R5.15: only the visible side of the Station adds achievements", () => {
    const modules: ModuleSpec[] = [...twoDomes, ["mod-laika-memorial", 0, 2, 0]];
    const named = buildBase({ station: "stn-selene-labs", side: "named", modules });
    expect(achievementsOf(named.base, named.cardOf)).toEqual(
      new Set(["flask", "dna", "dome", "dog"]),
    );
    const outpost = buildBase({ station: "stn-selene-labs", modules });
    expect(achievementsOf(outpost.base, outpost.cardOf)).toEqual(new Set(["dome", "dog"]));
  });

  test("R5.14, R5.15: a Terran Outpost alone counts nothing", () => {
    const { base, cardOf } = outpostWith();
    expect(colonistsOf(base, cardOf)).toBe(0);
    expect(achievementsOf(base, cardOf)).toEqual(new Set());
  });
});

describe("R5.16: a Module with no joint to the rest of the Base", () => {
  test("still adds its colonists, achievement and printed Orbs", () => {
    const { base, cardOf } = outpostWith(
      ["mod-hayashi-dome", 5, 5, 0],
      ["mod-artificial-intellect", -4, -4, 0],
    );
    expect(colonistsOf(base, cardOf)).toBe(2);
    expect(achievementsOf(base, cardOf)).toEqual(new Set(["dome"]));
    expect(orbsOf(base, cardOf)).toEqual(orbs({ red: 1 }));
  });

  test("keeps the joints it still has", () => {
    // Two Space Elevators joined to each other, far from the Station.
    const { base, cardOf } = outpostWith(
      ["mod-space-elevator", 5, 0, 0],
      ["mod-space-elevator", 6, 0, 0],
    );
    expect(orbsOf(base, cardOf)).toEqual(orbs({ wild: 2 }));
  });
});

test("R5.8: nothing is stored: the functions leave the Base as it was", () => {
  const { base, cardOf } = buildBase({
    station: "stn-shackleton",
    side: "named",
    modules: [["mod-hayashi-dome", 1, 0, 0]],
  });
  const before = JSON.stringify(base);
  orbsOf(base, cardOf);
  colonistsOf(base, cardOf);
  achievementsOf(base, cardOf);
  expect(JSON.stringify(base)).toBe(before);
});
