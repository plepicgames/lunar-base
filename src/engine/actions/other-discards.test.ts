import { describe, expect, it } from "vitest";
import { type ActionDef } from "../catalogue.ts";
import { ask } from "../decisions.ts";
import { gameRegistry } from "../game.ts";
import { applyChoice, push, run, type Registry, type Resolved } from "../loop.ts";
import { dealGame } from "../setup.ts";
import type { GameState } from "../state.ts";
import { buildState } from "../testing/build.ts";
import { pushTurn } from "../turn.ts";
import { pushAction } from "./index.ts";

const BASE = { seats: 2, influences: false, kickstarter: false } as const;
const TARGET: ActionDef = { op: "target_discards", n: 1 };
const SABOTAGE: ActionDef = { op: "each_opponent_discards", n: 2 };

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

/**
 * One seat per hand, each hand written as catalogue ids: instances `h<seat><index>`.
 * Seat 0's Station shows Dark Side, `active` has the turn and every pile is empty.
 */
function game(hands: readonly (readonly string[])[], active = 0): GameState {
  const built = buildState(
    hands.map((_, seat) =>
      seat === 0 ? { station: "stn-dark-side", side: "named" } : { station: "stn-shackleton" },
    ),
  );
  const cards: Record<string, string> = { ...built.cards, s: "mod-inflatable-habitat" };
  const held = hands.map((hand, seat) =>
    hand.map((id, index) => {
      const key = `h${String(seat)}${String(index)}`;
      cards[key] = id;
      return key;
    }),
  );
  return {
    ...dealGame({ ...BASE, seats: hands.length, startingSeat: active }, "other-discards"),
    ...built,
    cards,
    hands: held,
    credits: hands.map(() => 10),
    deck: [],
    supply: [],
    discard: [],
    removedStations: [],
  };
}

const HABITAT = "mod-inflatable-habitat";
const three = [HABITAT, HABITAT, HABITAT];

function choose(state: GameState, option: string, rules = registry): Resolved {
  const pending = state.pending;
  if (!pending) throw new Error("Expected a decision");
  const result = applyChoice(state, { seat: pending.seat, decision: pending.id, option }, rules);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

/** `seat` performs the action above a `stop` frame. */
function perform(state: GameState, action: ActionDef, seat = 0): Resolved {
  return run(pushAction(push(state, "stop"), action, seat), registry);
}

function discards(events: Resolved["events"]) {
  return events.flatMap((event) =>
    event.type === "card_discarded" ? [[event.seat, event.card.instance]] : [],
  );
}

describe("R7.16 Target Discards", () => {
  it("Dark Side's box Build, Draft, Target Discards ends with the target discarding a card of their own choice", () => {
    const start = { ...game([[], [HABITAT, HABITAT], three]), supply: ["s"] };
    const before = structuredClone(start);
    const main = run(pushTurn(start), gameRegistry).state;
    const box = main.pending?.options.find(
      ({ label }) => label === "Dark Side: Build, Draft, Target Discards",
    );
    if (!box) throw new Error("Expected the Dark Side box");
    // Nothing to Build and one card to Draft: the first decision is the target (D9).
    const targeting = choose(main, box.id, gameRegistry);
    expect(targeting.events.map(({ type }) => type)).toEqual(["box_chosen", "card_drafted"]);
    expect(targeting.state.pending).toMatchObject({ seat: 0, kind: "target" });
    expect(targeting.state.pending?.options).toEqual([
      { id: "0", label: "Player 1 Discards", target: 0 },
      { id: "1", label: "Player 2 Discards", target: 1 },
      { id: "2", label: "Player 3 Discards", target: 2 },
    ]);

    // D5 is the target's: its own hand in hand order, and only it may answer.
    const asked = choose(targeting.state, "1", gameRegistry).state;
    expect(asked.pending).toMatchObject({ seat: 1, kind: "discard" });
    expect(asked.pending?.options.map(({ id }) => id)).toEqual(["h10", "h11"]);
    expect(asked.turn.seat).toBe(0);
    const decision = asked.pending?.id ?? "";
    expect(applyChoice(asked, { seat: 0, decision, option: "h11" }, gameRegistry)).toMatchObject({
      ok: false,
      error: { code: "wrong_seat" },
    });

    const done = choose(asked, "h11", gameRegistry);
    expect(discards(done.events)).toEqual([[1, "h11"]]);
    expect(done.state.hands).toEqual([["s"], ["h10"], ["h20", "h21", "h22"]]);
    expect(done.state.turn.seat).toBe(1);
    expect(start).toEqual(before);
  });

  it("lets the acting player be the target", () => {
    const asked = perform(game([three, three, three]), TARGET, 2).state;
    expect(asked.pending).toMatchObject({ seat: 2, kind: "target" });
    expect(asked.pending?.options.map(({ target }) => target)).toEqual([0, 1, 2]);
    const own = choose(asked, "2").state;
    expect(own.pending).toMatchObject({ seat: 2, kind: "discard" });
    const done = choose(own, "h21");
    expect(done.state.pending?.kind).toBe("finished");
    expect(discards(done.events)).toEqual([[2, "h21"]]);
    expect(done.state.hands[2]).toEqual(["h20", "h22"]);
    expect(done.state.discard).toEqual(["h21"]);
  });

  it("asks for a target between two players, and a target with an empty hand Discards nothing", () => {
    const asked = perform(game([three, []]), TARGET).state;
    expect(asked.pending?.options.map(({ target }) => target)).toEqual([0, 1]);
    const done = choose(asked, "1");
    expect(done.state.pending?.kind).toBe("finished");
    expect(done.events).toEqual([]);
    expect(done.state.hands).toEqual([["h00", "h01", "h02"], []]);
  });
});

describe("R7.16 Each opponent Discards", () => {
  it("R8.6: with 4 seats and seat 2 active, Saboteur asks seats 3, 0, 1 in that order, two Discards each", () => {
    const start = game([three, three, ["agt-saboteur"], three], 2);
    const agents = run(pushTurn(start), gameRegistry).state;
    expect(agents.pending).toMatchObject({ seat: 2, kind: "agent" });
    let current = choose(agents, "h20", gameRegistry);
    const askedSeats: number[] = [];
    const events = [...current.events];
    while (current.state.pending?.kind === "discard") {
      const { seat, options } = current.state.pending;
      askedSeats.push(seat);
      // Each chooses among their own cards (Q13); the active seat stays seat 2.
      expect(options.map(({ id }) => id)).toEqual(current.state.hands[seat]);
      expect(current.state.turn.seat).toBe(2);
      current = choose(current.state, options[1].id, gameRegistry);
      events.push(...current.events);
    }
    expect(askedSeats).toEqual([3, 3, 0, 0, 1, 1]);
    expect(discards(events)).toEqual([
      [3, "h31"],
      [3, "h32"],
      [0, "h01"],
      [0, "h02"],
      [1, "h11"],
      [1, "h12"],
    ]);
    expect(events.at(-1)).toMatchObject({ type: "agent_discarded", seat: 2 });
    expect(current.state.hands).toEqual([["h00"], ["h10"], [], ["h30"]]);
    expect(current.state.pending).toMatchObject({ seat: 2, kind: "main_action" });
  });

  it("an opponent with one card Discards it and the second Discard is skipped; an empty hand is skipped", () => {
    const start = game([three, [HABITAT], [], three]);
    const before = structuredClone(start);
    const first = perform(start, SABOTAGE);
    // Seat 1's only card needs no decision; seat 2 has none; seat 3 is asked.
    expect(discards(first.events)).toEqual([[1, "h10"]]);
    expect(first.state.pending).toMatchObject({ seat: 3, kind: "discard" });
    const second = choose(first.state, "h30");
    expect(second.state.pending).toMatchObject({ seat: 3, kind: "discard" });
    const replayed = choose(JSON.parse(JSON.stringify(second.state)) as GameState, "h32");
    const done = choose(second.state, "h32");
    expect(replayed).toEqual(done);
    expect(done.state.pending?.kind).toBe("finished");
    // The acting player keeps every card.
    expect(done.state.hands).toEqual([["h00", "h01", "h02"], [], [], ["h31"]]);
    expect(done.state.discard).toEqual(["h10", "h30", "h32"]);
    expect(start).toEqual(before);
  });

  it("with two players the one opponent Discards twice", () => {
    const first = perform(game([three, three]), SABOTAGE, 1);
    expect(first.state.pending).toMatchObject({ seat: 0, kind: "discard" });
    const done = choose(choose(first.state, "h00").state, "h01");
    expect(done.state.pending?.kind).toBe("finished");
    expect(done.state.hands).toEqual([["h02"], ["h10", "h11", "h12"]]);
  });
});
