import { describe, expect, it } from "vitest";
import { actionHandlers } from "./actions/index.ts";
import { applyChoice, run, type Registry, type Resolved } from "./loop.ts";
import { dealGame } from "./setup.ts";
import type { GameState } from "./state.ts";
import { buildState, type BaseSpec } from "./testing/build.ts";
import { pushTurn, turnHandlers } from "./turn.ts";
import { victoryAfterStep } from "./victory.ts";
import { viewFor } from "./view.ts";

const dealt = dealGame(
  { seats: 2, startingSeat: 0, influences: false, kickstarter: false },
  "agent",
);
const registry: Registry = {
  handlers: turnHandlers(actionHandlers),
  afterStep: (state) => ({ state }),
};

const MORMON = "agt-mormon-scientist";
const KIM = "agt-kim-the-mech-pilot";
const HABITAT = "mod-inflatable-habitat";
const BOREHOLE = "mod-experimental-borehole";

/** Two red Orbs printed on Selene Labs and two blue joints: Mormon Scientist's cost (p. 20). */
const LABS: BaseSpec = {
  station: "stn-selene-labs",
  side: "named",
  modules: [["mod-underground-headquarters", -1, 0, 0]],
};
/** No Orb at all. */
const OUTPOST: BaseSpec = { station: "stn-shackleton" };

interface Spec {
  /** Catalogue ids of seat 0's hand: instances h1, h2, ... */
  readonly hand?: readonly string[];
  /** The Supply: instances s1, s2, ... */
  readonly supply?: readonly string[];
  /** The Deck, top first: instances k1, k2, ... */
  readonly deck?: readonly string[];
  /** The Discard pile: instances x1, x2, ... */
  readonly discard?: readonly string[];
  readonly credits?: number;
  /** Seat 0's Base. Default: `LABS`. */
  readonly base?: BaseSpec;
}

/** Seat 0's turn at its first decision, with every zone set by hand. */
function game(spec: Spec): GameState {
  const built = buildState([spec.base ?? LABS, OUTPOST]);
  const cards: Record<string, string> = { ...built.cards };
  const zone = (prefix: string, ids: readonly string[] = []): string[] =>
    ids.map((id, index) => {
      const key = `${prefix}${String(index + 1)}`;
      cards[key] = id;
      return key;
    });
  const zones = {
    hands: [zone("h", spec.hand), []],
    supply: zone("s", spec.supply),
    deck: zone("k", spec.deck),
    discard: zone("x", spec.discard),
  };
  const state: GameState = {
    ...dealt,
    ...zones,
    cards,
    bases: built.bases,
    removedStations: [],
    credits: [spec.credits ?? 3, 3],
  };
  return run(pushTurn(state), registry).state;
}

/** Applies the option with this id of the pending decision. */
function choose(state: GameState, option: string): Resolved {
  const pending = state.pending;
  if (pending === null) throw new Error("No decision is pending");
  const result = applyChoice(state, { seat: pending.seat, decision: pending.id, option }, registry);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

/** The id of the first Build that D6 offers after "Do not Build". */
function firstBuild(state: GameState): string {
  const option = state.pending?.kind === "build" ? state.pending.options.at(1) : undefined;
  if (option === undefined) throw new Error("No Build is offered");
  return option.id;
}

describe("agent_step", () => {
  it("D1: offers each Agent in hand the active player can pay for, then going on", () => {
    const state = game({ hand: [MORMON, HABITAT, KIM] });
    expect(state.turn.step).toBe("agent");
    expect(state.pending).toStrictEqual({
      id: "d1",
      seat: 0,
      kind: "agent",
      options: [
        { id: "h1", label: "Play Mormon Scientist, pay 0", card: "h1", price: 0 },
        { id: "h3", label: "Play Kim the Mech Pilot, pay 3", card: "h3", price: 3 },
        { id: "go_on", label: "Go on to the Main Action" },
      ],
    });
  });

  it("R10.1: an Influence in hand is never a D1 option, though it has no cost", () => {
    const mixed = game({ hand: ["inf-quarantine", MORMON, "inf-terran-embargo"] });
    expect(mixed.pending).toMatchObject({ seat: 0, kind: "agent" });
    expect(mixed.pending?.options.map((option) => option.id)).toEqual(["h2", "go_on"]);
    // With only Influences in hand there is no Agent to play and D1 is not asked.
    const only = game({ hand: ["inf-quarantine", "inf-terran-embargo"] });
    expect(only.pending?.kind).toBe("main_action");
    expect(only.hands[0]).toEqual(["h1", "h2"]);
    expect(only.play).toEqual([]);
  });

  it("R4.3, R4.4: Mormon Scientist costs 0 with Orbs that cover its cost, lies in the play area during its Draft and Build and in the Discard pile after them", () => {
    const played = choose(game({ hand: [MORMON], supply: [HABITAT, BOREHOLE] }), "h1");
    const agent = { instance: "h1", cardId: MORMON };
    expect(played.events).toStrictEqual([{ type: "agent_played", seat: 0, card: agent, cost: 0 }]);
    const drafting = played.state;
    expect(drafting.pending?.kind).toBe("draft");
    expect(drafting).toMatchObject({ play: ["h1"], discard: [], hands: [[], []], credits: [3, 3] });
    // The play area is public (R2.3).
    expect(viewFor(drafting, 1).play).toEqual([agent]);

    const building = choose(drafting, "s1").state;
    expect(building.pending?.kind).toBe("build");
    expect(building).toMatchObject({ play: ["h1"], discard: [], hands: [["s1"], []] });

    const built = choose(building, firstBuild(building));
    expect(built.events.map((event) => event.type)).toEqual(["module_built", "agent_discarded"]);
    expect(built.events.at(-1)).toStrictEqual({ type: "agent_discarded", seat: 0, card: agent });
    expect(built.state).toMatchObject({ play: [], discard: ["h1"], hands: [[], []] });
    expect(built.state.bases[0].modules.at(-1)?.card).toBe("s1");
    expect(viewFor(built.state, 1)).toMatchObject({ play: [], discard: [agent] });
    // No Agent is left in hand, so the step ends.
    expect(built.state.pending?.kind).toBe("main_action");
  });

  it("R4.4, R6.3: an uncovered cost Orb is paid in Credits in a step before the card is played", () => {
    const start = game({ hand: [KIM], credits: 4 });
    const played = choose(start, "h1");
    const card = { instance: "h1", cardId: KIM };
    // Draw 2 with an empty Deck and Discard pile is skipped; the Build offers nothing.
    expect(played.events).toStrictEqual([
      { type: "credits_changed", seat: 0, delta: -3, credits: 1 },
      { type: "agent_played", seat: 0, card, cost: 3 },
      { type: "agent_discarded", seat: 0, card },
    ]);
    expect(played.state).toMatchObject({ credits: [1, 3], play: [], discard: ["h1"] });
  });

  it("R6.4: an Agent the player cannot pay for is not offered", () => {
    // Kim costs 3 Credits here and Mormon Scientist none.
    const state = game({ hand: [KIM, MORMON], credits: 2 });
    expect(state.pending?.options.map((option) => option.id)).toEqual(["h2", "go_on"]);
    // Without Orbs Mormon Scientist costs 4 Credits: exact payment is offered (R6.4).
    const exact = game({ hand: [MORMON], credits: 4, base: OUTPOST });
    expect(exact.pending?.options[0]).toMatchObject({ id: "h1", price: 4 });
    expect(choose(exact, "h1").state.credits).toEqual([0, 3]);
  });

  it("R6.4: with no playable Agent D1 is applied without a decision", () => {
    const state = game({ hand: [KIM, HABITAT], credits: 2 });
    expect(state.pending).toMatchObject({ id: "d1", seat: 0, kind: "main_action" });
    expect(state).toMatchObject({ hands: [["h1", "h2"], []], credits: [2, 3], play: [] });
    expect(state.turn.step).toBe("main_action");
  });

  it("R4.3: going on ends the step with the Agents still in hand", () => {
    const after = choose(game({ hand: [MORMON, MORMON] }), "go_on");
    expect(after.events).toEqual([]);
    expect(after.state.pending?.kind).toBe("main_action");
    expect(after.state).toMatchObject({ hands: [["h1", "h2"], []], play: [], discard: [] });
  });

  it("R4.3: the step repeats, and an Agent Drafted by Mormon Scientist can be played in it", () => {
    // One Supply card, so the Draft takes it; with no Module in hand the Build is skipped.
    const first = choose(game({ hand: [MORMON], supply: [MORMON] }), "h1").state;
    expect(first.turn.step).toBe("agent");
    expect(first.pending).toMatchObject({
      seat: 0,
      kind: "agent",
      options: [{ id: "s1", label: "Play Mormon Scientist, pay 0" }, { id: "go_on" }],
    });
    expect(first).toMatchObject({ hands: [["s1"], []], play: [], discard: ["h1"] });
    const second = choose(first, "s1");
    expect(second.events.map((event) => event.type)).toEqual(["agent_played", "agent_discarded"]);
    expect(second.state).toMatchObject({ hands: [[], []], play: [], discard: ["h1", "s1"] });
    expect(second.state.pending?.kind).toBe("main_action");
  });

  it("R8.8: a reshuffle during Kim the Mech Pilot's Draw 2 leaves that Agent out of the new Deck", () => {
    const start = game({ hand: [KIM], discard: [HABITAT], credits: 5, base: OUTPOST });
    const played = choose(start, "h1");
    // The new Deck is the one Discarded card. Kim is not in it, so the second Draw finds
    // both piles empty and is skipped (R8.7).
    expect(played.events.slice(0, 4)).toStrictEqual([
      { type: "credits_changed", seat: 0, delta: -5, credits: 0 },
      { type: "agent_played", seat: 0, card: { instance: "h1", cardId: KIM }, cost: 5 },
      { type: "deck_reshuffled", count: 1 },
      { type: "card_drawn", seat: 0, card: { instance: "x1", cardId: HABITAT } },
    ]);
    const building = played.state;
    expect(building.pending?.kind).toBe("build");
    expect(building).toMatchObject({ play: ["h1"], deck: [], discard: [], hands: [["x1"], []] });
    const built = choose(building, firstBuild(building)).state;
    expect(built).toMatchObject({ play: [], deck: [], discard: ["h1"] });
  });

  it("R11.2: a Build in an Agent's text that wins ends the game with the Agent still in the play area", () => {
    // 9 colonists: Selene Labs 1, Underground Headquarters 2, two Indigo Egregores 3 each.
    const crowded: BaseSpec = {
      ...LABS,
      modules: [
        ...(LABS.modules ?? []),
        ["mod-indigo-egregore", 10, 10, 0],
        ["mod-indigo-egregore", 20, 20, 0],
      ],
    };
    const checked: Registry = { handlers: registry.handlers, afterStep: victoryAfterStep };
    const building = choose(game({ hand: [MORMON], supply: [HABITAT], base: crowded }), "h1").state;
    const won = applyChoice(
      building,
      { seat: 0, decision: building.pending?.id ?? "", option: firstBuild(building) },
      checked,
    );
    if (!won.ok) throw new Error(won.error.message);
    expect(won.events.map((event) => event.type)).toEqual(["module_built", "game_ended"]);
    expect(won.state.result).toMatchObject({ reason: "victory", winners: [0] });
    expect(won.state).toMatchObject({ play: ["h1"], discard: [], stack: [] });
  });

  it("R8.8: the Agent in the play area is in neither pile after a larger reshuffle", () => {
    const start = game({ hand: [KIM], discard: [HABITAT, BOREHOLE, HABITAT], credits: 5 });
    const building = choose(start, "h1").state;
    expect(building.play).toEqual(["h1"]);
    expect([...building.deck, ...building.hands[0]].sort()).toEqual(["x1", "x2", "x3"]);
    expect(building.deck).toHaveLength(1);
    expect(building.discard).toEqual([]);
  });
});
