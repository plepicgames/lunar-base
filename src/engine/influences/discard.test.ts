import { describe, expect, it } from "vitest";
import { pushOnPlay } from "../actions/build.ts";
import { pushAction } from "../actions/index.ts";
import { cardById } from "../catalogue.ts";
import { ask } from "../decisions.ts";
import type { GameEvent } from "../events.ts";
import { gameRegistry } from "../game.ts";
import { applyChoice, push, run, STEP_BUDGET, type Registry } from "../loop.ts";
import { dealGame } from "../setup.ts";
import type { GameState } from "../state.ts";
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

function fixture(
  hand: readonly string[],
  deck: readonly string[] = ["P", "Q", "R", "S"],
): GameState {
  const dealt = dealGame(
    { seats: 3, influences: true, kickstarter: false, startingSeat: 0 },
    "influence-discard",
  );
  return {
    ...dealt,
    cards: {
      ...dealt.cards,
      ...Object.fromEntries([...hand, ...deck].map((id) => [id, "mod-inflatable-habitat"])),
      cascade: "inf-entropic-cascade",
      cascade2: "inf-entropic-cascade",
      crackdown: "inf-terran-crackdown",
      laika: "mod-laika-memorial",
      bacon: "mod-bacon-printer",
      alliance: "inf-lunar-alliance",
    },
    hands: [hand, [], []],
    deck,
    discard: [],
    supply: [],
  };
}

function choose(state: GameState, option: string, using = registry) {
  const pending = state.pending;
  if (!pending) throw new Error("Expected decision");
  const result = applyChoice(state, { seat: pending.seat, decision: pending.id, option }, using);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

function discards(events: readonly GameEvent[]): string[] {
  return events.flatMap((event) => (event.type === "card_discarded" ? [event.card.instance] : []));
}

describe("R10.7: immediate Influence Discard text", () => {
  it.each(["cascade", "crackdown"])(
    "D13: the active player orders simultaneous effects, starting with %s",
    (first) => {
      const base = fixture([]);
      const start = {
        ...base,
        bases: base.bases.map((b) => ({ ...b, station: { ...b.station, side: "named" as const } })),
      };
      const effects = ["cascade", "crackdown"].map((card) => ({
        card,
        seat: 1,
        actions: cardById(start.cards[card]).on_discard ?? [],
      }));
      const asked = run(pushImmediate(push(start, "stop"), effects), registry);
      expect(asked.state.pending).toMatchObject({ seat: 0, kind: "order" });
      expect(asked.state.pending?.options.map(({ card }) => card)).toEqual([
        "cascade",
        "crackdown",
      ]);
      const option = asked.state.pending?.options.find(({ card }) => card === first);
      if (!option) throw new Error("Expected immediate effect option");
      const selected = choose(asked.state, option.id);
      expect(selected.state.pending).toMatchObject({ seat: 1, kind: "discard" });
      expect(selected.state.hands[1]).toEqual(["P", "Q", "R", "S"]);
      expect(selected.events.map(({ type }) => type)).toEqual([
        ...(first === "crackdown" ? ["station_flipped"] : []),
        "card_drawn",
        "card_drawn",
        "card_drawn",
        "card_drawn",
      ]);
      let done = selected;
      for (const card of ["P", "Q", "R"]) done = choose(done.state, card);
      expect(done.state.pending?.kind).toBe("finished");
      expect(done.events.map(({ type }) => type)).toEqual([
        "card_discarded",
        ...(first === "cascade" ? ["station_flipped"] : []),
      ]);
      expect(done.state.bases.every(({ station }) => station.side === "terran_outpost")).toBe(true);
    },
  );

  it("interrupts Bacon Printer's Draw, Discard before the waiting action resumes", () => {
    const start = fixture(["cascade", "X"], ["B", "P", "Q", "R", "S", "after"]);
    const before = structuredClone(start);
    const waiting = pushAction(push(start, "stop"), { op: "draw", n: 1 }, 0);
    const bacon = run(pushOnPlay(waiting, 0, "bacon"), registry);
    expect(bacon.state.hands[0]).toEqual(["cascade", "X", "B"]);
    const effect = choose(bacon.state, "cascade");
    expect(effect.events.map(({ type }) => type)).toEqual([
      "card_discarded",
      "card_drawn",
      "card_drawn",
      "card_drawn",
      "card_drawn",
    ]);
    expect(effect.state.pending?.kind).toBe("discard");
    expect(effect.state.hands[0]).toEqual(["X", "B", "P", "Q", "R", "S"]);
    const one = choose(effect.state, "X");
    const two = choose(one.state, "B");
    expect(two.state.deck).toEqual(["after"]);
    const done = choose(two.state, "P");
    expect(done.events.map(({ type }) => type)).toEqual(["card_discarded", "card_drawn"]);
    expect(done.state.hands[0]).toEqual(["Q", "R", "S", "after"]);
    expect(done.state.pending?.kind).toBe("finished");
    expect(start).toEqual(before);
  });

  it.each([
    { choices: ["X", "Y", "P"], kept: ["Q", "R", "S"], tail: ["P"] },
    { choices: ["P", "Q", "R", "X"], kept: ["S"], tail: ["X", "Y"] },
  ])("E3: building Laika Memorial keeps $kept", ({ choices, kept, tail }) => {
    const start = fixture(["laika", "cascade", "X", "Y"]);
    const building = run(pushAction(push(start, "stop"), { op: "build", n: 1 }, 0), registry);
    const option = building.state.pending?.options.find(({ card }) => card === "laika");
    if (!option) throw new Error("Expected Laika Build");
    const built = choose(building.state, option.id);
    expect(built.state.bases[0].modules.map(({ card }) => card)).toEqual(["laika"]);
    let next = choose(built.state, "cascade");
    expect(next.state.hands[0]).toEqual(["X", "Y", "P", "Q", "R", "S"]);
    for (const card of choices) next = choose(next.state, card);
    expect(discards(next.events)).toEqual(tail);
    expect(next.state.hands[0]).toEqual(kept);
    expect(next.state.pending?.kind).toBe("finished");
  });

  it("resolves for the opponent who Discards, not the active player", () => {
    const start = { ...fixture(["cascade", "X"]), hands: [[], ["cascade", "X"], []] };
    const target = run(
      pushAction(push(start, "stop"), { op: "target_discards", n: 1 }, 0),
      registry,
    );
    const discard = choose(target.state, "1");
    const effect = choose(discard.state, "cascade");
    expect(effect.state.pending).toMatchObject({ seat: 1, kind: "discard" });
    expect(effect.state.hands[0]).toEqual([]);
    expect(effect.state.hands[1]).toEqual(["X", "P", "Q", "R", "S"]);
    expect(effect.events.every((event) => "seat" in event && event.seat === 1)).toBe(true);
  });

  it("Terran Crackdown flips only named Stations together in one step", () => {
    const start = fixture(["crackdown"]);
    const mixed = {
      ...start,
      bases: start.bases.map((base, seat) => ({
        ...base,
        station: {
          ...base.station,
          side: seat === 1 ? ("terran_outpost" as const) : ("named" as const),
        },
      })),
    };
    const seen: string[][] = [];
    const watching: Registry = {
      ...registry,
      afterStep: (state, frame) => {
        seen.push(state.bases.map(({ station }) => station.side));
        return registry.afterStep(state, frame);
      },
    };
    const done = run(pushAction(push(mixed, "stop"), { op: "discard", n: 1 }, 0), watching);
    expect(done.events.map(({ type }) => type)).toEqual(["card_discarded", "station_flipped"]);
    expect(done.events[1]).toMatchObject({ flips: [{ seat: 0 }, { seat: 2 }] });
    expect(done.state.bases[1]).toEqual(mixed.bases[1]);
    expect(done.state.bases.map(({ station }) => station.side)).toEqual([
      "terran_outpost",
      "terran_outpost",
      "terran_outpost",
    ]);
    expect(seen.every((sides) => sides[0] === sides[2])).toBe(true);
  });

  it("Terran Crackdown on all Outposts emits no Flip and an Influence with no text just Discards", () => {
    for (const card of ["crackdown", "alliance"]) {
      const done = run(
        pushAction(push(fixture([card]), "stop"), { op: "discard", n: 1 }, 0),
        registry,
      );
      expect(done.events.map(({ type }) => type)).toEqual(["card_discarded"]);
      expect(done.state.pending?.kind).toBe("finished");
    }
  });

  it("the forced Entropic Cascade cycle reaches step_limit with no winner and replays identically", () => {
    const start = pushAction(push(fixture(["cascade"], []), "stop"), { op: "discard", n: 1 }, 0);
    const before = structuredClone(start);
    const done = run(start, registry);
    expect(done.state.result).toEqual({ reason: "step_limit", winners: [], scores: [0, 0, 0] });
    expect(done.state.turn.work).toBe(STEP_BUDGET);
    expect(done.state.stack).toEqual([]);
    expect(done.state.pending).toBeNull();
    expect(done.events.filter(({ type }) => type === "game_ended")).toHaveLength(1);
    expect(run(structuredClone(start), registry)).toEqual(done);
    expect(start).toEqual(before);
  });

  it("Discard all with two nested Cascades and a full Deck finishes far below the budget", () => {
    const deck = Array.from({ length: 76 }, (_, i) => `deck${String(i)}`);
    const start = pushAction(
      push(fixture(["cascade", "cascade2"], deck), "stop"),
      { op: "discard_hand" },
      0,
    );
    const asked = run(start, registry);
    const first = choose(asked.state, "cascade");
    let next = choose(first.state, "cascade2");
    expect(next.state.hands[0]).toEqual(deck.slice(0, 8));
    for (const card of deck.slice(0, 5)) next = choose(next.state, card);
    expect(next.state.pending?.kind).toBe("finished");
    expect(next.state.result).toBeNull();
    expect(next.state.hands[0]).toEqual(deck.slice(5, 8));
    expect(next.state.turn.work).toBeLessThan(STEP_BUDGET / 10);
    process.stdout.write(
      `T071 nested Cascade / Discard all: ${String(next.state.turn.work)} steps\n`,
    );
  });
});
