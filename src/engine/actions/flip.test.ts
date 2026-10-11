import { describe, expect, it } from "vitest";
import { orbsOf } from "../base.ts";
import { cardById, stationSides, type ActionDef } from "../catalogue.ts";
import { eventFor } from "../events.ts";
import { gameRegistry } from "../game.ts";
import { applyChoice, run, type Registry, type Resolved } from "../loop.ts";
import { dealGame } from "../setup.ts";
import type { GameState } from "../state.ts";
import { buildState, cardOfState, type BaseSpec } from "../testing/build.ts";
import { pushTurn } from "../turn.ts";
import { viewFor } from "../view.ts";
import { flipStations } from "./flip.ts";
import { actionHandlers, handlerOf, pushAction, type ActionFrame } from "./index.ts";

const BASE = { seats: 2, influences: false, kickstarter: false } as const;
const OWN: ActionDef = { op: "flip", who: "own" };
const NO_ORBS = { red: 0, blue: 0, yellow: 0, wild: 0 };

/** Hand-built Bases, Stations c1, c2, ... by seat; seat 0 is active and every pile is empty. */
function game(specs: readonly BaseSpec[], extra: Readonly<Record<string, string>> = {}): GameState {
  const built = buildState(specs);
  const dealt = dealGame({ ...BASE, seats: specs.length, startingSeat: 0 }, "flip");
  return {
    ...dealt,
    ...built,
    cards: { ...built.cards, ...extra },
    hands: specs.map(() => []),
    credits: specs.map(() => 3),
    deck: [],
    supply: [],
    discard: [],
    removedStations: [],
  };
}

/** One step of the action's own handler, with its frame on top of the stack. */
function step(state: GameState, action: ActionDef, seat = 0) {
  const started = pushAction(state, action, seat);
  return handlerOf(actionHandlers, action)(started, started.stack.at(-1) as ActionFrame, null);
}

function choose(state: GameState, option: string, registry: Registry = gameRegistry): Resolved {
  const pending = state.pending;
  if (!pending) throw new Error("Expected a decision");
  const result = applyChoice(state, { seat: pending.seat, decision: pending.id, option }, registry);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

function optionOf(state: GameState, label: string): string {
  const option = state.pending?.options.find((item) => item.label === label);
  if (!option) throw new Error(`Expected the option ${label}`);
  return option.id;
}

function stationView(state: GameState, viewer: number | null, owner = 0) {
  return viewFor(state, viewer).players[owner].base.station;
}

describe("R7.8 Flip your Station", () => {
  const start = game([
    { station: "stn-shackleton", modules: [["mod-fusion-reactor", -1, 0, 0]] },
    { station: "stn-imbrium" },
  ]);

  it("shows the named side, reveals it and keeps the Station's place and joints", () => {
    const before = structuredClone(start);
    expect(stationView(start, 0).named).toBe("stn-shackleton");
    expect(stationView(start, 1).named).toBeNull();
    const jointOrbs = orbsOf(start.bases[0], cardOfState(start));
    expect(jointOrbs).not.toEqual(NO_ORBS);

    const flipped = step(start, OWN);
    // R7.8: never optional, so nobody is asked; R8.5: the action is this one step.
    expect(flipped.state.pending).toBeNull();
    expect(flipped.state.stack).toEqual([]);
    expect(flipped.state.bases[0].station).toEqual({ card: "c1", side: "named", revealed: true });
    expect(flipped.state.bases[0].modules).toBe(start.bases[0].modules);
    expect(flipped.state.bases[1]).toBe(start.bases[1]);
    // The joints are the same; only the two printed blue Orbs are new (R5.7).
    expect(orbsOf(flipped.state.bases[0], cardOfState(start))).toEqual({
      ...jointOrbs,
      blue: jointOrbs.blue + 2,
    });
    expect(flipped.events).toEqual([
      {
        type: "station_flipped",
        flips: [{ seat: 0, card: { instance: "c1", cardId: "stn-shackleton" } }],
      },
    ]);
    for (const viewer of [0, 1, null]) {
      expect(stationView(flipped.state, viewer)).toEqual({
        instance: "c1",
        cardId: "stn-shackleton",
        side: "named",
        named: "stn-shackleton",
        revealed: true,
      });
    }
    expect(start).toEqual(before);
  });

  it("a second Flip shows Terran Outpost again and the named side stays public (R2.4)", () => {
    const again = step(step(start, OWN).state, OWN);
    expect(again.state.bases[0].station).toEqual({
      card: "c1",
      side: "terran_outpost",
      revealed: true,
    });
    expect(orbsOf(again.state.bases[0], cardOfState(start))).toEqual(
      orbsOf(start.bases[0], cardOfState(start)),
    );
    expect(again.events).toEqual([
      {
        type: "station_flipped",
        flips: [{ seat: 0, card: { instance: "c1", cardId: "stn-terran-outpost" } }],
      },
    ]);
    for (const viewer of [0, 1, null]) {
      expect(stationView(again.state, viewer)).toEqual({
        instance: "c1",
        cardId: "stn-terran-outpost",
        side: "terran_outpost",
        named: "stn-shackleton",
        revealed: true,
      });
    }
    // The other Station was never Flipped: its named side is still its owner's alone.
    expect(stationView(again.state, 0, 1).named).toBeNull();
    expect(stationView(again.state, 1, 1).named).toBe("stn-imbrium");
  });

  it("flips the Station of the seat that performs the action", () => {
    const flipped = step(start, OWN, 1).state;
    expect(flipped.bases[0]).toBe(start.bases[0]);
    expect(flipped.bases[1].station).toEqual({ card: "c3", side: "named", revealed: true });
  });

  it("with no Station to turn, changes nothing and emits no event", () => {
    expect(flipStations(start, [])).toEqual({ state: start });
  });
});

// Rules 9.1, the Station table: printed Orbs, colonists, achievements, Main Action boxes.
const STATION_TABLE = [
  ["stn-shackleton", { blue: 2 }, 2, [], "Draft / Build x2, Draw"],
  ["stn-selene-labs", { red: 2 }, 1, ["flask", "dna"], "Draft / Build / Draw x3"],
  ["stn-taikotech", { yellow: 2 }, 2, [], "Build / Draft, Resell x2"],
  ["stn-the-oasis", { blue: 1, red: 1 }, 1, ["lotus"], "Draft / Build, Draw x2"],
  [
    "stn-dark-side",
    { red: 1, yellow: 1 },
    1,
    ["cyber_head"],
    "Draft / Build / Build, Draft, Target Discards",
  ],
  ["stn-imbrium", { blue: 1, yellow: 1 }, 2, ["helmet"], "Draft / Steal 3 Credits, Build"],
] as const;

describe("R9.2 the visible side of a Station", () => {
  it("the table names the six base Stations", () => {
    expect(STATION_TABLE.map(([id]) => id)).toEqual(stationSides(BASE).map((card) => card.id));
  });

  it.each(STATION_TABLE)(
    "%s: after a Flip the D2 options and the counts are its table row",
    (id, orbs, colonists, achievements, boxes) => {
      const start = game([{ station: id }, { station: "stn-shackleton" }]);
      const labels = (state: GameState) => {
        const asked = run(pushTurn(state), gameRegistry).state;
        expect(asked.pending).toMatchObject({ seat: 0, kind: "main_action" });
        return asked.pending?.options.map((option) => option.label);
      };
      expect(labels(start)).toEqual([
        "Terran Outpost: Draft",
        "Terran Outpost: Build",
        "Terran Outpost: Resell x2, Draw",
      ]);
      const flipped = step(start, OWN).state;
      const { name } = cardById(id);
      expect(labels(flipped)).toEqual(boxes.split(" / ").map((box) => `${name}: ${box}`));
      expect(viewFor(flipped, 1).players[0]).toMatchObject({
        colonists,
        achievements,
        base: { orbs: { ...NO_ORBS, ...orbs } },
      });
      expect(viewFor(start, 1).players[0]).toMatchObject({
        colonists: 0,
        achievements: [],
        base: { orbs: NO_ORBS },
      });
    },
  );
});

describe("each_player: Crazy President", () => {
  const specs: readonly BaseSpec[] = [
    { station: "stn-shackleton" },
    { station: "stn-imbrium", side: "named" },
    { station: "stn-dark-side", revealed: true },
  ];

  it("flips every Station in one step, with one event for all seats", () => {
    const start: GameState = {
      ...game(specs, { president: "agt-crazy-president" }),
      hands: [["president"], [], []],
    };
    const seen: string[][] = [];
    const watching: Registry = {
      handlers: gameRegistry.handlers,
      afterStep: (state, frame) => {
        if (frame.kind === "action") seen.push(state.bases.map((base) => base.station.side));
        return gameRegistry.afterStep(state, frame);
      },
    };
    const asked = run(pushTurn(start), watching).state;
    const done = choose(asked, "president", watching);
    expect(seen).toEqual([["named", "terran_outpost", "named"]]);
    expect(done.state.bases.map((base) => base.station)).toEqual([
      { card: "c1", side: "named", revealed: true },
      { card: "c2", side: "terran_outpost", revealed: true },
      { card: "c3", side: "named", revealed: true },
    ]);
    const flips = [
      { seat: 0, card: { instance: "c1", cardId: "stn-shackleton" } },
      { seat: 1, card: { instance: "c2", cardId: "stn-terran-outpost" } },
      { seat: 2, card: { instance: "c3", cardId: "stn-dark-side" } },
    ];
    expect(done.events.map((event) => event.type)).toEqual([
      "agent_played",
      "station_flipped",
      "agent_discarded",
    ]);
    expect(done.events[1]).toEqual({ type: "station_flipped", flips });
    for (const seat of [null, 0, 1, 2]) {
      expect(eventFor(done.events[1], seat)).toEqual({
        type: "station_flipped",
        flips,
        text: "Player 1's Station flipped to Shackleton. Player 2's Station flipped to Terran Outpost. Player 3's Station flipped to Dark Side.",
      });
    }
    // The acting seat's hand is empty, so the turn went on to its Main Action.
    expect(done.state.pending).toMatchObject({ seat: 0, kind: "main_action" });
  });

  it("R5.7: a Flip to Shackleton adds two blue Orbs and lowers a blue cost in the same turn", () => {
    const start: GameState = {
      ...game(specs.slice(0, 2), {
        president: "agt-crazy-president",
        scientist: "agt-mormon-scientist",
      }),
      hands: [["president", "scientist"], []],
      credits: [4, 3],
    };
    const cardOf = cardOfState(start);
    const asked = run(pushTurn(start), gameRegistry).state;
    expect(orbsOf(asked.bases[0], cardOf)).toEqual(NO_ORBS);
    expect(asked.pending?.options.map((option) => option.label)).toEqual([
      "Play Crazy President, pay 0",
      "Play Mormon Scientist, pay 4",
      "Go on to the Main Action",
    ]);
    const flipped = choose(asked, "president").state;
    expect(flipped.turn).toMatchObject({ number: 1, seat: 0, step: "agent" });
    expect(orbsOf(flipped.bases[0], cardOf)).toEqual({ ...NO_ORBS, blue: 2 });
    expect(flipped.pending?.options.map((option) => option.label)).toEqual([
      "Play Mormon Scientist, pay 2",
      "Go on to the Main Action",
    ]);
    const paid = choose(flipped, "scientist");
    expect(paid.events[0]).toEqual({ type: "credits_changed", seat: 0, delta: -2, credits: 2 });
  });
});

describe("R11.2 a Flip that wins", () => {
  it("a Flip to Selene Labs that completes 5 achievements ends the game at that step", () => {
    const start: GameState = {
      ...game(
        [
          {
            station: "stn-selene-labs",
            // Disconnected Modules still count (R5.16).
            modules: [
              ["mod-underground-headquarters", -5, 0, 0],
              ["mod-fusion-reactor", -7, 0, 0],
              ["mod-laika-memorial", -9, 0, 0],
              ["mod-space-elevator", -11, 0, 0],
            ],
          },
          { station: "stn-shackleton" },
        ],
        { held: "mod-inflatable-habitat" },
      ),
      hands: [["held"], []],
    };
    const asked = run(pushTurn(start), gameRegistry).state;
    expect(viewFor(asked, null).players[0].achievements).toEqual(["atom", "dog", "elevator"]);
    const done = choose(
      asked,
      optionOf(asked, "Underground Headquarters: Flip your Station, Build"),
    );
    // The box's Build is never reached: nothing more is resolved.
    expect(done.events.map((event) => event.type)).toEqual([
      "box_chosen",
      "station_flipped",
      "game_ended",
    ]);
    expect(done.state.result).toEqual({ reason: "victory", winners: [0], scores: [1, 0] });
    expect(done.state.stack).toEqual([]);
    expect(done.state.pending).toBeNull();
    expect(done.state.hands[0]).toEqual(["held"]);
    expect([...viewFor(done.state, null).players[0].achievements].sort()).toEqual([
      "atom",
      "dna",
      "dog",
      "elevator",
      "flask",
    ]);
  });
});
