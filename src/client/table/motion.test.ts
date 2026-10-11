import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { GameView } from "../../protocol/messages.ts";
import type { GameState } from "../connection.ts";
import { player, view } from "../testing/view-fixture.ts";
import { Table } from "./Table.tsx";

type Events = GameState["events"];

const SUPPLY = { left: 10, top: 20 };
const HAND = { left: 300, top: 500 };
const BASE = { left: 700, top: 300 };
const DECK = { left: 400, top: 20 };
const DISCARD = { left: 500, top: 20 };
const OPPONENT = { left: 50, top: 50 };

/** jsdom has no layout: place each region of the table at a fixed point. */
function place(element: Element): { left: number; top: number } {
  if (element.closest('[data-pile="deck"]') !== null) return DECK;
  if (element.closest('[data-pile="discard"]') !== null) return DISCARD;
  if (element.closest('[data-seat="1"]') !== null) return OPPONENT;
  if (element.closest('[aria-label="Your hand"]') !== null) return HAND;
  if (element.closest('[aria-label="Supply"]') !== null) return SUPPLY;
  if (element.closest('[aria-label="Base"]') !== null) return BASE;
  return { left: 0, top: 0 };
}

let reduced = false;

beforeEach(() => {
  vi.useFakeTimers();
  reduced = false;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduced && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const { left, top } = place(this);
    return new DOMRect(left, top, 110, 220);
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const supply = [
  { instance: "s-1", cardId: "mod-depot" },
  { instance: "s-2", cardId: "mod-depot" },
];
const card = { instance: "s-1", cardId: "mod-depot" };
/** An opponent's card: never drawn on the table until it is played. */
const hidden = { instance: "op-1", cardId: "mod-depot" };

function game(gameView: GameView, events: Events = [], seq = 1): GameState {
  return { game: "g1", seq, view: gameView, events, log: [], history: events };
}

function mount(first: GameView) {
  const onDecide = vi.fn();
  const props = { onDecide, onLeave: vi.fn() };
  const screenRender = render(createElement(Table, { game: game(first), ...props }));
  const update = (next: GameView, events: Events, seq = 2) => {
    screenRender.rerender(createElement(Table, { game: game(next, events, seq), ...props }));
  };
  return { onDecide, update };
}

const before = view({ players: [player(0), player(1)], hand: [], supply, deck: 40 });
const drafted = {
  type: "card_drafted",
  seat: 0,
  card,
  text: "Ann drafts Depot.",
} as unknown as Events[number];

function cardElement(instance: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-card="${instance}"]`);
  if (found === null) throw new Error(`no card ${instance}`);
  return found;
}

/** The elements a motion is running on: every motion sets `will-change`. */
function styled(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[style]")].filter(
    (element) => element.style.willChange !== "" || element.style.transition !== "",
  );
}

describe("Card motion", () => {
  test("a drafted card travels from the Supply's box to the hand's box in 250 ms", () => {
    const { update } = mount(before);
    update(
      view({ players: [player(0), player(1)], hand: [card], supply: supply.slice(1), deck: 40 }),
      [drafted],
    );
    const element = cardElement("s-1");
    expect(within(screen.getByRole("region", { name: "Your hand" })).getByRole("button")).toBe(
      element,
    );
    expect(element.style.transform).toBe(
      `translate(${String(SUPPLY.left - HAND.left)}px, ${String(SUPPLY.top - HAND.top)}px)`,
    );
    expect(element.style.transition).toContain("transform 250ms");
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(element.style.transform).toBe("");
  });

  test("a drawn card comes from the Deck pile", () => {
    const { update } = mount(before);
    update(
      view({ players: [player(0), player(1)], hand: [card], supply: supply.slice(1), deck: 39 }),
      [{ type: "card_drawn", seat: 0, card, text: "Ann draws." } as unknown as Events[number]],
    );
    expect(cardElement("s-1").style.transform).toBe(
      `translate(${String(DECK.left - HAND.left)}px, ${String(DECK.top - HAND.top)}px)`,
    );
  });

  test.each(["card_discarded", "card_resold", "agent_played"])(
    "a card of %s that left the hand travels to the Discard pile",
    (type) => {
      const { update } = mount(view({ players: [player(0), player(1)], hand: [card], supply: [] }));
      update(view({ players: [player(0), player(1)], hand: [], supply: [], discard: [card] }), [
        { type, seat: 0, card, text: "x" } as unknown as Events[number],
      ]);
      const ghost = document.querySelector<HTMLElement>("[data-motion-ghost]");
      expect(ghost).not.toBeNull();
      expect(ghost?.style.left).toBe(`${String(HAND.left)}px`);
      expect(ghost?.style.top).toBe(`${String(HAND.top)}px`);
      act(() => {
        vi.advanceTimersByTime(270);
      });
      expect(ghost?.style.left).toBe(`${String(DISCARD.left)}px`);
      expect(ghost?.style.top).toBe(`${String(DISCARD.top)}px`);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(document.querySelector("[data-motion-ghost]")).toBeNull();
    },
  );

  test.each(["card_discarded", "card_resold", "agent_played", "agent_discarded"])(
    "an opponent's %s leaves from the opponent's panel",
    (type) => {
      const { update } = mount(before);
      update(view({ players: [player(0), player(1)], hand: [], supply: [], discard: [hidden] }), [
        { type, seat: 1, card: hidden, text: "x" } as unknown as Events[number],
      ]);
      const ghost = document.querySelector<HTMLElement>("[data-motion-ghost]");
      expect(ghost).not.toBeNull();
      expect(ghost?.style.left).toBe(`${String(OPPONENT.left)}px`);
      expect(ghost?.style.top).toBe(`${String(OPPONENT.top)}px`);
      act(() => {
        vi.advanceTimersByTime(270);
      });
      expect(ghost?.style.left).toBe(`${String(DISCARD.left)}px`);
    },
  );

  test("a built Module travels from the hand to its place in the Base", () => {
    const station = player(0).base.station;
    const built = { instance: "m-1", cardId: "mod-depot", x: 1, y: 0, q: 0 as const };
    const { update } = mount(
      view({
        players: [player(0), player(1)],
        hand: [{ instance: "m-1", cardId: "mod-depot" }],
        supply: [],
      }),
    );
    update(
      view({
        players: [
          player(0, { base: { station, modules: [built], orbs: player(0).base.orbs } }),
          player(1),
        ],
        hand: [],
        supply: [],
      }),
      [
        {
          type: "module_built",
          seat: 0,
          card: { instance: "m-1", cardId: "mod-depot" },
          x: 1,
          y: 0,
          q: 0,
          cost: 1,
          text: "x",
        } as unknown as Events[number],
      ],
    );
    // The Base is scaled and clips: the card flies as a ghost from the hand's
    // box to the Base box while the real card waits, hidden, where it lands.
    const ghost = document.querySelector<HTMLElement>("[data-motion-ghost]");
    expect(ghost?.style.left).toBe(`${String(HAND.left)}px`);
    expect(ghost?.style.top).toBe(`${String(HAND.top)}px`);
    expect(cardElement("m-1").style.visibility).toBe("hidden");
    expect(cardElement("m-1").style.transform).toBe("");
    act(() => {
      vi.advanceTimersByTime(270);
    });
    expect(ghost?.style.left).toBe(`${String(BASE.left)}px`);
    expect(ghost?.style.top).toBe(`${String(BASE.top)}px`);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(document.querySelector("[data-motion-ghost]")).toBeNull();
    expect(cardElement("m-1").style.visibility).toBe("");
  });

  test("a Flipped Station turns over in place", () => {
    const { update } = mount(before);
    const station = player(0).base.station;
    update(
      view({
        players: [
          player(0, {
            base: {
              station: { ...station, side: "named", cardId: "stn-kafka", revealed: true },
              modules: [],
              orbs: player(0).base.orbs,
            },
          }),
          player(1),
        ],
        hand: [],
        supply,
      }),
      [
        {
          type: "station_flipped",
          flips: [{ seat: 0, card: { instance: station.instance, cardId: "stn-kafka" } }],
          text: "x",
        } as unknown as Events[number],
      ],
    );
    const element = cardElement(station.instance);
    expect(element.style.transform).toContain("scaleX(0)");
    expect(element.style.transition).toContain("transform 250ms");
  });

  test("with reduced motion no element gets a transition, a transform or an animation", () => {
    reduced = true;
    const { update } = mount(before);
    update(
      view({ players: [player(0), player(1)], hand: [card], supply: supply.slice(1), deck: 40 }),
      [drafted],
    );
    expect(styled()).toEqual([]);
    expect(document.querySelector("[data-motion-ghost]")).toBeNull();
    for (const element of document.querySelectorAll<HTMLElement>("*")) {
      expect(element.style.animation).toBe("");
      expect(element.style.transition).toBe("");
    }
  });

  test("an option button works while cards move and sends its option", () => {
    const { update, onDecide } = mount(before);
    update(
      view({
        players: [player(0), player(1)],
        hand: [card],
        supply: supply.slice(1),
        pending: {
          id: "d9",
          seat: 0,
          kind: "target",
          options: [{ id: "1", label: "Target Bea", target: 1 }],
        },
      }),
      [drafted],
    );
    expect(cardElement("s-1").style.transition).toContain("transform");
    fireEvent.click(screen.getByRole("button", { name: "Target Bea" }));
    expect(onDecide).toHaveBeenCalledExactlyOnceWith("d9", "1");
  });

  test("a second update 50 ms later leaves every card in place with no inline style", () => {
    const { update } = mount(before);
    update(
      view({ players: [player(0), player(1)], hand: [card], supply: supply.slice(1), deck: 40 }),
      [drafted],
    );
    act(() => {
      vi.advanceTimersByTime(50);
    });
    const second = { instance: "s-2", cardId: "mod-depot" };
    update(
      view({ players: [player(0), player(1)], hand: [card, second], supply: [], deck: 40 }),
      [{ type: "card_drafted", seat: 0, card: second, text: "x" } as unknown as Events[number]],
      3,
    );
    // The first move ended: only the second card is moving.
    expect(styled().map((element) => element.dataset["card"])).toEqual(["s-2"]);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(styled()).toEqual([]);
    for (const element of document.querySelectorAll<HTMLElement>("[data-card]")) {
      expect(element.style.transform).toBe("");
      expect(element.style.transition).toBe("");
      expect(element.style.willChange).toBe("");
    }
    expect(document.querySelector("[data-motion-ghost]")).toBeNull();
  });
});
