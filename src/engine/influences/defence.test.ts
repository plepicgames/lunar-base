import { describe, expect, it } from "vitest";
import { cardById, type ActionDef } from "../catalogue.ts";
import { ask } from "../decisions.ts";
import { gameRegistry } from "../game.ts";
import { applyChoice, push, run, type Registry } from "../loop.ts";
import { dealGame } from "../setup.ts";
import type { GameState } from "../state.ts";
import { buildState } from "../testing/build.ts";
import { pushImmediate } from "./immediate.ts";

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

function fixture(hand: readonly string[] = ["alliance", "X"]): GameState {
  const built = buildState([
    { station: "stn-imbrium", side: "named" },
    { station: "stn-shackleton", modules: [["mod-satellite-1", 1, 0, 0]] },
    { station: "stn-shackleton" },
  ]);
  return {
    ...dealGame({ seats: 3, influences: true, kickstarter: false, startingSeat: 0 }, "defence"),
    ...built,
    cards: {
      ...built.cards,
      agent: "agt-panaman-broker",
      alliance: "inf-lunar-alliance",
      cascade: "inf-entropic-cascade",
      quarantine: "inf-quarantine",
      ...Object.fromEntries(
        ["X", "P", "Q", "R", "S", "sale1", "sale2", "sale3", "sale4"].map((id) => [
          id,
          "mod-inflatable-habitat",
        ]),
      ),
    },
    hands: [[], hand, []],
    credits: [5, 5, 5],
    play: ["agent"],
    deck: ["P", "Q", "R", "S"],
    discard: [],
    supply: ["sale1", "sale2", "sale3", "sale4"],
    stack: [],
    pending: null,
  };
}

function agent(start: GameState, actions: readonly ActionDef[], card = "agt-panaman-broker") {
  return run(
    push(push({ ...start, cards: { ...start.cards, agent: card } }, "stop"), "agent", {
      seat: 0,
      card: "agent",
      actions,
      position: 0,
      repeated: 0,
      deferred: [],
    }),
    registry,
  );
}

function choose(state: GameState, option: string) {
  const pending = state.pending;
  if (!pending) throw new Error("Expected decision");
  const result = applyChoice(state, { seat: pending.seat, decision: pending.id, option }, registry);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

const steal: ActionDef = { op: "steal_credits", n: 3 };
function targeted(start = fixture(), actions: readonly ActionDef[] = [steal]) {
  return choose(agent(start, actions).state, "1");
}

describe("R10.6 / R10.10 single-target Agent defence", () => {
  it("Panaman Broker asks after choosing the victim; defending discards the named Influence without moving Credits", () => {
    const start = fixture(["alliance", "quarantine", "X"]);
    const before = structuredClone(start);
    const played = agent(start, cardById("agt-panaman-broker").on_play ?? []);
    const target = choose(played.state, "1");
    expect(target.state.pending).toMatchObject({ kind: "target", seat: 0 });
    const waiting = choose(target.state, "1");
    expect(waiting.state.pending).toMatchObject({ kind: "defence", seat: 1 });
    expect(waiting.state.pending?.options.map(({ id }) => id)).toEqual([
      "decline",
      "alliance",
      "quarantine",
    ]);
    expect(waiting.state.credits).toEqual([5, 5, 5]);
    const done = choose(waiting.state, "quarantine");
    expect(done.state.pending?.kind).toBe("finished");
    expect(done.state.credits).toEqual([5, 5, 5]);
    expect(done.state.hands[1]).toEqual(["alliance", "X"]);
    expect(done.state.discard).toEqual(["quarantine", "agent"]);
    expect(done.events.some(({ type }) => type === "credits_stolen")).toBe(false);
    expect(start).toEqual(before);
    expect(choose(JSON.parse(JSON.stringify(waiting.state)) as GameState, "quarantine")).toEqual(
      done,
    );
  });

  it("decline performs the selected Steal and allows defence against the next action", () => {
    const waiting = targeted(fixture(), [steal, steal]);
    const declined = choose(waiting.state, "decline");
    expect(declined.state.credits).toEqual([8, 2, 5]);
    const next = choose(declined.state, "1");
    expect(next.state.pending).toMatchObject({ kind: "defence", seat: 1 });
    const defended = choose(next.state, "alliance");
    expect(defended.state.credits).toEqual([8, 2, 5]);
  });

  it("does not create a defence decision for a victim without an Influence", () => {
    const seen: string[] = [];
    const watching: Registry = {
      ...registry,
      afterStep: (state, frame) => {
        if (state.pending) seen.push(state.pending.kind);
        return registry.afterStep(state, frame);
      },
    };
    const start = agent(fixture(["X"]), [steal]).state;
    const pending = start.pending;
    if (!pending) throw new Error("Expected target decision");
    const done = applyChoice(start, { seat: 0, decision: pending.id, option: "1" }, watching);
    expect(done.ok && done.state.credits).toEqual([8, 2, 5]);
    expect(seen).not.toContain("defence");
  });

  it("Imbrium's Station box Steal offers no defence", () => {
    const start = fixture();
    const station = run(
      push(push(start, "stop"), "box", {
        source: start.bases[0].station.card,
        seat: 0,
        actions: cardById("stn-imbrium").main_action?.[1] ?? [],
        position: 0,
        repeated: 0,
        deferred: [],
      }),
      registry,
    );
    const done = choose(station.state, "1");
    expect(done.state.credits).toEqual([8, 2, 5]);
    expect(done.state.pending?.kind).toBe("finished");
    expect(done.state.hands[1]).toEqual(["alliance", "X"]);
  });

  it("Entropic Cascade finishes Draw 4, Discard 3 before the Agent's next action", () => {
    const waiting = targeted(fixture(["cascade", "X"]), [steal, { op: "draw", n: 1 }]);
    const effect = choose(waiting.state, "cascade");
    expect(effect.state.pending).toMatchObject({ kind: "discard", seat: 1 });
    expect(effect.state.hands).toEqual([[], ["X", "P", "Q", "R", "S"], []]);
    expect(effect.state.credits).toEqual([5, 5, 5]);
    expect(effect.state.stack.find(({ kind }) => kind === "agent")).toMatchObject({
      defenders: [1],
    });
    const one = choose(effect.state, "X");
    const two = choose(one.state, "P");
    expect(two.state.hands[0]).toEqual([]);
    const done = choose(two.state, "Q");
    expect(done.state.pending?.kind).toBe("finished");
    expect(done.state.hands[1]).toEqual(["R", "S"]);
    expect(done.state.hands[0]).toHaveLength(1);
    expect(done.events.map(({ type }) => type)).toEqual([
      "card_discarded",
      "deck_reshuffled",
      "card_drawn",
      "agent_discarded",
    ]);
  });

  it("Lunar Alliance in Supply prevents both the Steal and D12", () => {
    const start = { ...fixture(["cascade"]), supply: ["alliance"] };
    const done = agent(start, [steal]);
    expect(done.state.pending?.kind).toBe("finished");
    expect(done.state.credits).toEqual([5, 5, 5]);
    expect(done.events.map(({ type }) => type)).toEqual(["action_blocked", "agent_discarded"]);
  });

  it("Market Manipulator keeps the chosen opponent after defence; later Steal also skips that defender", () => {
    let next = agent(
      fixture(),
      cardById("agt-market-manipulator").on_play ?? [],
      "agt-market-manipulator",
    );
    next = choose(next.state, "sale1");
    next = choose(next.state, "sale2");
    const waiting = choose(next.state, "1");
    expect(waiting.state.pending).toMatchObject({ kind: "defence", seat: 1 });
    const defended = choose(waiting.state, "alliance");
    expect(defended.state.pending).toMatchObject({ kind: "target", seat: 0 });
    expect(defended.state.supply).toEqual(["sale3", "sale4"]);
    expect(defended.state.credits).toEqual([7, 5, 5]);
    const done = choose(defended.state, "1");
    expect(done.state.pending?.kind).toBe("finished");
    expect(done.state.credits).toEqual([7, 5, 5]);
    expect(done.events.some(({ type }) => type === "credits_stolen")).toBe(false);
  });

  it.each(["steal_module", "target_discards"] as const)(
    "defence cancels %s before any card moves",
    (op) => {
      const start = fixture();
      const action: ActionDef = op === "steal_module" ? { op, kind: "satellite" } : { op, n: 2 };
      const first = agent(start, [action]);
      const waiting = op === "steal_module" ? first : choose(first.state, "1");
      expect(waiting.state.pending).toMatchObject({ kind: "defence", seat: 1 });
      const done = choose(waiting.state, "alliance");
      expect(done.state.bases).toEqual(start.bases);
      expect(done.state.hands).toEqual([[], ["X"], []]);
      expect(done.state.pending?.kind).toBe("finished");
    },
  );

  it("a defended Spybot look reveals nothing, remembers its target, and skips that opponent's Discard", () => {
    const first = agent(fixture(), cardById("agt-spybot-py").on_play ?? [], "agt-spybot-py");
    const waiting = choose(first.state, "1");
    const defended = choose(waiting.state, "alliance");
    expect(defended.events.some(({ type }) => type === "hand_seen")).toBe(false);
    expect(defended.state.pending?.kind).toBe("choose_one");
    const done = choose(defended.state, "1");
    expect(done.state.hands[1]).toEqual(["X"]);
    expect(done.state.pending?.kind).toBe("finished");
  });

  it("E2: declining Look still allows defence before that opponent Discards", () => {
    const first = agent(fixture(), cardById("agt-spybot-py").on_play ?? [], "agt-spybot-py");
    const looked = choose(choose(first.state, "1").state, "decline");
    expect(looked.events.some(({ type }) => type === "hand_seen")).toBe(true);
    const waiting = choose(looked.state, "1");
    expect(waiting.state.pending).toMatchObject({ kind: "defence", seat: 1 });
    expect(choose(waiting.state, "alliance").state.hands[1]).toEqual(["X"]);
  });

  it.each([
    { action: { op: "target_discards", n: 1 }, hand: [], supply: ["sale1"] },
    { action: { op: "opponent_resells", n: 2 }, hand: ["cascade"], supply: ["alliance"] },
  ] as const)("skips defence for an impossible $action.op", ({ action, hand, supply }) => {
    const done = targeted({ ...fixture(hand), supply }, [action]);
    expect(done.state.pending?.kind).toBe("finished");
  });

  it("Steal from zero Credits still offers defence", () => {
    const waiting = targeted({ ...fixture(), credits: [5, 0, 5] });
    expect(waiting.state.pending).toMatchObject({ kind: "defence", seat: 1 });
  });

  it("an Influence's nested Steal is not an Agent action", () => {
    const waiting = agent(fixture(), [steal]);
    const interrupted = pushImmediate({ ...waiting.state, pending: null }, [
      { card: "cascade", seat: 0, actions: [steal] },
    ]);
    const nested = run(interrupted, registry);
    const done = choose(nested.state, "1");
    expect(done.events).toContainEqual({ type: "credits_stolen", thief: 0, victim: 1, amount: 3 });
  });
});

describe("T074 defence across players and Agent actions", () => {
  it("E1: Crazy President's owner can defend while every other Station Flips", () => {
    const start = { ...fixture([]), hands: [["alliance", "X"], [], []] };
    const waiting = agent(
      start,
      cardById("agt-crazy-president").on_play ?? [],
      "agt-crazy-president",
    );
    expect(waiting.state.pending).toMatchObject({ kind: "defence", seat: 0 });
    expect(waiting.state.bases).toEqual(start.bases);
    const done = choose(waiting.state, "alliance");
    expect(done.state.bases.map(({ station }) => station.side)).toEqual([
      "named",
      "named",
      "named",
    ]);
    expect(done.events.find(({ type }) => type === "station_flipped")).toMatchObject({
      flips: [{ seat: 1 }, { seat: 2 }],
    });
    expect(done.state.hands[0]).toEqual(["X"]);
  });

  it.each([
    { who: "any_one", option: "2", flipped: [] },
    { who: "any_two", option: "3", flipped: [0] },
    { who: "any_number", option: "7", flipped: [0, 2] },
    { who: "neighbours_of_target", option: "0", flipped: [2] },
  ] as const)(
    "$who keeps the selected Stations and excludes only the defender",
    ({ who, option, flipped }) => {
      const start = fixture();
      const selected = choose(agent(start, [{ op: "flip", who }]).state, option);
      expect(selected.state.pending).toMatchObject({ kind: "defence", seat: 1 });
      const done = choose(selected.state, "alliance");
      expect(done.state.pending?.kind).toBe("finished");
      expect(
        done.state.bases.flatMap((base, seat) =>
          base.station.side !== start.bases[seat].station.side ? [seat] : [],
        ),
      ).toEqual(flipped);
    },
  );

  it("Investor does not replace a defended Station with another target", () => {
    const first = agent(fixture(), cardById("agt-investor").on_play ?? [], "agt-investor");
    const resold = choose(first.state, "sale1");
    const waiting = choose(resold.state, "2");
    expect(waiting.state.pending?.kind).toBe("defence");
    const done = choose(waiting.state, "alliance");
    expect(done.state.bases).toEqual(first.state.bases);
    expect(done.state.pending?.kind).toBe("finished");
    expect(done.state.credits[0]).toBe(6);
  });

  it("Saboteur asks clockwise across four seats before any forced Discard", () => {
    const start = fixture();
    const four: GameState = {
      ...start,
      config: { ...start.config, seats: 4 },
      cards: {
        ...start.cards,
        station4: "stn-shackleton",
        embargo: "inf-terran-embargo",
        Y: "mod-inflatable-habitat",
        Z: "mod-inflatable-habitat",
      },
      bases: [
        ...start.bases,
        { station: { card: "station4", side: "terran_outpost", revealed: false }, modules: [] },
      ],
      hands: [[], ["alliance", "X", "Y"], ["quarantine", "Z"], ["embargo", "P", "Q"]],
      deck: ["R", "S"],
      credits: [5, 5, 5, 5],
      turn: { ...start.turn, seat: 2 },
    };
    let next = agent(four, cardById("agt-saboteur").on_play ?? [], "agt-saboteur");
    expect(next.state.pending).toMatchObject({ kind: "defence", seat: 2 });
    next = choose(next.state, "quarantine");
    expect(next.state.pending).toMatchObject({ kind: "defence", seat: 3 });
    next = choose(next.state, "decline");
    expect(next.state.pending).toMatchObject({ kind: "defence", seat: 1 });
    expect(next.state.hands[3]).toEqual(["embargo", "P", "Q"]);
    expect(next.state.hands[1]).toEqual(["alliance", "X", "Y"]);
    next = choose(next.state, "decline");
    expect(next.state.pending).toMatchObject({ kind: "discard", seat: 3 });
    next = choose(next.state, "P");
    expect(next.state.pending).toMatchObject({ kind: "discard", seat: 3 });
    next = choose(next.state, "Q");
    expect(next.state.pending).toMatchObject({ kind: "discard", seat: 1 });
    next = choose(next.state, "X");
    next = choose(next.state, "Y");
    expect(next.state.pending?.kind).toBe("finished");
    expect(next.state.hands).toEqual([[], ["alliance"], ["Z"], ["embargo"]]);
  });

  it("own Discard defence skips that Discard and later own Flips without cancelling other players' Flips", () => {
    const start = { ...fixture([]), hands: [["alliance", "X"], [], []] };
    const first = agent(start, cardById("agt-rebel-captain").on_play ?? [], "agt-rebel-captain");
    const waiting = choose(first.state, "1");
    expect(waiting.state.pending).toMatchObject({ kind: "defence", seat: 0 });
    const defended = choose(waiting.state, "alliance");
    expect(defended.state.pending?.kind).toBe("flip");
    const done = choose(defended.state, "3");
    expect(done.state.hands[0]).toEqual(["X"]);
    expect(done.state.bases.map(({ station }) => station.side)).toEqual([
      "named",
      "named",
      "terran_outpost",
    ]);
  });

  it("own repeated Discard offers one chance, but a separate later Discard offers another", () => {
    const start = {
      ...fixture([]),
      hands: [["alliance", "X", "P", "Q"], [], []],
      deck: ["R", "S"],
    };
    let next = agent(start, [
      { op: "discard", n: 2 },
      { op: "discard", n: 1 },
    ]);
    expect(next.state.pending?.kind).toBe("defence");
    next = choose(next.state, "decline");
    next = choose(next.state, "X");
    expect(next.state.pending?.kind).toBe("discard");
    next = choose(next.state, "P");
    expect(next.state.pending?.kind).toBe("defence");
    next = choose(next.state, "alliance");
    expect(next.state.hands[0]).toEqual(["Q"]);
  });

  it("an immediate Influence finishes before the next defence and resumes after JSON serialization", () => {
    const start = { ...fixture(["alliance", "X"]), hands: [["cascade"], ["alliance", "X"], []] };
    const waiting = agent(start, [{ op: "flip", who: "each_player" }]);
    expect(waiting.state.pending).toMatchObject({ kind: "defence", seat: 0 });
    let next = choose(waiting.state, "cascade");
    expect(next.state.pending).toMatchObject({ kind: "discard", seat: 0 });
    next = choose(next.state, "P");
    next = choose(next.state, "Q");
    next = choose(next.state, "R");
    expect(next.state.pending).toMatchObject({ kind: "defence", seat: 1 });
    expect(next.state.bases).toEqual(start.bases);
    const restored = JSON.parse(JSON.stringify(next.state)) as GameState;
    const done = choose(restored, "decline");
    expect(done).toEqual(choose(next.state, "decline"));
    expect(done.state.bases.map(({ station }) => station.side)).toEqual([
      "named",
      "named",
      "named",
    ]);
  });

  it("Q34: a defended Look still allows Draw and reveals no hand cards", () => {
    const first = agent(fixture(), cardById("agt-spybot-py").on_play ?? [], "agt-spybot-py");
    const defended = choose(choose(first.state, "1").state, "alliance");
    expect(defended.events.some(({ type }) => type === "hand_seen")).toBe(false);
    const done = choose(defended.state, "0");
    expect(done.state.hands[0]).toEqual(["P"]);
    expect(done.state.hands[1]).toEqual(["X"]);
    expect(done.state.pending?.kind).toBe("finished");
  });
});
