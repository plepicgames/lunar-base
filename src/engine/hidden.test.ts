import { isDeepStrictEqual } from "node:util";
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { cardById } from "./catalogue.ts";
import { eventFor, type EventCard, type GameEvent, type ViewEvent } from "./events.ts";
import { gameRegistry, startGame } from "./game.ts";
import { applyChoice, push, run, type Registry, type Step } from "./loop.ts";
import { dealGame } from "./setup.ts";
import type { GameState, Seat } from "./state.ts";
import { buildState } from "./testing/build.ts";
import { seededPicker, TURN_CAP } from "./testing/play.ts";
import { flipStations } from "./actions/flip.ts";
import { discardCard } from "./actions/discard.ts";
import { draw } from "./actions/draw.ts";
import { viewFor } from "./view.ts";

const config = { seats: 3, influences: true, kickstarter: false, startingSeat: 0 };
const audiences = (state: GameState) => [null, ...state.hands.map((_, seat) => seat)];

// Independent transcription of the design's event table, not EVENT_AUDIENCE.
// Widening a production row must fail even if eventFor follows that row.
const publicFields = {
  game_started: ["seats", "startingSeat"],
  turn_started: ["seat", "turn"],
  box_chosen: ["seat", "card", "box"],
  card_drafted: ["seat", "card"],
  card_drawn: ["seat"],
  card_discarded: ["seat", "card"],
  card_resold: ["seat", "card", "credits"],
  module_built: ["seat", "card", "x", "y", "q", "cost"],
  credits_changed: ["seat", "delta", "credits"],
  credits_lost: ["losses"],
  hand_seen: ["looker", "opponent"],
  action_blocked: ["seat", "action", "card"],
  credits_stolen: ["thief", "victim", "amount"],
  module_stolen: ["thief", "victim", "card"],
  station_flipped: ["flips"],
  stations_exchanged: ["seats"],
  deck_reshuffled: ["count"],
  shuttles_arrived: ["seat", "turn", "gains"],
  supply_dealt: ["cards"],
  text_deferred: ["seat", "card"],
  agent_played: ["seat", "card", "cost"],
  agent_discarded: ["seat", "card"],
  influences_revealed: ["seat", "cards"],
  game_ended: ["reason", "winners", "scores"],
} satisfies Record<GameEvent["type"], readonly string[]>;

function same(actual: unknown, expected: unknown) {
  if (!isDeepStrictEqual(actual, expected)) expect(actual).toStrictEqual(expected);
}

function cardsIn(value: unknown): EventCard[] {
  if (value === null || typeof value !== "object") return [];
  if ("instance" in value) return [value as EventCard];
  return Object.values(value).flatMap(cardsIn);
}

function transparent(state: GameState): boolean {
  return state.supply.some((id) => state.cards[id] === "ks-inf-transparency");
}

/** Check at the emitting step, before another handler can hide its cards. */
function checkEvent(event: GameEvent, before: GameState, after: GameState) {
  const publicCards = (state: GameState): EventCard[] => [
    ...[
      ...state.supply,
      ...state.play,
      ...(transparent(state) ? state.deck.slice(0, 1) : state.discard),
    ].map((instance) => ({
      instance,
      cardId: state.cards[instance],
    })),
    ...state.bases.flatMap(({ station, modules }) => [
      {
        instance: station.card,
        cardId: station.side === "named" ? state.cards[station.card] : "stn-terran-outpost",
      },
      ...modules.map(({ card }) => ({ instance: card, cardId: state.cards[card] })),
    ]),
  ];
  const publicAtEmission = [...publicCards(before), ...publicCards(after)];
  if (event.type === "influences_revealed") {
    const revealed = after.hands[event.seat]
      .filter((instance) => cardById(after.cards[instance]).type === "influence")
      .map((instance) => ({ instance, cardId: after.cards[instance] }));
    same(event.cards, revealed);
    expect(event.seat).toBe(after.turn.seat);
    expect(revealed.length).toBeGreaterThanOrEqual(4);
    publicAtEmission.push(...revealed);
  }
  const publicDraw = event.type === "card_drawn" && transparent(before);
  const hiddenDiscard =
    event.type === "card_discarded" &&
    transparent(before) &&
    cardById(before.cards[event.card.instance]).type !== "influence";
  if (publicDraw) {
    // A reshuffle can create the face-up top within the Draw handler.
    expect(
      before.deck.length
        ? before.deck[0] === event.card.instance
        : before.discard.includes(event.card.instance),
    ).toBe(true);
    expect(after.hands[event.seat]).toContain(event.card.instance);
    publicAtEmission.push({
      instance: event.card.instance,
      cardId: before.cards[event.card.instance],
    });
  }
  if (event.type === "card_discarded" && !hiddenDiscard) {
    expect(before.hands[event.seat]).toContain(event.card.instance);
    publicAtEmission.push({
      instance: event.card.instance,
      cardId: before.cards[event.card.instance],
    });
  }
  for (const seat of audiences(after)) {
    const privateFields =
      ((event.type === "card_drawn" && !publicDraw) || hiddenDiscard) && seat === event.seat
        ? ["card"]
        : event.type === "hand_seen" && seat === event.looker
          ? ["cards"]
          : [];
    const shared = publicDraw
      ? ["seat", "card"]
      : hiddenDiscard
        ? ["seat"]
        : publicFields[event.type];
    const fields = [...shared, ...privateFields];
    const view = eventFor(event, seat);
    if (view === null) throw new Error(`Missing ${event.type} for ${String(seat)}`);
    same(Object.keys(view).sort(), ["type", "text", ...fields].sort());
    for (const field of fields) same(Reflect.get(view, field), Reflect.get(event, field));
    same(view.type, event.type);
    expect(view.text.length).toBeGreaterThan(0);
    const allowed = [...publicAtEmission];
    if (event.type === "card_discarded" && seat === event.seat) {
      allowed.push(
        ...before.hands[seat].map((instance) => ({ instance, cardId: before.cards[instance] })),
      );
    }
    if (event.type === "card_drawn" && seat === event.seat) {
      allowed.push(
        ...after.hands[seat].map((instance) => ({ instance, cardId: after.cards[instance] })),
      );
    }
    if (event.type === "hand_seen" && seat === event.looker) {
      const hand = before.hands[event.opponent].map((instance) => ({
        instance,
        cardId: before.cards[instance],
      }));
      same(event.cards, hand);
      allowed.push(...hand);
    }
    for (const card of cardsIn(view)) {
      same(Object.keys(card).sort(), ["cardId", "instance"]);
      if (!allowed.some((known) => isDeepStrictEqual(known, card))) {
        throw new Error(`${event.type} exposed ${JSON.stringify(card)} to ${String(seat)}`);
      }
    }
    // Private identities must not leak through the public sentence either.
    const other = { instance: "c999", cardId: "inf-quarantine" };
    if (((event.type === "card_drawn" && !publicDraw) || hiddenDiscard) && seat !== event.seat) {
      same(eventFor({ ...event, card: other }, seat), view);
    }
    if (event.type === "hand_seen" && seat !== event.looker) {
      same(eventFor({ ...event, cards: [other] }, seat), view);
    }
  }
}

function fixture(): GameState {
  const built = buildState([
    { station: "stn-shackleton" },
    { station: "stn-selene-labs" },
    { station: "stn-imbrium" },
  ]);
  return {
    ...dealGame(config, "hidden"),
    ...built,
    cards: {
      ...built.cards,
      c7: "agt-spybot-py",
      c8: "inf-lunar-alliance",
      c9: "mod-bacon-printer",
      c10: "mod-rover-1",
      c11: "mod-fusion-reactor",
    },
    hands: [[], ["c8", "c9"], []],
    deck: ["c10", "c11"],
    supply: [],
    discard: [],
    play: ["c7"],
    removedStations: [],
  };
}

function spybot(state: GameState) {
  return run(
    push(state, "agent", {
      seat: 0,
      card: "c7",
      actions: cardById("agt-spybot-py").on_play ?? [],
      position: 0,
      repeated: 0,
      deferred: [],
    }),
    gameRegistry,
  );
}

function choose(state: GameState, option: string, registry = gameRegistry) {
  const pending = state.pending;
  if (!pending) throw new Error("Expected decision");
  const result = applyChoice(state, { seat: pending.seat, decision: pending.id, option }, registry);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

function diffPaths(a: unknown, b: unknown, path = ""): string[] {
  if (isDeepStrictEqual(a, b)) return [];
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return [path];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((key) =>
    diffPaths(Reflect.get(a, key), Reflect.get(b, key), path ? `${path}.${key}` : key),
  );
}

describe("Influence hidden information (T076)", () => {
  test.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    "every event in 100 random games obeys its audience row at emission (Influences=%s, Kickstarter=%s)",
    (influences, kickstarter) => {
      const seatsPlayed = new Set<number>();
      const seen = new Set<GameEvent["type"]>();
      let defenceDecisions = 0;
      let publicDraws = 0;
      let hiddenDiscards = 0;
      fc.assert(
        fc.property(
          fc.string(),
          fc.integer({ min: 2, max: 6 }),
          fc.string(),
          (seed, seats, pickerSeed) => {
            const emitted: GameEvent[] = [];
            const observe = (before: GameState, step: Step) => {
              for (const event of step.events ?? []) {
                checkEvent(event, before, step.state);
                if (transparent(before)) {
                  if (event.type === "card_drawn") publicDraws++;
                  if (
                    event.type === "card_discarded" &&
                    cardById(event.card.cardId).type !== "influence"
                  )
                    hiddenDiscards++;
                }
                seen.add(event.type);
                emitted.push(event);
              }
              return step;
            };
            const registry: Registry = {
              handlers: Object.fromEntries(
                Object.entries(gameRegistry.handlers).map(([kind, handler]) => [
                  kind,
                  (state, frame, answer) => observe(state, handler(state, frame, answer)),
                ]),
              ),
              afterStep: (state, frame) => observe(state, gameRegistry.afterStep(state, frame)),
            };
            seatsPlayed.add(seats);
            const opened = startGame({ ...config, seats, influences, kickstarter }, seed, registry);
            checkEvent(opened.events[0], opened.state, opened.state);
            seen.add(opened.events[0].type);
            same(opened.events.slice(1), emitted);
            let state = opened.state;
            const pick = seededPicker(pickerSeed);
            while (state.pending !== null && state.turn.number <= TURN_CAP) {
              if (state.pending.kind === "defence") defenceDecisions++;
              emitted.length = 0;
              const result = choose(state, pick(state.pending, state), registry);
              same(result.events, emitted); // No event bypassed the step observer.
              state = result.state;
            }
          },
        ),
        { numRuns: 100, seed: 760076 },
      );
      expect([...seatsPlayed].sort()).toEqual([2, 3, 4, 5, 6]);
      if (influences) expect(defenceDecisions).toBeGreaterThan(0);
      if (influences && kickstarter) {
        expect(publicDraws).toBeGreaterThan(0);
        expect(hiddenDiscards).toBeGreaterThan(0);
      }
      for (const type of [
        "card_drawn",
        "card_discarded",
        "hand_seen",
        "station_flipped",
        "deck_reshuffled",
        ...(influences ? ["action_blocked" as const] : []),
      ] as const) {
        expect(seen.has(type), type).toBe(true);
      }
    },
    120_000,
  );

  test("opponent Influence identities and counts do not change the view without defence pending", () => {
    const state = fixture();
    const changed = {
      ...state,
      cards: { ...state.cards, c8: "mod-inflatable-habitat", c9: "inf-quarantine" },
    };
    const ordinary = { ...state, cards: { ...state.cards, c8: "mod-inflatable-habitat" } };
    expect(state.pending).toBeNull();
    for (const seat of [0, 2, null]) {
      expect(viewFor(changed, seat)).toStrictEqual(viewFor(state, seat));
      expect(viewFor(ordinary, seat)).toStrictEqual(viewFor(state, seat));
    }
    expect(viewFor(ordinary, 1).hand).not.toEqual(viewFor(state, 1).hand);
  });

  test("Spybot defence timing discloses exactly pending.seat and pending.kind to a third seat", () => {
    const start = fixture();
    const ordinary = { ...start, cards: { ...start.cards, c8: "mod-inflatable-habitat" } };
    const defending = choose(spybot(start).state, "1").state;
    const looked = choose(spybot(ordinary).state, "1").state;
    expect(defending.pending).toMatchObject({ seat: 1, kind: "defence" });
    expect(looked.pending).toMatchObject({ seat: 0, kind: "choose_one" });
    expect(diffPaths(viewFor(defending, 2), viewFor(looked, 2)).sort()).toEqual([
      "pending.kind",
      "pending.seat",
    ]);
  });

  test("only the looker's history gets the hand, including its Influence, after declining defence", () => {
    const waiting = choose(spybot(fixture()).state, "1");
    const looked = choose(waiting.state, "decline");
    const event = looked.events.find((event) => event.type === "hand_seen");
    if (!event) throw new Error("Spybot did not look");
    const hand = [
      { instance: "c8", cardId: "inf-lunar-alliance" },
      { instance: "c9", cardId: "mod-bacon-printer" },
    ];
    const histories = audiences(looked.state).map((seat) => eventFor(event, seat));
    expect(histories[1]).toMatchObject({ type: "hand_seen", cards: hand });
    for (const seat of [1, 2, null]) {
      expect(eventFor(event, seat)).toEqual({
        type: "hand_seen",
        looker: 0,
        opponent: 1,
        text: "Player 1 looked at Player 2's hand.",
      });
    }
    const snapshot = structuredClone(histories);
    const discarded = discardCard(looked.state, 1, "c9").state;
    expect(discarded.hands[1]).toEqual(["c8"]);
    expect(histories).toStrictEqual(snapshot);
    expect(viewFor(discarded, 0).hand).toEqual([]);
    expect(cardsIn(viewFor(looked.state, 0)).map(({ instance }) => instance)).not.toContain("c8");
  });

  test("a public Discard survives in every history after reshuffling hides the card in the Deck", () => {
    const start = { ...fixture(), deck: [], discard: ["c10", "c11"] };
    const discarded = discardCard(start, 1, "c9");
    const histories = new Map<Seat | null, (ViewEvent | null)[]>();
    for (const seat of audiences(start))
      histories.set(
        seat,
        (discarded.events ?? []).map((event) => eventFor(event, seat)),
      );
    const snapshot = structuredClone(histories);
    const drawing = push(discarded.state, "action", { seat: 0, action: { op: "draw", n: 1 } });
    const drawn = draw(
      drawing,
      { id: "draw", kind: "action", seat: 0, action: { op: "draw", n: 1 } },
      null,
    );
    expect(drawn.events?.[0]).toEqual({ type: "deck_reshuffled", count: 3 });
    expect(drawn.state.deck).toContain("c9");
    for (const seat of audiences(start)) {
      const history = histories.get(seat);
      if (!history) throw new Error("Missing audience history");
      history.push(...(drawn.events ?? []).map((event) => eventFor(event, seat)));
      expect(history[0]).toStrictEqual(snapshot.get(seat)?.[0]);
      expect(history[0]).toMatchObject({
        type: "card_discarded",
        card: { instance: "c9", cardId: "mod-bacon-printer" },
        text: "Player 2 discarded Bacon Printer.",
      });
      expect(JSON.stringify(viewFor(drawn.state, seat))).not.toContain('"c9"');
    }
  });

  test("the first real Flip makes the named Station public even after flipping back", () => {
    const start = fixture();
    for (const seat of [0, 2, null])
      expect(viewFor(start, seat).players[1].base.station.named).toBeNull();
    const flipped = flipStations(start, [1]);
    const back = flipStations(flipped.state, [1]);
    const event = flipped.events?.[0];
    if (!event) throw new Error("Missing Flip event");
    for (const seat of audiences(start)) {
      expect(eventFor(event, seat)).toMatchObject({
        flips: [{ seat: 1, card: { instance: "c2", cardId: "stn-selene-labs" } }],
      });
      expect(viewFor(flipped.state, seat).players[1].base.station.named).toBe("stn-selene-labs");
      expect(viewFor(back.state, seat).players[1].base.station).toMatchObject({
        named: "stn-selene-labs",
        cardId: "stn-terran-outpost",
        revealed: true,
      });
    }
  });
});
