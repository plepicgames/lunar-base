import { describe, expect, it } from "vitest";
import { cardById, type ActionDef } from "../catalogue.ts";
import { ask } from "../decisions.ts";
import { eventFor } from "../events.ts";
import { applyChoice, push, run, type Registry, type Resolved } from "../loop.ts";
import { dealGame } from "../setup.ts";
import type { GameState } from "../state.ts";
import { pushTurn, turnHandlers } from "../turn.ts";
import { actionHandlers, handlerOf, pushAction, type ActionFrame } from "./index.ts";

const dealt = dealGame(
  { seats: 2, startingSeat: 0, influences: false, kickstarter: false },
  "choice-credits",
);
const registry: Registry = {
  handlers: {
    ...turnHandlers(actionHandlers),
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
  afterStep: (state) => ({ state }),
};

function choose(state: GameState, option: string, rules = registry): Resolved {
  const pending = state.pending;
  if (!pending) throw new Error("Expected a decision");
  const result = applyChoice(state, { seat: pending.seat, decision: pending.id, option }, rules);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

function text(state: GameState, actions: readonly ActionDef[], seat = 1): GameState {
  return push(push(state, "stop"), "box", {
    seat,
    actions,
    position: 0,
    repeated: 0,
    deferred: [],
  });
}

function step(state: GameState, action: ActionDef, seat = 1) {
  const started = pushAction(state, action, seat);
  return handlerOf(actionHandlers, action)(started, started.stack.at(-1) as ActionFrame, null);
}

const choice: ActionDef = {
  op: "choose_one",
  options: [[{ op: "draw", n: 2 }], [{ op: "discard", n: 1 }], [{ op: "resell", n: 1 }]],
};

describe("R8.2 choose one / D3", () => {
  it("lists every printed option in order for the acting seat and resolves only the chosen option", () => {
    const start = text(dealt, [choice, { op: "draw", n: 1 }]);
    const before = structuredClone(start);
    const asked = run(start, registry);
    expect(asked.state.pending).toStrictEqual({
      id: "d1",
      seat: 1,
      kind: "choose_one",
      options: [
        { id: "0", label: "Draw x2" },
        { id: "1", label: "Discard" },
        { id: "2", label: "Resell" },
      ],
    });
    const done = choose(asked.state, "0");
    expect(done.state.pending?.kind).toBe("finished");
    expect(done.state.hands[1]).toEqual([...dealt.hands[1], ...dealt.deck.slice(0, 3)]);
    expect(done.state.supply).toEqual(dealt.supply);
    expect(done.state.discard).toEqual(dealt.discard);
    expect(done.events.map((event) => event.type)).toEqual(Array(3).fill("card_drawn"));
    expect(start).toEqual(before);
    expect(choose(JSON.parse(JSON.stringify(asked.state)) as GameState, "0")).toEqual(done);
    expect(
      applyChoice(asked.state, { decision: "d1", seat: 1, option: "9" }, registry),
    ).toMatchObject({ ok: false, error: { code: "unknown_option" } });
  });

  it("allows a printed option that does nothing, without resolving another option", () => {
    const empty = { ...dealt, hands: [dealt.hands[0], []] };
    const asked = run(text(empty, [choice]), registry);
    const done = choose(asked.state, "1");
    expect(done.events).toEqual([]);
    for (const key of ["hands", "supply", "deck", "discard", "credits", "rng"] as const) {
      expect(done.state[key]).toEqual(empty[key]);
    }
    expect(done.state.pending?.kind).toBe("finished");
  });

  it("resolves a non-first multi-action option left to right, including another choice", () => {
    const actions: ActionDef[] = [
      {
        op: "choose_one",
        options: [
          [{ op: "draw", n: 2 }],
          [
            { op: "draw", n: 1 },
            {
              op: "choose_one",
              options: [[{ op: "draw", n: 1 }], [{ op: "gain_credit_per_hand_card" }]],
            },
          ],
        ],
      },
    ];
    const first = run(text(dealt, actions), registry);
    const second = choose(first.state, "1");
    expect(second.events.map((event) => event.type)).toEqual(["card_drawn"]);
    expect(second.state.pending).toMatchObject({ kind: "choose_one", seat: 1 });
    const done = choose(second.state, "1");
    expect(done.events).toEqual([
      {
        type: "credits_changed",
        seat: 1,
        delta: dealt.hands[1].length + 1,
        credits: dealt.credits[1] + dealt.hands[1].length + 1,
      },
    ]);
  });
});

describe("Credit actions", () => {
  it("R7.11: Space Unicorn Draws before counting its hand, excluding the Agent in play", () => {
    const state = {
      ...dealt,
      cards: { ...dealt.cards, unicorn: "agt-space-unicorn" },
      hands: [["unicorn", ...dealt.hands[0]], dealt.hands[1]],
      credits: [8, 2],
    };
    const started = run(pushTurn(state), registry);
    const done = choose(started.state, "unicorn");
    const gained = dealt.hands[0].length + 1;
    expect(done.events.map((event) => event.type)).toEqual([
      "credits_changed",
      "agent_played",
      "card_drawn",
      "credits_changed",
      "agent_discarded",
    ]);
    expect(done.events[3]).toEqual({
      type: "credits_changed",
      seat: 0,
      delta: gained,
      credits: 4 + gained,
    });
    expect(done.state.hands[0]).toEqual([...dealt.hands[0], dealt.deck[0]]);
    expect(done.state.credits).toEqual([4 + gained, 2]);
  });

  it("R7.11: an empty hand gains nothing and mutates no input", () => {
    const state = { ...dealt, hands: [dealt.hands[0], []] };
    const before = structuredClone(state);
    const done = step(state, { op: "gain_credit_per_hand_card" });
    expect(done.state.credits).toEqual(state.credits);
    expect(done.events ?? []).toEqual([]);
    expect(state).toEqual(before);
  });

  it.each([
    [0, 2],
    [0, 0],
    [1, 2, 3, 0, 8, 1],
  ])(
    "R7.12: loses Credits in one step and one public event, clamped to zero (%j)",
    (...balances) => {
      const state = { ...dealt, credits: balances };
      const before = structuredClone(state);
      const done = step(state, { op: "each_player_loses_credits", n: 1 });
      const losses = balances.map((old, seat) => ({
        seat,
        delta: -Math.min(old, 1) || 0,
        credits: Math.max(0, old - 1),
      }));
      expect(done.state.credits).toEqual(losses.map((loss) => loss.credits));
      expect(done.state.stack).toEqual([]);
      expect(done.events).toEqual([{ type: "credits_lost", losses }]);
      expect(state).toEqual(before);
      const event = done.events?.[0];
      if (!event) throw new Error("Expected the loss event");
      for (const seat of [null, 0, 1]) {
        expect(eventFor(event, seat)).toMatchObject({ type: "credits_lost", losses });
      }
    },
  );

  it("R8.5: the after-step hook sees all players' losses together, with n as an amount", () => {
    const seen: number[][] = [];
    const rules: Registry = {
      ...registry,
      afterStep: (state, frame) => {
        if (frame.kind === "action") seen.push([...state.credits]);
        return { state };
      },
    };
    const done = run(
      text({ ...dealt, credits: [2, 5] }, [{ op: "each_player_loses_credits", n: 3 }]),
      rules,
    );
    expect(seen).toEqual([[0, 2]]);
    expect(done.events).toHaveLength(1);
  });
});

it("R8.10: Lang Huan's loss precedes its deferred Borehole Draw 2, then Fusion Reactor's Draw", () => {
  const state: GameState = {
    ...dealt,
    cards: {
      ...dealt.cards,
      reactor: "mod-fusion-reactor",
      concrete: "mod-lang-huan-concrete",
      borehole: "mod-experimental-borehole",
    },
    hands: [["concrete", "borehole"], dealt.hands[1]],
    bases: [
      { ...dealt.bases[0], modules: [{ card: "reactor", x: 0, y: -2, q: 0 }] },
      dealt.bases[1],
    ],
    credits: [0, 2],
  };
  const main = run(pushTurn(state), registry).state;
  const option = main.pending?.options.find(
    (item) => item.label === "Fusion Reactor: Build, Draw, Discard",
  );
  if (!option) throw new Error("Expected Fusion Reactor box");
  const build = (state: GameState, card: string) => {
    const placement = state.pending?.options.find((item) => item.card === card);
    if (!placement) throw new Error(`Expected a Build for ${card}`);
    return choose(state, placement.id);
  };
  const outer = build(choose(main, option.id).state, "concrete").state;
  expect(outer.pending?.kind).toBe("defer");
  const inner = build(choose(outer, "now").state, "borehole").state;
  expect(inner.pending?.kind).toBe("defer");
  const draws: string[] = [];
  const rules: Registry = {
    ...registry,
    afterStep: (state, frame) => {
      if (frame.kind === "action" && (frame.action as ActionDef).op === "draw") {
        const holder = state.stack.at(-1);
        draws.push(typeof holder?.card === "string" ? holder.card : (holder?.kind ?? "missing"));
      }
      return { state };
    },
  };
  const done = choose(inner, "later", rules);
  expect(done.events.map((event) => event.type)).toEqual([
    "text_deferred",
    "credits_lost",
    "card_drawn",
    "card_drawn",
    "card_drawn",
  ]);
  expect(draws).toEqual(["borehole", "borehole", "box"]);
  expect(done.state.credits).toEqual([0, 1]);
  expect(done.state.hands[0]).toEqual(state.deck.slice(0, 3));
  expect(done.state.pending?.kind).toBe("discard");
  expect(cardById(state.cards.concrete).on_play).toEqual([
    { op: "build", n: 1 },
    { op: "each_player_loses_credits", n: 1 },
  ]);
});
