import { describe, expect, expectTypeOf, it } from "vitest";
import { EVENT_AUDIENCE, eventFor, type GameEvent, type ViewEvent } from "./events.ts";

const card = { instance: "c7", cardId: "mod-fusion-reactor" };
const agent = { instance: "c9", cardId: "agt-kim-the-mech-pilot" };
const influence = { instance: "c80", cardId: "inf-quarantine" };
const samples = {
  game_started: { type: "game_started", seats: 2, startingSeat: 0 },
  turn_started: { type: "turn_started", seat: 0, turn: 1 },
  box_chosen: { type: "box_chosen", seat: 0, card, box: 1 },
  card_drafted: { type: "card_drafted", seat: 0, card },
  card_drawn: { type: "card_drawn", seat: 0, card },
  card_discarded: { type: "card_discarded", seat: 0, card },
  card_resold: { type: "card_resold", seat: 0, card, credits: 2 },
  module_built: { type: "module_built", seat: 0, card, x: 1, y: 0, q: 0, cost: 3 },
  credits_changed: { type: "credits_changed", seat: 0, delta: -3, credits: 2 },
  credits_lost: {
    type: "credits_lost",
    losses: [
      { seat: 0, delta: 0, credits: 0 },
      { seat: 1, delta: -1, credits: 1 },
    ],
  },
  hand_seen: { type: "hand_seen", looker: 0, opponent: 1, cards: [card] },
  action_blocked: {
    type: "action_blocked",
    seat: 0,
    action: "steal_credits",
    card: { instance: "c10", cardId: "inf-lunar-alliance" },
  },
  credits_stolen: { type: "credits_stolen", thief: 0, victim: 1, amount: 3 },
  module_stolen: { type: "module_stolen", thief: 0, victim: 1, card },
  station_flipped: {
    type: "station_flipped",
    flips: [
      { seat: 0, card: { instance: "c1", cardId: "stn-shackleton" } },
      { seat: 1, card: { instance: "c2", cardId: "stn-terran-outpost" } },
    ],
  },
  stations_exchanged: { type: "stations_exchanged", seats: [0, 1] },
  deck_reshuffled: { type: "deck_reshuffled", count: 5 },
  shuttles_arrived: {
    type: "shuttles_arrived",
    seat: 0,
    turn: 1,
    gains: [
      { seat: 0, delta: 3, credits: 7 },
      { seat: 1, delta: 0, credits: 4 },
    ],
  },
  supply_dealt: { type: "supply_dealt", cards: [card] },
  text_deferred: { type: "text_deferred", seat: 0, card },
  agent_played: { type: "agent_played", seat: 0, card: agent, cost: 2 },
  agent_discarded: { type: "agent_discarded", seat: 0, card: agent },
  influences_revealed: { type: "influences_revealed", seat: 0, cards: [influence] },
  game_ended: { type: "game_ended", reason: "victory", winners: [0], scores: [1, 0] },
} as const satisfies { [K in GameEvent["type"]]: Extract<GameEvent, { type: K }> };

describe("eventFor", () => {
  it("covers every GameEvent with an audience row", () => {
    expectTypeOf(EVENT_AUDIENCE).toExtend<Record<GameEvent["type"], unknown>>();
    const { card_drawn, ...missingDraw } = EVENT_AUDIENCE;
    // @ts-expect-error A missing event row must fail type-checking.
    const incomplete: typeof EVENT_AUDIENCE = missingDraw;
    expectTypeOf(incomplete).toEqualTypeOf<typeof EVENT_AUDIENCE>();
    expect(card_drawn).toBeDefined();
    expect(Object.keys(EVENT_AUDIENCE).sort()).toEqual(Object.keys(samples).sort());
  });

  for (const type of Object.keys(samples) as GameEvent["type"][]) {
    it(`${type}: projects only declared fields for public, private and other seats`, () => {
      const event = samples[type];
      const row = EVENT_AUDIENCE[type];
      // Deliberate runtime extras catch spreading the authoritative event.
      const extended = { ...event, seed: "secret", text: "secret", hiddenCard: "secret" };
      const before = JSON.stringify(extended);
      for (const seat of [null, 0, 1]) {
        const view = eventFor(extended, seat);
        expect(view).not.toBeNull();
        if (!view) throw new Error("M1 events all have a public form");
        const sharesCard = "defaultCardAudience" in row && row.defaultCardAudience === "all";
        const privateFields =
          (row.privateSeat !== null && seat === 0) || sharesCard ? row.private : [];
        const allowed = ["type", "text", ...row.public, ...privateFields];
        expect(Object.keys(view).sort()).toEqual([...new Set(allowed)].sort());
        for (const field of [...row.public, ...privateFields]) {
          expect(Reflect.get(view, field)).toEqual(Reflect.get(event, field));
        }
        expect(view.type).toBe(type);
        expect(view.text.trim().length).toBeGreaterThan(0);
        expect(view.text).toMatch(/[.!?]$/);
        expect(JSON.parse(JSON.stringify(view))).toEqual(view);
        expect(eventFor(extended, seat)).toEqual(view);
      }
      expect(JSON.stringify(extended)).toBe(before);
    });
  }

  it.each([0, 2, 5])("gives the card only to drawer %i, including seat zero", (seat) => {
    const event: GameEvent = { type: "card_drawn", seat, card };
    const own = eventFor(event, seat);
    expect(own).toEqual({ type: "card_drawn", seat, card, text: own?.text });
    for (const audience of [null, (seat + 1) % 6]) {
      const view = eventFor(event, audience);
      expect(view).toEqual({ type: "card_drawn", seat, text: view?.text });
      // Changing the hidden card must not change even the public log sentence.
      expect(
        eventFor({ ...event, card: { instance: "c99", cardId: "mod-rover-1" } }, audience),
      ).toEqual(view);
    }
    expect(own?.text).toContain("Fusion Reactor");
  });

  it.each([0, 2, 5])("R7.15 keeps hand snapshots private to looker %i", (looker) => {
    const opponent = (looker + 1) % 6;
    const event: GameEvent = { type: "hand_seen", looker, opponent, cards: [{ ...card }] };
    const own = eventFor(event, looker);
    expect(own).toMatchObject({ cards: [card] });
    for (const seat of [null, 0, 1, 2, 3, 4, 5].filter((seat) => seat !== looker)) {
      const projected = eventFor(event, seat);
      expect(projected).toEqual({ type: "hand_seen", looker, opponent, text: projected?.text });
      expect(
        eventFor({ ...event, cards: [{ instance: "c99", cardId: "mod-rover-1" }] }, seat),
      ).toEqual(projected);
    }
    Object.assign(event.cards[0], { cardId: "mod-rover-1" });
    expect(own).toMatchObject({ cards: [card] });
  });

  it.each(["card_drafted", "card_discarded", "card_resold", "module_built"] as const)(
    "%s: keeps a publicly revealed card visible to everyone",
    (type) => {
      for (const seat of [null, 0, 1]) {
        expect(eventFor(samples[type], seat)).toMatchObject({ type, card });
      }
    },
  );

  it("makes a detached snapshot so later mutations cannot rewrite event history", () => {
    const event: GameEvent = { type: "supply_dealt", cards: [{ ...card }] };
    const history = eventFor(event, null);
    const before = JSON.stringify(history);
    Object.assign(event.cards[0], { cardId: "mod-rover-1" });
    expect(JSON.stringify(history)).toBe(before);
    expect(history).toMatchObject({ cards: [card] });
  });

  it("names the Agent and its price when it is played and when it is discarded", () => {
    for (const seat of [null, 0, 1]) {
      expect(eventFor(samples.agent_played, seat)).toStrictEqual({
        ...samples.agent_played,
        text: "Player 1 played Kim the Mech Pilot for 2 Credits.",
      });
      expect(eventFor(samples.agent_discarded, seat)).toStrictEqual({
        ...samples.agent_discarded,
        text: "Player 1's Kim the Mech Pilot went to the Discard pile.",
      });
    }
  });

  it("R11.4: names revealed Influences for every audience", () => {
    const cards = [influence, { instance: "c81", cardId: "inf-lunar-alliance" }];
    for (const seat of [null, 0, 1]) {
      expect(eventFor({ type: "influences_revealed", seat: 1, cards }, seat)).toStrictEqual({
        type: "influences_revealed",
        seat: 1,
        cards,
        text: "Player 2 revealed 2 Influences: Quarantine, Lunar Alliance.",
      });
    }
  });

  it("describes both a victory and a step limit without inventing a winner", () => {
    const victory = eventFor(samples.game_ended, null);
    expect(victory?.text).toContain("Player 1");
    const stopped = eventFor(
      { type: "game_ended", reason: "step_limit", winners: [], scores: [0, 0] },
      null,
    );
    expect(stopped?.text).toMatch(/step limit/i);
    expect(stopped?.text).not.toMatch(/Player/);
  });

  it("requires narrowing a Draw before accessing its private card", () => {
    const view = eventFor(samples.card_drawn, null) as ViewEvent;
    if (view.type === "card_drawn") {
      // @ts-expect-error Public draws do not carry a card.
      expect(view.card).toBeUndefined();
    }
  });
});
