import { describe, expect, it } from "vitest";
import { pushAction } from "../actions/index.ts";
import { actionsOf, cardById } from "../catalogue.ts";
import { ask } from "../decisions.ts";
import { eventFor } from "../events.ts";
import { gameRegistry } from "../game.ts";
import { applyChoice, push, run, type Registry } from "../loop.ts";
import { dealGame } from "../setup.ts";
import type { GameState } from "../state.ts";

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

function fixture(supply: readonly string[]): GameState {
  const state = dealGame(
    { seats: 3, influences: true, kickstarter: false, startingSeat: 0 },
    "supply-effects",
  );
  return {
    ...state,
    cards: {
      ...state.cards,
      quarantine: "inf-quarantine",
      alliance: "inf-lunar-alliance",
      embargo: "inf-terran-embargo",
      module: "mod-rover-1",
      agent: "agt-investor",
    },
    supply,
    deck: [],
    discard: [],
    hands: [[], [], []],
    credits: [4, 5, 6],
  };
}

function choose(state: GameState, option: string) {
  const pending = state.pending;
  if (!pending) throw new Error("Expected decision");
  const result = applyChoice(state, { seat: pending.seat, decision: pending.id, option }, registry);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

function draft(state: GameState, n = 1) {
  return run(
    push(push(state, "stop"), "box", {
      seat: 0,
      actions: [{ op: "draft", n }],
      position: 0,
      repeated: 0,
      deferred: [],
    }),
    registry,
  );
}

function steal(state: GameState) {
  return run(pushAction(push(state, "stop"), { op: "steal_credits", n: 3 }, 0), registry);
}

function resume(state: GameState): GameState {
  return { ...state, stack: [], pending: null };
}

describe("R10.3 Supply restrictions", () => {
  it("Q20: Quarantine excludes other Influences from D4 until drafted, even within Draft 2", () => {
    const start = fixture(["alliance", "module", "quarantine", "agent"]);
    const before = structuredClone(start);
    const asked = draft(start, 2);
    expect(asked.state.pending?.options.map(({ id }) => id)).toEqual([
      "module",
      "quarantine",
      "agent",
    ]);
    const pending = asked.state.pending;
    if (!pending) throw new Error("Expected Draft decision");
    expect(
      applyChoice(asked.state, { seat: 0, decision: pending.id, option: "alliance" }, registry),
    ).toMatchObject({ ok: false, error: { code: "unknown_option" } });
    const next = choose(asked.state, "quarantine");
    expect(next.state.hands[0]).toEqual(["quarantine"]);
    expect(next.state.pending?.options.map(({ id }) => id)).toEqual([
      "alliance",
      "module",
      "agent",
    ]);
    const done = choose(next.state, "alliance");
    expect(done.state.hands[0]).toEqual(["quarantine", "alliance"]);
    expect(done.state.pending?.kind).toBe("finished");
    expect(start).toEqual(before);
  });

  it("Q20 / R7.4: an exhausted Draft skips its remaining repetitions", () => {
    const done = draft(fixture(["quarantine", "alliance"]), 3);
    expect(done.state.pending?.kind).toBe("finished");
    expect(done.state.hands[0]).toEqual(["quarantine", "alliance"]);
    expect(done.state.supply).toEqual([]);
  });

  it("Q35: Steal 3 moves nothing, asks no target, explains why publicly, then works after removal", () => {
    const start = fixture(["alliance", "module"]);
    const before = structuredClone(start);
    const blocked = steal(start);
    expect(blocked.state.credits).toEqual([4, 5, 6]);
    expect(blocked.state.pending?.kind).toBe("finished");
    expect(blocked.events).toEqual([
      {
        type: "action_blocked",
        seat: 0,
        action: "steal_credits",
        card: { instance: "alliance", cardId: "inf-lunar-alliance" },
      },
    ]);
    for (const seat of [null, 0, 1, 2]) {
      expect(eventFor(blocked.events[0], seat)?.text).toMatch(
        /Steal Credits.*Lunar Alliance.*Supply/,
      );
    }
    const taken = choose(draft(resume(blocked.state)).state, "alliance");
    const offered = steal(resume(taken.state));
    expect(offered.state.pending?.kind).toBe("target");
    const done = choose(offered.state, "1");
    expect(done.state.credits).toEqual([7, 2, 6]);
    expect(done.events).toEqual([{ type: "credits_stolen", thief: 0, victim: 1, amount: 3 }]);
    expect(start).toEqual(before);
  });

  it.each([
    "agt-panaman-broker",
    "stn-imbrium",
    "mod-helium-factory",
    "inf-space-cowboy-capitalism",
  ])("Q35: blocks the Steal printed on %s and continues the next action", (id) => {
    const action = actionsOf(cardById(id)).find(({ op }) => op === "steal_credits");
    if (!action) throw new Error("Expected printed Steal");
    const start = fixture(["alliance"]);
    const done = run(
      push(push(start, "stop"), "box", {
        seat: 0,
        actions: [action, { op: "draft", n: 1 }],
        position: 0,
        repeated: 0,
        deferred: [],
      }),
      registry,
    );
    expect(done.state.credits).toEqual([4, 5, 6]);
    expect(done.state.hands[0]).toEqual(["alliance"]);
    expect(done.events.map(({ type }) => type)).toEqual(["action_blocked", "card_drafted"]);
    expect(done.state.pending?.kind).toBe("finished");
  });

  it("R10.3: Lunar Alliance dealt by a Shuttle blocks the very next action", () => {
    const start = { ...fixture([]), deck: ["alliance", "module"] };
    const done = run(
      push(pushAction(push(start, "stop"), { op: "steal_credits", n: 3 }, 0), "shuttle_deal"),
      registry,
    );
    expect(done.state.supply).toEqual(["alliance", "module"]);
    expect(done.state.credits).toEqual([4, 5, 6]);
    expect(done.state.pending?.kind).toBe("finished");
    expect(done.events.map(({ type }) => type)).toEqual(["supply_dealt", "action_blocked"]);
  });

  it("R10.3: Quarantine dealt by a Shuttle restricts the very next Draft", () => {
    const start = { ...fixture([]), deck: ["alliance", "quarantine", "module"] };
    const done = run(
      push(pushAction(push(start, "stop"), { op: "draft", n: 1 }, 0), "shuttle_deal"),
      registry,
    );
    expect(done.state.pending?.options.map(({ id }) => id)).toEqual(["quarantine", "module"]);
  });
});
