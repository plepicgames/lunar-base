import { describe, expect, it } from "vitest";
import { actionsOf, cardById, catalogue, type ActionDef } from "../catalogue.ts";
import { actionLabel, actionsLabel } from "./label.ts";

describe("actionLabel", () => {
  const cases: readonly (readonly [ActionDef, string])[] = [
    [{ op: "draft", n: 1 }, "Draft"],
    [{ op: "resell", n: 2 }, "Resell x2"],
    [{ op: "draw", n: 3 }, "Draw x3"],
    [{ op: "opponent_resells", n: 2 }, "An opponent Resells x2"],
    [{ op: "steal_credits", n: 3 }, "Steal 3 Credits"],
    [{ op: "each_player_loses_credits", n: 1 }, "Each player Loses 1 Credit"],
    [{ op: "each_player_loses_credits", n: 3 }, "Each player Loses 3 Credits"],
    [{ op: "flip", who: "own" }, "Flip your Station"],
    [{ op: "steal_module", kind: "asteroid_grinder" }, "Steal Module: Asteroid Grinder"],
    [
      {
        op: "choose_one",
        options: [
          [{ op: "flip", who: "own" }],
          [
            { op: "discard", n: 1 },
            { op: "flip", who: "any_two" },
          ],
        ],
      },
      "Do one: Flip your Station / Discard, Flip two Stations",
    ],
  ];

  it.each(cases)("%j is %s", (action, label) => {
    expect(actionLabel(action)).toBe(label);
  });

  it("gives every action of every card a label", () => {
    for (const card of catalogue) {
      for (const action of actionsOf(card)) {
        expect(actionLabel(action), `${card.id} ${action.op}`).toMatch(/^[A-Z][^_]*$/);
      }
    }
  });
});

describe("actionsLabel", () => {
  // The Main Action boxes as rules.md writes them (9.1, 9.2).
  it.each([
    ["stn-terran-outpost", "Draft / Build / Resell x2, Draw"],
    ["stn-shackleton", "Draft / Build x2, Draw"],
    ["stn-selene-labs", "Draft / Build / Draw x3"],
    ["stn-taikotech", "Build / Draft, Resell x2"],
    ["stn-the-oasis", "Draft / Build, Draw x2"],
    ["stn-dark-side", "Draft / Build / Build, Draft, Target Discards"],
    ["stn-imbrium", "Draft / Steal 3 Credits, Build"],
    ["mod-fusion-reactor", "Build, Draw, Discard"],
    ["mod-underground-headquarters", "Flip your Station, Build"],
    ["mod-space-elevator", "Draft x2"],
    ["mod-helium-factory", "Steal 2 Credits, Flip your Station"],
  ])("lists the boxes of %s left to right: %s", (id, boxes) => {
    expect((cardById(id).main_action ?? []).map(actionsLabel).join(" / ")).toBe(boxes);
  });
});
