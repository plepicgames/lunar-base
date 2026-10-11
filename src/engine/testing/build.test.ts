import { expect, test } from "vitest";
import { buildBase, buildState, cardOfState } from "./build.ts";

test("buildBase deals a Station as setup does: Terran Outpost up, not revealed, no Modules", () => {
  const { base, cardOf } = buildBase({ station: "stn-imbrium" });
  expect(base).toEqual({
    station: { card: "c1", side: "terran_outpost", revealed: false },
    modules: [],
  });
  expect(cardOf("c1").id).toBe("stn-imbrium");
});

test("buildBase places Modules in the order given, each with its own instance id", () => {
  const { base, cardOf } = buildBase({
    station: "stn-imbrium",
    side: "named",
    modules: [
      ["mod-hayashi-dome", 1, 0, 0],
      ["mod-space-elevator", 0, -1, 1],
      ["mod-space-elevator", 4, 4, 2],
    ],
  });
  expect(base.station).toEqual({ card: "c1", side: "named", revealed: true });
  expect(base.modules).toEqual([
    { card: "c2", x: 1, y: 0, q: 0 },
    { card: "c3", x: 0, y: -1, q: 1 },
    { card: "c4", x: 4, y: 4, q: 2 },
  ]);
  expect(base.modules.map((module) => cardOf(module.card).id)).toEqual([
    "mod-hayashi-dome",
    "mod-space-elevator",
    "mod-space-elevator",
  ]);
});

test("a Station can show Terran Outpost after it was revealed", () => {
  const { base } = buildBase({ station: "stn-imbrium", revealed: true });
  expect(base.station).toEqual({ card: "c1", side: "terran_outpost", revealed: true });
});

test("buildState numbers the instances across seats and keeps the table", () => {
  const state = buildState([
    { station: "stn-imbrium", modules: [["mod-depot", 1, 0, 0]] },
    { station: "stn-dark-side", side: "named" },
  ]);
  expect(state.cards).toEqual({ c1: "stn-imbrium", c2: "mod-depot", c3: "stn-dark-side" });
  expect(state.bases.map((base) => base.station.card)).toEqual(["c1", "c3"]);
  expect(cardOfState(state)("c3").name).toBe("Dark Side");
});

test("the built state is plain JSON", () => {
  const state = buildState([{ station: "stn-imbrium", modules: [["mod-depot", 1, 0, 0]] }]);
  expect(JSON.parse(JSON.stringify(state))).toEqual(state);
});

test("a wrong card is reported when the state is built", () => {
  expect(() => buildBase({ station: "stn-nowhere" })).toThrow("Unknown card id: stn-nowhere");
  expect(() => buildBase({ station: "stn-terran-outpost" })).toThrow("not a named Station side");
  expect(() => buildBase({ station: "mod-depot" })).toThrow("not a named Station side");
  expect(() =>
    buildBase({ station: "stn-imbrium", modules: [["agt-solicitor", 1, 0, 0]] }),
  ).toThrow("not a Module");
});

test("the resolver names an instance id that is not in the table", () => {
  const { cardOf } = buildBase({ station: "stn-imbrium" });
  expect(() => cardOf("c9")).toThrow("Unknown card instance: c9");
});
