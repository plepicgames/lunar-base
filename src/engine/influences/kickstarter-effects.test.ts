import { describe, expect, it } from "vitest";
import { pushAction } from "../actions/index.ts";
import { ask } from "../decisions.ts";
import { eventFor } from "../events.ts";
import { gameRegistry } from "../game.ts";
import { applyChoice, push, run, type Registry } from "../loop.ts";
import { dealGame } from "../setup.ts";
import type { GameState } from "../state.ts";
import { buildState } from "../testing/build.ts";
import { pushTurn } from "../turn.ts";
import { viewFor } from "../view.ts";
import { affectedBy } from "./defence.ts";

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

function fixture(supply: readonly string[], seats = 3): GameState {
  const bases = buildState(
    Array.from({ length: seats }, (_, seat) => ({
      station: "stn-shackleton",
      side: seat === 0 ? ("named" as const) : ("terran_outpost" as const),
      modules: [["mod-inflatable-habitat", -1, 0, 0] as const],
    })),
  );
  return {
    ...dealGame({ seats, influences: true, kickstarter: true, startingSeat: 0 }, "ks-effects"),
    ...bases,
    cards: {
      ...bases.cards,
      cops: "ks-inf-moonstone-cops",
      reform: "ks-inf-credit-reform",
      meta: "ks-inf-metamorphosis",
      blood: "ks-inf-blood-moon",
      influence: "inf-terran-embargo",
      solicitor: "agt-solicitor",
      spy: "agt-spybot-py",
      module: "mod-bacon-printer",
      filler: "mod-rover-1",
      waitingSpy: "agt-spybot-py",
    },
    hands: Array.from({ length: seats }, () => []),
    credits: Array.from({ length: seats }, () => 0),
    supply,
    deck: [],
    discard: [],
    removedStations: [],
  };
}

function choose(state: GameState, option: string, rules = registry) {
  const pending = state.pending;
  if (!pending) throw new Error("Expected decision");
  const result = applyChoice(state, { seat: pending.seat, decision: pending.id, option }, rules);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

function draft(start: GameState, card: string, seat = 1) {
  const asked = run(pushAction(push(start, "stop"), { op: "draft", n: 1 }, seat), registry);
  return choose(asked.state, card);
}

describe("R12.9 Moonstone Cops", () => {
  it("Solicitor's Steal moves no Module and asks neither target nor defence", () => {
    const base = fixture(["cops"]);
    const start = { ...base, credits: [10, 0, 0], hands: [["solicitor"], ["influence"], []] };
    const agent = choose(run(pushTurn(start), gameRegistry).state, "solicitor", gameRegistry);
    const option = agent.state.pending?.options.find(
      ({ label }) => label === "Steal Module: Inflatable Habitat",
    );
    if (!option) throw new Error("Expected Solicitor option");
    const done = choose(agent.state, option.id, gameRegistry);
    expect(done.state.bases).toEqual(start.bases);
    expect(done.state.hands).toEqual([[], ["influence"], []]);
    expect(done.state.pending?.kind).toBe("main_action");
    expect(done.events).toContainEqual({
      type: "action_blocked",
      seat: 0,
      action: "steal_module",
      card: { instance: "cops", cardId: "ks-inf-moonstone-cops" },
    });
    const blocked = done.events.find(({ type }) => type === "action_blocked");
    if (!blocked) throw new Error("Expected blocked theft");
    for (const audience of [0, 1, 2, null]) {
      expect(eventFor(blocked, audience)?.text).toContain("Steal Module");
    }
    expect(
      affectedBy(
        { op: "steal_module", kind: "inflatable_habitat" },
        { seat: 0, target: 1, card: "c4" },
        start,
      ),
    ).toEqual([]);
    const unblocked = { ...start, supply: [], hands: [["cops"], ["influence"], []] };
    expect(
      affectedBy(
        { op: "steal_module", kind: "inflatable_habitat" },
        { seat: 0, target: 1, card: "c4" },
        unblocked,
      ),
    ).toEqual([1]);
    const steal = run(
      pushAction(push(unblocked, "stop"), { op: "steal_module", kind: "inflatable_habitat" }, 0),
      registry,
    );
    expect(choose(steal.state, "c4").state.hands[0]).toEqual(["cops", "c4"]);
  });
});

describe("R12.10 Credit Reform", () => {
  it.each(["reform", "influence"])("Drafting %s clamps every balance at zero", (card) => {
    const start = { ...fixture(["reform", "influence", "module"]), credits: [5, 2, 0] };
    const done = draft(start, card);
    expect(done.state.credits).toEqual([2, 0, 0]);
    expect(done.state.hands[1]).toEqual([card]);
    expect(done.events.filter(({ type }) => type === "credits_lost")).toEqual([
      {
        type: "credits_lost",
        losses: [
          { seat: 0, delta: -3, credits: 2 },
          { seat: 1, delta: -2, credits: 0 },
          { seat: 2, delta: 0, credits: 0 },
        ],
      },
    ]);
    expect(draft(start, "module").state.credits).toEqual([5, 2, 0]);
  });
});

describe("R12.4 Metamorphosis", () => {
  it.each(["meta", "influence"])(
    "Drafting %s swaps the drafter's neighbours and preserves sides and Modules",
    (card) => {
      const start = fixture(["meta", "influence", "module"], 4);
      const before = structuredClone(start);
      const done = draft(start, card);
      expect(done.state.bases.map(({ station }) => station)).toEqual([
        start.bases[2].station,
        start.bases[1].station,
        start.bases[0].station,
        start.bases[3].station,
      ]);
      expect(done.state.bases.map(({ modules }) => modules)).toEqual(
        start.bases.map(({ modules }) => modules),
      );
      expect(done.events).toContainEqual({ type: "stations_exchanged", seats: [0, 2] });
      expect(done.state.pending?.kind).toBe("finished");
      expect(start).toEqual(before);
    },
  );

  it("wraps neighbours around the table and does nothing with two seats", () => {
    const four = fixture(["meta", "module"], 4);
    const wrapped = draft(four, "meta", 0);
    expect(wrapped.state.bases[3].station).toEqual(four.bases[1].station);
    expect(wrapped.state.bases[1].station).toEqual(four.bases[3].station);
    const two = fixture(["meta", "module"], 2);
    const done = draft(two, "meta");
    expect(done.state.bases).toEqual(two.bases);
    expect(done.events.map(({ type }) => type)).toEqual(["card_drafted"]);
  });
});

describe("R12.5 Blood Moon", () => {
  it.each(["blood", "influence"])(
    "Drafting %s privately looks, then lets the opponent order only Agent discards without defence",
    (card) => {
      const start = {
        ...fixture(["blood", "influence", "filler"]),
        hands: [["solicitor", "module", "spy", "cops"], [], []],
      };
      const drafted = draft(start, card);
      expect(drafted.state.pending).toMatchObject({ seat: 1, kind: "target" });
      const looked = choose(drafted.state, "0");
      const event = looked.events.find(({ type }) => type === "hand_seen");
      if (!event) throw new Error("Expected private Look");
      const cards = [
        { instance: "solicitor", cardId: "agt-solicitor" },
        { instance: "module", cardId: "mod-bacon-printer" },
        { instance: "spy", cardId: "agt-spybot-py" },
        { instance: "cops", cardId: "ks-inf-moonstone-cops" },
      ];
      expect(eventFor(event, 1)).toMatchObject({
        type: "hand_seen",
        looker: 1,
        opponent: 0,
        cards,
      });
      for (const audience of [0, 2, null])
        expect(eventFor(event, audience)).not.toHaveProperty("cards");
      expect(viewFor(looked.state, 1).hand).toEqual([
        { instance: card, cardId: start.cards[card] },
      ]);
      expect(looked.state.pending).toMatchObject({ seat: 0, kind: "discard" });
      expect(looked.state.pending?.options.map(({ id }) => id)).toEqual(["solicitor", "spy"]);
      const done = choose(looked.state, "spy");
      expect(done.state.discard).toEqual(["spy", "solicitor"]);
      expect(done.state.hands[0]).toEqual(["module", "cops"]);
      expect(done.state.pending?.kind).toBe("finished");
      expect(choose(JSON.parse(JSON.stringify(looked.state)) as GameState, "spy")).toEqual(done);
    },
  );

  it.each([{ hand: [] }, { hand: ["module", "cops"] }])(
    "looks at a sole opponent with no Agents and leaves their hand intact: $hand",
    ({ hand }) => {
      const start = { ...fixture(["blood", "filler"], 2), hands: [hand, []] };
      const done = draft(start, "blood");
      expect(done.events.some(({ type }) => type === "hand_seen")).toBe(true);
      expect(done.state.hands[0]).toEqual(hand);
      expect(done.state.discard).toEqual([]);
      expect(done.state.pending?.kind).toBe("finished");
    },
  );

  it("keeps an interrupted Agent's remembered opponent and skips its defence context", () => {
    const start = {
      ...fixture(["blood", "module"]),
      hands: [["solicitor", "spy", "cops"], [], []],
      play: ["waitingSpy"],
    };
    const waiting = push(push(start, "stop"), "agent", {
      card: "waitingSpy",
      seat: 1,
      opponent: 2,
      actions: [],
      position: 0,
      repeated: 0,
      deferred: [],
    });
    const asked = run(pushAction(waiting, { op: "draft", n: 1 }, 1), registry);
    const looked = choose(choose(asked.state, "blood").state, "0");
    expect(looked.state.pending).toMatchObject({ seat: 0, kind: "discard" });
    expect(looked.state.stack.find(({ kind }) => kind === "agent")?.opponent).toBe(2);
  });
});

describe("R10.9 Kickstarter triggers together", () => {
  it("the active seat orders all three texts while the drafter resolves each exactly once", () => {
    const start = {
      ...fixture(["blood", "meta", "reform", "filler"], 4),
      hands: [["solicitor", "spy", "cops"], [], [], []],
      credits: [5, 2, 0, 4],
    };
    const drafted = draft(start, "reform");
    expect(drafted.state.hands[1]).toEqual(["reform"]);
    expect(drafted.state.pending).toMatchObject({ seat: 0, kind: "order" });
    expect(drafted.state.pending?.options.map(({ card }) => card)).toEqual([
      "blood",
      "meta",
      "reform",
    ]);
    const exchanged = choose(drafted.state, "1");
    expect(exchanged.state.pending).toMatchObject({ seat: 0, kind: "order" });
    expect(exchanged.events).toEqual([{ type: "stations_exchanged", seats: [0, 2] }]);
    const targeting = choose(exchanged.state, "0");
    expect(targeting.state.pending).toMatchObject({ seat: 1, kind: "target" });
    const looked = choose(targeting.state, "0");
    expect(looked.state.pending).toMatchObject({ seat: 0, kind: "discard" });
    const done = choose(looked.state, "spy");
    expect(done.state.credits).toEqual([2, 0, 0, 1]);
    expect(done.state.discard).toEqual(["spy", "solicitor"]);
    expect(done.state.pending?.kind).toBe("finished");
    expect(
      [
        ...drafted.events,
        ...exchanged.events,
        ...targeting.events,
        ...looked.events,
        ...done.events,
      ].map(({ type }) => type),
    ).toEqual([
      "card_drafted",
      "stations_exchanged",
      "hand_seen",
      "card_discarded",
      "card_discarded",
      "credits_lost",
    ]);
  });

  it("none of the three texts triggers for a Module Draft or an Influence Draw", () => {
    const start = { ...fixture(["blood", "meta", "reform", "module"]), credits: [5, 2, 0] };
    const drafted = draft(start, "module");
    expect(drafted.events.map(({ type }) => type)).toEqual(["card_drafted"]);
    expect(drafted.state.bases).toEqual(start.bases);
    expect(drafted.state.credits).toEqual(start.credits);
    const drawn = run(
      pushAction(push({ ...start, deck: ["influence"] }, "stop"), { op: "draw", n: 1 }, 1),
      registry,
    );
    expect(drawn.events.map(({ type }) => type)).toEqual(["card_drawn"]);
    expect(drawn.state.pending?.kind).toBe("finished");
  });
});
