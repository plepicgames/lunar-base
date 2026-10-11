import { describe, expect, it } from "vitest";
import { orbsOf } from "./base.ts";
import { cardById } from "./catalogue.ts";
import { eventFor } from "./events.ts";
import { push, run, type AfterStep, type Registry } from "./loop.ts";
import { dealGame } from "./setup.ts";
import type { GameState } from "./state.ts";
import { buildState } from "./testing/build.ts";
import { turnHandlers } from "./turn.ts";

function fixture(): GameState {
  const built = buildState([
    {
      station: "stn-taikotech",
      side: "named",
      // Two printed yellow Orbs and one gray-gray joint.
      modules: [["mod-laika-memorial", 1, 0, 3]],
    },
    { station: "stn-imbrium", side: "named" },
  ]);
  return {
    ...dealGame({ seats: 2, influences: false, kickstarter: false, startingSeat: 0 }, "shuttle"),
    ...built,
    cards: {
      ...built.cards,
      ...Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((id) => [id, "mod-rover-1"])),
      influence: "inf-quarantine",
      alliance: "inf-lunar-alliance",
      agent: "agt-double-agent",
    },
    deck: ["a", "b", "c", "d", "e", "f"],
    discard: [],
    supply: [],
    credits: [4, 8],
    hands: [[], []],
    removedStations: [],
    turn: { number: 1, seat: 0, step: "shuttle", work: 0 },
  };
}

function resolve(state: GameState, afterStep: AfterStep = (state) => ({ state })) {
  // Resume the real turn just before the Shuttle step, then stop at next D2.
  const started = push(push(state, "turn", { begun: 3 }), "shuttle_step");
  const registry: Registry = { handlers: turnHandlers({}), afterStep };
  return run(started, registry);
}

describe("Shuttle step", () => {
  it.each([0, 1, 2])(
    "R9.6 / Q21: %i Artificial Intellects give a shared, non-stacking bonus",
    (count) => {
      const built = buildState([
        {
          station: "stn-dark-side",
          side: "named",
          modules: [
            ["mod-laika-memorial", 1, 0, 3],
            ["mod-experimental-borehole", 0, -2, 0],
          ],
        },
        {
          station: "stn-selene-labs",
          side: "named",
          modules:
            count === 0
              ? []
              : count === 1
                ? [["mod-artificial-intellect", 1, -1, 0]]
                : [
                    ["mod-artificial-intellect", 1, -1, 0],
                    ["mod-artificial-intellect", 2, -2, 0],
                  ],
        },
      ]);
      const start: GameState = {
        ...fixture(),
        ...built,
        cards: { ...fixture().cards, ...built.cards, held: "mod-artificial-intellect" },
        hands: [["held"], []],
      };
      expect(orbsOf(start.bases[0], (id) => cardById(start.cards[id]))).toEqual({
        red: 2,
        yellow: 1,
        blue: 0,
        wild: 1,
      });
      const before = structuredClone(start);
      const result = resolve(start);
      const delta = count === 0 ? 2 : 4;
      expect(result.state.credits[0]).toBe(4 + delta);
      const ownerDelta = count === 0 ? 0 : count === 1 ? 4 : 6;
      expect(result.events[0]).toMatchObject({
        type: "shuttles_arrived",
        gains: [
          { seat: 0, delta, credits: 4 + delta },
          { seat: 1, delta: ownerDelta, credits: 8 + ownerDelta },
        ],
      });
      expect(start).toEqual(before);
    },
  );

  it("Q21: Embargo stops yellow, wild and Intellect red payouts, but arrival, check and deal still run", () => {
    const built = buildState([
      {
        station: "stn-dark-side",
        side: "named",
        modules: [
          ["mod-laika-memorial", 1, 0, 3],
          ["mod-experimental-borehole", 0, -2, 0],
        ],
      },
      {
        station: "stn-selene-labs",
        side: "named",
        modules: [["mod-artificial-intellect", 1, -1, 0]],
      },
    ]);
    const start: GameState = {
      ...fixture(),
      ...built,
      cards: { ...fixture().cards, ...built.cards, embargo: "inf-terran-embargo" },
      supply: ["embargo"],
    };
    expect(orbsOf(start.bases[0], (id) => cardById(start.cards[id]))).toEqual({
      red: 2,
      yellow: 1,
      blue: 0,
      wild: 1,
    });
    const checked: unknown[] = [];
    const before = structuredClone(start);
    const result = resolve(start, (state, frame) => {
      if (frame.kind === "shuttle_step") checked.push([state.credits, state.supply]);
      return { state };
    });
    expect(checked).toEqual([[[4, 8], ["embargo"]]]);
    expect(result.state.credits).toEqual([4, 8]);
    expect(result.state.supply).toEqual(["embargo", "a", "b", "c", "d", "e"]);
    expect(result.events.map(({ type }) => type)).toEqual([
      "shuttles_arrived",
      "supply_dealt",
      "turn_started",
    ]);
    expect(result.events[0]).toMatchObject({
      gains: [
        { seat: 0, delta: 0, credits: 4 },
        { seat: 1, delta: 0, credits: 8 },
      ],
    });
    // Once held, Embargo has no Supply effect; all three colours pay again.
    const removed = resolve({ ...start, supply: [], hands: [["embargo"], []] });
    expect(removed.state.credits).toEqual([8, 12]);
    expect(start).toEqual(before);
  });

  it("R10.3: Embargo arriving in the deal affects the next arrival, not the previous payout", () => {
    const start: GameState = {
      ...fixture(),
      cards: { ...fixture().cards, embargo: "inf-terran-embargo" },
      deck: ["embargo"],
    };
    const dealt = resolve(start);
    expect(dealt.state.credits).toEqual([7, 9]);
    expect(dealt.state.supply).toEqual(["embargo"]);
    const next = resolve({ ...dealt.state, stack: [], pending: null });
    expect(next.state.credits).toEqual([7, 9]);
    expect(next.events[0]).toMatchObject({
      type: "shuttles_arrived",
      gains: [
        { seat: 0, delta: 0 },
        { seat: 1, delta: 0 },
      ],
    });
  });

  it.each(["a", "agent"])("R4.7: %s blocks arrival but still runs the end-of-turn hook", (card) => {
    const start = { ...fixture(), supply: [card] };
    const checked: number[][] = [];
    const result = resolve(start, (state, frame) => {
      if (frame.kind === "shuttle_step") checked.push([...state.credits]);
      return { state };
    });
    expect(checked).toEqual([[4, 8]]);
    expect(result.state.credits).toEqual([4, 8]);
    expect(result.state.supply).toEqual([card]);
    expect(result.state.deck).toEqual(start.deck);
    expect(result.events.map((event) => event.type)).toEqual(["turn_started"]);
  });

  it("R4.7 / R4.8: pays every Base in one step and one public event, then checks, then deals", () => {
    const start = fixture();
    const before = JSON.stringify(start);
    const checked: unknown[] = [];
    const result = resolve(start, (state, frame) => {
      if (frame.kind === "shuttle_step") checked.push([state.credits, state.supply, state.deck]);
      return { state };
    });
    expect(checked).toEqual([[[7, 9], [], ["a", "b", "c", "d", "e", "f"]]]);
    expect(result.state.credits).toEqual([7, 9]);
    expect(result.events.map((event) => event.type)).toEqual([
      "shuttles_arrived",
      "supply_dealt",
      "turn_started",
    ]);
    const arrival = result.events[0];
    expect(arrival).toEqual({
      type: "shuttles_arrived",
      seat: 0,
      turn: 1,
      gains: [
        { seat: 0, delta: 3, credits: 7 },
        { seat: 1, delta: 1, credits: 9 },
      ],
    });
    expect(eventFor(arrival, null)).toMatchObject({
      gains: [
        { seat: 0, delta: 3, credits: 7 },
        { seat: 1, delta: 1, credits: 9 },
      ],
    });
    expect(result.state.supply).toEqual(["a", "b", "c", "d", "e"]);
    expect(result.state.deck).toEqual(["f"]);
    expect(result.events[1]).toEqual({
      type: "supply_dealt",
      cards: ["a", "b", "c", "d", "e"].map((instance) => ({ instance, cardId: "mod-rover-1" })),
    });
    expect(JSON.stringify(start)).toBe(before);
  });

  it("R4.7: a result set by the check prevents the deal and the next turn", () => {
    const start = fixture();
    const result = resolve(start, (state, frame) =>
      frame.kind === "shuttle_step"
        ? { state: { ...state, result: { reason: "victory", winners: [0], scores: [1, 0] } } }
        : { state },
    );
    expect(result.state.credits).toEqual([7, 9]);
    expect(result.state.supply).toEqual([]);
    expect(result.state.deck).toEqual(start.deck);
    expect(result.state.turn.number).toBe(1);
    expect(result.events.map((event) => event.type)).toEqual(["shuttles_arrived"]);
  });

  it("R4.7: remembers arrival even if the hook changes the Supply", () => {
    const result = resolve(fixture(), (state, frame) =>
      frame.kind === "shuttle_step"
        ? { state: { ...state, supply: ["f"], deck: state.deck.slice(0, -1) } }
        : { state },
    );
    expect(result.state.supply).toEqual(["f", "a", "b", "c", "d", "e"]);
  });

  it("R4.9: an Influence stays in the Supply and does not reduce the deal", () => {
    const result = resolve({ ...fixture(), supply: ["influence"] });
    expect(result.state.supply).toEqual(["influence", "a", "b", "c", "d", "e"]);
    expect(result.state.credits).toEqual([7, 9]);
  });

  it("R4.7, R10.4: a Supply of only two Influences lets the Shuttles arrive; the deal adds 3 + N beside them", () => {
    const start = { ...fixture(), supply: ["influence", "alliance"] };
    const result = resolve(start);
    expect(result.events.map((event) => event.type)).toEqual([
      "shuttles_arrived",
      "supply_dealt",
      "turn_started",
    ]);
    expect(result.state.credits).toEqual([7, 9]);
    // Two seats: 3 + 2 new cards, after the two Influences that stay.
    expect(result.state.supply).toEqual(["influence", "alliance", "a", "b", "c", "d", "e"]);
    expect(result.state.deck).toEqual(["f"]);
    expect(result.state.discard).toEqual([]);
  });

  it("R4.7, R10.4: an Agent beside the Influences keeps the Shuttles away", () => {
    const start = { ...fixture(), supply: ["influence", "agent", "alliance"] };
    const result = resolve(start);
    expect(result.events.map((event) => event.type)).toEqual(["turn_started"]);
    expect(result.state.supply).toEqual(start.supply);
    expect(result.state.credits).toEqual([4, 8]);
  });

  it("R8.7: deals two Deck cards, reshuffles four Discards, and deals three more deterministically", () => {
    const start = { ...fixture(), deck: ["a", "b"], discard: ["c", "d", "e", "f"] };
    const result = resolve(start);
    expect(result.state.supply.slice(0, 2)).toEqual(["a", "b"]);
    expect(result.state.supply).toHaveLength(5);
    expect(result.state.deck).toHaveLength(1);
    expect([...result.state.supply, ...result.state.deck].sort()).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
    ]);
    expect(result.state.discard).toEqual([]);
    expect(result.state.rng).not.toEqual(start.rng);
    expect(result.events.map((event) => event.type)).toEqual([
      "shuttles_arrived",
      "deck_reshuffled",
      "supply_dealt",
      "turn_started",
    ]);
    expect(result.events[1]).toEqual({ type: "deck_reshuffled", count: 4 });
    expect(resolve(start)).toEqual(result);
  });

  it.each([{ deck: [] }, { deck: ["a", "b"] }])(
    "R8.7: exhausts both piles and starts the next turn",
    ({ deck }) => {
      const start = { ...fixture(), deck };
      const result = resolve(start);
      expect(result.state.supply).toEqual(deck);
      expect(result.state.deck).toEqual([]);
      expect(result.state.rng).toEqual(start.rng);
      expect(result.state.turn).toMatchObject({ seat: 1, number: 2 });
      expect(result.state.pending?.kind).toBe("main_action");
      expect(result.events.filter((event) => event.type === "deck_reshuffled")).toEqual([]);
    },
  );

  it("R4.9: six seats receive nine cards", () => {
    const start = dealGame(
      { seats: 6, influences: false, kickstarter: false, startingSeat: 0 },
      "six",
    );
    const deck = [...start.supply, ...start.hands.flat(), ...start.deck];
    const result = resolve({ ...start, deck, supply: [], hands: start.hands.map(() => []) });
    expect(result.state.supply).toHaveLength(9);
    expect(result.state.supply).toEqual(deck.slice(0, 9));
  });
});
