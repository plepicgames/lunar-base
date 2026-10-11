import { expect, test } from "vitest";
import source from "../../docs/design/cards.json" with { type: "json" };
import {
  actionKey,
  actionsOf,
  cardById,
  catalogue,
  deckCards,
  influenceCards,
  loadCatalogue,
  stationSides,
} from "./catalogue.ts";
import type { ActionDef, CardDef } from "./catalogue.ts";

const config = { seats: 2, influences: false, kickstarter: false } as const;

test("loads all faces and physical counts without treating Terran Outpost as a card", () => {
  const stations = stationSides(config);
  expect(stations).toHaveLength(6);
  expect(stations.every((c) => c.other_side === "stn-terran-outpost")).toBe(true);
  expect(cardById("stn-terran-outpost").count).toBe(0);
  expect(stationSides({ ...config, kickstarter: true })).toHaveLength(10);
  for (const [type, set, faces, copies] of [
    ["module", "base", 27, 50],
    ["agent", "base", 13, 26],
    ["influence", "base", 8, 8],
    ["influence", "kickstarter", 8, 8],
  ] as const) {
    const cards = catalogue.filter((c) => c.type === type && c.set === set);
    expect(cards).toHaveLength(faces);
    expect(cards.reduce((n, c) => n + c.count, 0)).toBe(copies);
  }
});

test("starts with all 50 Modules and 26 Agents (R3.4)", () => {
  const expected = {
    "mod-fusion-reactor": 2,
    "mod-lang-huan-concrete": 2,
    "agt-space-unicorn": 2,
    "mod-indigo-egregore": 2,
    "mod-depot": 2,
    "mod-inflatable-habitat": 4,
    "mod-laika-memorial": 2,
    "mod-space-elevator": 2,
    "mod-experimental-borehole": 4,
    "mod-smart-spaceship": 2,
    "mod-bacon-printer": 2,
    "mod-j-lagg-telescope": 2,
    "agt-kim-the-mech-pilot": 2,
    "agt-mormon-scientist": 2,
    "agt-panaman-broker": 2,
    "mod-chandrasekhar-dome": 1,
    "mod-hayashi-dome": 1,
    "mod-oort-dome": 1,
    "mod-struve-dome": 1,
    "mod-rover-1": 1,
    "mod-rover-2": 1,
    "mod-rover-3": 1,
    "mod-rover-4": 1,
    "mod-asteroid-grinder": 4,
    "agt-market-manipulator": 2,
    "agt-saboteur": 2,
    "mod-beruang-engineers": 2,
    "mod-lunar-capital": 2,
    "mod-underground-headquarters": 2,
    "mod-helium-factory": 2,
    "agt-double-agent": 2,
    "agt-crazy-president": 2,
    "agt-investor": 2,
    "agt-rebel-captain": 2,
    "agt-hacker-pirate": 2,
    "agt-solicitor": 2,
    "agt-spybot-py": 2,
    "mod-satellite-1": 1,
    "mod-satellite-2": 1,
    "mod-artificial-intellect": 2,
  };
  const deck = deckCards(config);
  const counts: Record<string, number> = {};
  for (const id of deck) counts[id] = (counts[id] ?? 0) + 1;
  expect(deck).toHaveLength(76);
  expect(counts).toEqual(expected);
  const types = deck.map((id) => cardById(id).type);
  expect(types.filter((type) => type === "module")).toHaveLength(50);
  expect(types.filter((type) => type === "agent")).toHaveLength(26);
  expect(deckCards({ ...config, seats: 6, influences: true })).toEqual(deck);
  expect(deckCards({ ...config, kickstarter: true })).toEqual(deck);
});

test("R3.4: the Influence option adds the 8 base Influences, one copy each", () => {
  expect(influenceCards(config)).toEqual([]);
  expect(influenceCards({ ...config, kickstarter: true })).toEqual([]);
  const base = influenceCards({ ...config, influences: true });
  expect(base.map((card) => card.name)).toEqual([
    "Quarantine",
    "Lunar Alliance",
    "Entropic Cascade",
    "Terran Embargo",
    "Terran Crackdown",
    "Laika's Paradise",
    "Space Cowboy Capitalism",
    "Runaway Bureaucracy",
  ]);
  expect(base.every((card) => card.type === "influence" && card.set === "base")).toBe(true);
  expect(base.every((card) => card.count === 1 && card.cost.length === 0)).toBe(true);
  // R12.2 picks 8 of these 16 in its own task.
  const both = influenceCards({ ...config, influences: true, kickstarter: true });
  expect(both).toHaveLength(16);
  expect(both.slice(0, 8)).toEqual(base);
});

test("collects every action, including passive and nested choices", () => {
  expect(actionsOf(cardById("mod-fusion-reactor")).map(actionKey)).toEqual([
    "build",
    "draw",
    "discard",
  ]);
  expect(actionsOf(cardById("mod-artificial-intellect")).map(actionKey)).toEqual([
    "shuttle_red_orbs_pay",
  ]);
  const card: CardDef = {
    ...cardById("mod-depot"),
    on_play: [
      {
        op: "choose_one",
        options: [
          [{ op: "draw", n: 1 }],
          [{ op: "choose_one", options: [[{ op: "flip", who: "own" }]] }],
        ],
      },
    ],
  };
  expect(actionsOf(card).map(actionKey)).toEqual(["choose_one", "draw", "choose_one", "flip:own"]);
  expect(actionsOf(cardById("ks-stn-kafka")).map(actionKey)).toEqual([
    "draft",
    "build",
    "exchange_station",
  ]);
  expect(actionsOf(cardById("inf-entropic-cascade")).map(actionKey)).toEqual(["draw", "discard"]);
  expect(actionsOf(cardById("ks-inf-blood-moon")).map(actionKey)).toEqual([
    "look_at_opponent_hand",
    "that_opponent_discards_all_agents",
  ]);
});

test("preserves typed Influence fields and reports unknown card ids", () => {
  expect(cardById("ks-inf-welfare").supply_effect).toEqual({
    rule: "draft_influence_extra_cost",
    cost: ["blue", "blue", "blue"],
    achievements_to_win: 6,
  });
  expect(cardById("inf-terran-crackdown").on_discard).toEqual([
    { op: "flip", who: "all_to_terran_outpost" },
  ]);
  expect(() => cardById("missing-card")).toThrow(/missing-card/);
});

test.each(["main_action", "on_play", "passive", "on_flip_to", "on_discard", "supply_effect"])(
  "rejects an unknown op in %s with its card id",
  (field) => {
    const bad = { op: "unknown_test_op" };
    const value =
      field === "main_action"
        ? [[bad]]
        : field === "supply_effect"
          ? { when: "any_player_drafts_influence", then: [bad] }
          : [bad];
    const copy = {
      ...source,
      cards: source.cards.map((card) =>
        card.id === "mod-depot" ? { ...card, [field]: value } : card,
      ),
    };
    expect(() => loadCatalogue(copy)).toThrow(/mod-depot.*unknown_test_op/);
  },
);

test("rejects an unknown op inside a choice", () => {
  const copy = {
    ...source,
    cards: source.cards.map((card) =>
      card.id === "mod-depot"
        ? { ...card, on_play: [{ op: "choose_one", options: [[{ op: "bad_nested_op" }]] }] }
        : card,
    ),
  };
  expect(() => loadCatalogue(copy)).toThrow(/mod-depot.*bad_nested_op/);
});

// A new op must add a case here: no default can hide an unhandled variant.
function describeAction(action: ActionDef): string {
  switch (action.op) {
    case "draft":
    case "draw":
    case "discard":
    case "build":
    case "resell":
    case "opponent_resells":
    case "each_player_loses_credits":
    case "steal_credits":
    case "target_discards":
    case "each_opponent_discards":
    case "that_opponent_discards":
      return `${action.op}:${String(action.n)}`;
    case "flip":
      return action.who;
    case "steal_module":
      return action.kind;
    case "choose_one":
      return action.options.flat().map(describeAction).join(",");
    case "gain_credit_per_hand_card":
    case "look_at_opponent_hand":
    case "discard_hand":
    case "resell_per_supply_influence":
    case "shuttle_red_orbs_pay":
    case "exchange_station":
    case "neighbours_exchange_stations":
    case "that_opponent_discards_all_agents":
      return action.op;
  }
  const exhaustive: never = action;
  return exhaustive;
}

test("all 22 action variants can be narrowed exhaustively", () => {
  const actions = catalogue.flatMap(actionsOf);
  expect(new Set(actions.map((a) => a.op)).size).toBe(22);
  expect(actions.map(describeAction).every((description) => description.length > 0)).toBe(true);
});
