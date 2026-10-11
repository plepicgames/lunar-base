import { describe, expect, it } from "vitest";
import {
  achievementsOf,
  colonistsOf,
  orbsOf,
  STATION_PLACEMENT,
  type BaseModule,
  type CardOf,
} from "../base.ts";
import { cardById } from "../catalogue.ts";
import { ask } from "../decisions.ts";
import { eventFor } from "../events.ts";
import { gameRegistry } from "../game.ts";
import { jointsOf } from "../geometry.ts";
import { applyChoice, push, run, type Registry, type Resolved } from "../loop.ts";
import { dealGame } from "../setup.ts";
import type { GameState, Seat } from "../state.ts";
import { buildState, type BaseSpec, type ModuleSpec } from "../testing/build.ts";
import { pushTurn } from "../turn.ts";
import { buildOptions } from "./build.ts";
import { pushAction } from "./index.ts";

const BASE = { seats: 2, influences: false, kickstarter: false } as const;

/** The game with a `stop` frame: a test puts it under an action to see the action end. */
const registry: Registry = {
  ...gameRegistry,
  handlers: {
    ...gameRegistry.handlers,
    stop: (state) => ({
      state: ask(state, {
        seat: 0,
        kind: "finished",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      }),
    }),
  },
};

// Upright on the left of the Station: RU and RL blue meet its LU and LL blue.
const HABITAT: ModuleSpec = ["mod-inflatable-habitat", -1, 0, 0];
// Above that Habitat: B gray meets its T gray. No edge of it lies on the Station.
const ELEVATOR: ModuleSpec = ["mod-space-elevator", -1, -2, 0];
// Lying across the top of the Station: RU red meets its T red.
const SATELLITE = [0, -1, 1] as const;

const ALONE: BaseSpec = { station: "stn-imbrium" };
/** A Habitat on the Station and a Space Elevator that only the Habitat joins. */
const CHAIN: BaseSpec = { station: "stn-shackleton", modules: [HABITAT, ELEVATOR] };

/**
 * One Base per spec, with instances c1, c2, ... in the order written, and one
 * hand per seat written as catalogue ids: instances `h<seat><index>`. Seat 0
 * has the turn, every seat has 10 Credits and every pile is empty.
 */
function game(specs: readonly BaseSpec[], hands: readonly (readonly string[])[] = []): GameState {
  const built = buildState(specs);
  const cards: Record<string, string> = { ...built.cards };
  const held = specs.map((_, seat) =>
    (hands.at(seat) ?? []).map((id, index) => {
      const key = `h${String(seat)}${String(index)}`;
      cards[key] = id;
      return key;
    }),
  );
  return {
    ...dealGame({ ...BASE, seats: specs.length, startingSeat: 0 }, "steal-module"),
    ...built,
    cards,
    hands: held,
    credits: specs.map(() => 10),
    deck: [],
    supply: [],
    discard: [],
    removedStations: [],
  };
}

function choose(state: GameState, option: string, rules = gameRegistry): Resolved {
  const pending = state.pending;
  if (!pending) throw new Error("Expected a decision");
  const result = applyChoice(state, { seat: pending.seat, decision: pending.id, option }, rules);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

function chooseLabel(state: GameState, label: string, rules = gameRegistry): Resolved {
  const option = state.pending?.options.find((item) => item.label === label);
  if (!option) throw new Error(`Expected the option ${label}`);
  return choose(state, option.id, rules);
}

/** Seat 0 plays the Agent `h00` in its Agent step and takes one option of its text (D3). */
function play(state: GameState, option: string, rules = gameRegistry): Resolved {
  const asked = run(pushTurn(state), rules).state;
  expect(asked.pending).toMatchObject({ seat: 0, kind: "agent" });
  const text = choose(asked, "h00", rules).state;
  expect(text.pending).toMatchObject({ seat: 0, kind: "choose_one" });
  return chooseLabel(text, option, rules);
}

/** `seat` performs Steal Module of `kind` above a `stop` frame. */
function steal(state: GameState, kind: string, seat: Seat = 0): Resolved {
  return run(pushAction(push(state, "stop"), { op: "steal_module", kind }, seat), registry);
}

function cardOf(state: GameState): CardOf {
  return (instance) => cardById(state.cards[instance]);
}

const HABITAT_OPTION = "Steal Module: Inflatable Habitat";

/** Seat 0 holds a Solicitor. Seat 1 has the chain c3, c4 and holds a Dome; seat 2 has the Habitat c6. */
function solicitorGame(): GameState {
  return game(
    [ALONE, CHAIN, { station: "stn-dark-side", modules: [HABITAT] }],
    [["agt-solicitor"], ["mod-hayashi-dome"]],
  );
}

describe("R7.14 Steal Module / D11", () => {
  it("Solicitor's option Steal an Inflatable Habitat moves the chosen Module to the thief's hand", () => {
    const start = solicitorGame();
    const before = structuredClone(start);
    const asked = play(start, HABITAT_OPTION);
    // D11: every Habitat of the opponents, in seat order. Nothing has moved yet.
    expect(asked.state.pending).toMatchObject({ seat: 0, kind: "steal_module" });
    expect(asked.state.pending?.options).toEqual([
      { id: "c3", label: "Steal Inflatable Habitat at -1,0 from Player 2", card: "c3", target: 1 },
      { id: "c6", label: "Steal Inflatable Habitat at -1,0 from Player 3", card: "c6", target: 2 },
    ]);
    expect(asked.events).toEqual([]);
    expect(asked.state.bases).toEqual(start.bases);
    expect(colonistsOf(asked.state.bases[1], cardOf(asked.state))).toBe(4);

    const done = choose(asked.state, "c3");
    expect(done.events).toEqual([
      {
        type: "module_stolen",
        thief: 0,
        victim: 1,
        card: { instance: "c3", cardId: "mod-inflatable-habitat" },
      },
      { type: "agent_discarded", seat: 0, card: { instance: "h00", cardId: "agt-solicitor" } },
    ]);
    expect(done.state.hands).toEqual([["c3"], ["h10"], []]);
    expect(done.state.bases[1].modules).toEqual([{ card: "c4", x: -1, y: -2, q: 0 }]);
    expect(done.state.bases[2]).toEqual(start.bases[2]);
    expect(done.state.bases[0]).toEqual(start.bases[0]);
    expect(colonistsOf(done.state.bases[1], cardOf(done.state))).toBe(2);
    // The Agent's text is over: the thief goes on to the Main Action.
    expect(done.state.pending).toMatchObject({ seat: 0, kind: "main_action" });

    for (const viewer of [null, 0, 1, 2]) {
      expect(eventFor(done.events[0], viewer)).toEqual({
        type: "module_stolen",
        thief: 0,
        victim: 1,
        card: { instance: "c3", cardId: "mod-inflatable-habitat" },
        text: "Player 1 stole Inflatable Habitat from Player 2.",
      });
    }
    expect(start).toEqual(before);
    expect(choose(JSON.parse(JSON.stringify(asked.state)) as GameState, "c3")).toEqual(done);
  });

  it("R8.5: the Module changes place in one step and is never in two places or in none", () => {
    const places: number[] = [];
    const watched: Registry = {
      ...gameRegistry,
      afterStep: (state, frame) => {
        const held = state.hands.flat().filter((card) => card === "c3").length;
        const built = state.bases
          .flatMap(({ modules }) => modules)
          .filter(({ card }) => card === "c3");
        places.push(held + built.length);
        return gameRegistry.afterStep(state, frame);
      },
    };
    const asked = play(solicitorGame(), HABITAT_OPTION, watched);
    const steps = places.length;
    const done = choose(asked.state, "c3", watched);
    expect(done.events.filter(({ type }) => type === "module_stolen")).toHaveLength(1);
    expect(places.length).toBeGreaterThan(steps);
    expect(new Set(places)).toEqual(new Set([1]));
  });

  it("asks the performing seat and offers the Modules of every other Base in seat order, then in the order built", () => {
    // Two Rovers on seat 0's Station, one on each other Station.
    const rovers = (...modules: ModuleSpec[]): BaseSpec => ({ station: "stn-imbrium", modules });
    const start = game([
      rovers(["mod-rover-2", -1, -1, 3], ["mod-rover-3", 1, -1, 0]),
      rovers(["mod-rover-1", 1, -1, 0]),
      rovers(["mod-rover-4", -1, -1, 3], HABITAT),
    ]);
    const asked = steal(start, "rover", 2).state;
    expect(asked.pending).toMatchObject({ seat: 2, kind: "steal_module" });
    expect(asked.pending?.options).toEqual([
      { id: "c2", label: "Steal Rover at -1,-1 from Player 1", card: "c2", target: 0 },
      { id: "c3", label: "Steal Rover at 1,-1 from Player 1", card: "c3", target: 0 },
      { id: "c5", label: "Steal Rover at 1,-1 from Player 2", card: "c5", target: 1 },
    ]);
    const decision = asked.pending?.id ?? "";
    // Q11: the thief's own Rover c7 is not an option.
    expect(applyChoice(asked, { seat: 2, decision, option: "c7" }, registry)).toMatchObject({
      ok: false,
      error: { code: "unknown_option" },
    });
    const done = choose(asked, "c3", registry);
    expect(done.events).toEqual([
      {
        type: "module_stolen",
        thief: 2,
        victim: 0,
        card: { instance: "c3", cardId: "mod-rover-3" },
      },
    ]);
    expect(done.state.hands).toEqual([[], [], ["c3"]]);
    expect(done.state.bases[0].modules).toEqual([{ card: "c2", x: -1, y: -1, q: 3 }]);
    expect(done.state.bases[1]).toEqual(start.bases[1]);
    expect(done.state.bases[2]).toEqual(start.bases[2]);
    expect(done.state.pending?.kind).toBe("finished");
  });
});

describe("R5.16: a Module that a Steal left with no joint", () => {
  /** After the Steal of c3 seat 0 takes its first box, a Draft from the empty Supply. */
  function cutOff(): GameState {
    const stolen = choose(play(solicitorGame(), HABITAT_OPTION).state, "c3").state;
    const next = chooseLabel(stolen, "Terran Outpost: Draft").state;
    expect(next.turn.seat).toBe(1);
    return next;
  }

  it("keeps its Main Action box in D2 and its colonists; the Orbs formed with the stolen Module are gone (R5.8)", () => {
    const start = solicitorGame();
    expect(orbsOf(start.bases[1], cardOf(start))).toEqual({ red: 0, blue: 2, yellow: 0, wild: 1 });
    expect(colonistsOf(start.bases[1], cardOf(start))).toBe(4);

    const state = cutOff();
    const [elevator] = state.bases[1].modules;
    expect(elevator).toEqual({ card: "c4", x: -1, y: -2, q: 0 });
    expect(jointsOf(STATION_PLACEMENT, elevator)).toEqual([]);
    expect(orbsOf(state.bases[1], cardOf(state))).toEqual({ red: 0, blue: 0, yellow: 0, wild: 0 });
    expect(colonistsOf(state.bases[1], cardOf(state))).toBe(2);
    expect(achievementsOf(state.bases[1], cardOf(state))).toEqual(new Set(["elevator"]));
    expect(state.pending).toMatchObject({ seat: 1, kind: "main_action" });
    expect(state.pending?.options).toContainEqual({
      id: "c4:0",
      label: "Space Elevator: Draft x2",
      card: "c4",
      box: 0,
    });
  });

  it("Q32, R5.12: a later Build may join only the cut-off Module", () => {
    const state = cutOff();
    // The Dome's RL blue on the Elevator's LU gray, three rows above the Station.
    const far: BaseModule = { card: "h10", x: -2, y: -3, q: 0 };
    expect(buildOptions(state, 1)).toContainEqual(
      expect.objectContaining({ ...far, orbs: ["blue"] }),
    );
    expect(jointsOf(STATION_PLACEMENT, far)).toEqual([]);
    const building = chooseLabel(state, "Terran Outpost: Build").state;
    expect(building.pending).toMatchObject({ seat: 1, kind: "build" });
    const built = choose(building, "h10:-2,-3,0");
    expect(built.events).toContainEqual(
      expect.objectContaining({ type: "module_built", seat: 1, x: -2, y: -3, q: 0 }),
    );
    expect(built.state.bases[1].modules).toEqual([{ card: "c4", x: -1, y: -2, q: 0 }, far]);
    expect(orbsOf(built.state.bases[1], cardOf(built.state))).toMatchObject({ blue: 1, wild: 0 });
  });
});

describe("Q10, Q11: Hacker Pirate", () => {
  it("can Steal a Satellite, which has no STEALABLE tag, and is never offered its own", () => {
    expect(cardById("mod-satellite-2").tags).not.toContain("STEALABLE");
    const satellite = (id: string): BaseSpec => ({
      station: "stn-imbrium",
      modules: [[id, ...SATELLITE]],
    });
    const start = game(
      [satellite("mod-satellite-1"), satellite("mod-satellite-2"), ALONE],
      [["agt-hacker-pirate"]],
    );
    // One Satellite lies in an opponent's Base, so the loop takes it without asking (D11).
    const done = play(start, "Steal Module: Satellite");
    expect(done.events.map(({ type }) => type)).toEqual(["module_stolen", "agent_discarded"]);
    expect(done.events[0]).toEqual({
      type: "module_stolen",
      thief: 0,
      victim: 1,
      card: { instance: "c4", cardId: "mod-satellite-2" },
    });
    expect(done.state.hands[0]).toEqual(["c4"]);
    expect(done.state.bases[1].modules).toEqual([]);
    expect(achievementsOf(done.state.bases[1], cardOf(done.state))).toEqual(new Set());
    // The thief's own Satellite stays where it is.
    expect(done.state.bases[0]).toEqual(start.bases[0]);
  });

  it("offers the option Steal a Rover with a Rover only in the thief's own Base, and it does nothing", () => {
    const start = game(
      [{ station: "stn-imbrium", modules: [["mod-rover-1", 1, -1, 0]] }, CHAIN, ALONE],
      [["agt-hacker-pirate"]],
    );
    const text = choose(run(pushTurn(start), gameRegistry).state, "h00").state;
    // R8.2: every printed option is legal, whatever it can do.
    expect(text.pending?.options.map(({ label }) => label)).toEqual([
      "Flip your Station",
      "Steal Module: Satellite",
      "Steal Module: Rover",
    ]);
    const done = chooseLabel(text, "Steal Module: Rover");
    expect(done.events).toEqual([
      { type: "agent_discarded", seat: 0, card: { instance: "h00", cardId: "agt-hacker-pirate" } },
    ]);
    expect(done.state.bases).toEqual(start.bases);
    expect(done.state.hands).toEqual([[], [], []]);
    expect(done.state.pending).toMatchObject({ seat: 0, kind: "main_action" });
  });
});
