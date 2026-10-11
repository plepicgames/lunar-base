// Card motion (architecture, Behaviour): an update's events say which cards
// moved. A card travels from where it was drawn to where it now is in about
// 250 ms: measure the old box, render, animate the difference (FLIP). The
// motion is inline `transform` on the card's button; a card that lands inside
// a scaled or clipped region (a Base) or that has no box of its own (an
// opponent's hand, a pile) is flown as a fixed-position ghost that re-reads its
// destination each frame, so layout that settles during the move cannot leave
// it behind. Nothing sets `pointer-events`, so nothing waits for a motion. A
// newer update ends the running motion first, so every card is at its final
// place and carries no style.

import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import { assetUrl } from "../base.ts";
import type { GameState } from "../connection.ts";
import { DECK_BACK } from "../cards/Card.tsx";

export const MOTION_MS = 250;

type Event = GameState["events"][number];

interface Point {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

type Boxes = ReadonlyMap<string, Point>;

const cardKey = (instance: string) => `card:${instance}`;
const pileKey = (pile: string) => `pile:${pile}`;
const seatKey = (seat: number) => `seat:${String(seat)}`;

function boxOf(element: Element): Point {
  const { left, top, width, height } = element.getBoundingClientRect();
  return { left, top, width, height };
}

/** The element a card, pile or seat key names, as the table is now. */
function locate(root: HTMLElement, key: string): Element | null {
  const [kind, id = ""] = key.split(/:(.*)/s);
  const attribute = kind === "card" ? "data-card" : kind === "pile" ? "data-pile" : "data-seat";
  return root.querySelector(`[${attribute}="${CSS.escape(id)}"]`);
}

/** Where each card, pile and seat panel of the table is now. */
function measure(root: HTMLElement): Map<string, Point> {
  const boxes = new Map<string, Point>();
  const add = (key: string, element: Element) => {
    if (!boxes.has(key)) boxes.set(key, boxOf(element));
  };
  for (const element of root.querySelectorAll<HTMLElement>("[data-card]")) {
    add(cardKey(element.dataset["card"] ?? ""), element);
  }
  for (const element of root.querySelectorAll<HTMLElement>("[data-pile]")) {
    add(pileKey(element.dataset["pile"] ?? ""), element);
  }
  for (const element of root.querySelectorAll<HTMLElement>("[data-seat]")) {
    add(seatKey(Number(element.dataset["seat"])), element);
  }
  return boxes;
}

interface Move {
  /** The card that moves, or a Station that turns over. */
  readonly instance: string;
  readonly cardId: string;
  readonly from?: string;
  readonly to?: string;
  readonly turn?: boolean;
  /** The seat that acts: its panel stands in for a card with no box (a hidden hand). */
  readonly seat?: number;
  /** The card ends inside a scaled or clipped region: fly it as a ghost. */
  readonly fly?: boolean;
}

function asCard(value: unknown): { instance: string; cardId: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const { instance, cardId } = value as Record<string, unknown>;
  return typeof instance === "string" && typeof cardId === "string" ? { instance, cardId } : null;
}

/** What each event moves. Events with no card on the table give no move. */
function movesOf(event: Event): Move[] {
  const fields = event as unknown as Record<string, unknown>;
  const seat = typeof fields["seat"] === "number" ? fields["seat"] : null;
  const card = asCard(fields["card"]);
  switch (event.type) {
    case "card_drafted":
      return card === null || seat === null
        ? []
        : [{ ...card, seat, from: cardKey(card.instance), to: seatKey(seat) }];
    case "card_drawn":
      return seat === null
        ? []
        : [
            {
              instance: card?.instance ?? `drawn-${String(seat)}`,
              cardId: card?.cardId ?? DECK_BACK,
              seat,
              from: pileKey("deck"),
              to: seatKey(seat),
            },
          ];
    case "card_discarded":
    case "card_resold":
    case "agent_discarded":
    case "agent_played":
      return card === null || seat === null
        ? []
        : [{ ...card, seat, from: cardKey(card.instance), to: pileKey("discard") }];
    case "module_built":
      return card === null || seat === null
        ? []
        : [{ ...card, seat, from: cardKey(card.instance), to: seatKey(seat), fly: true }];
    case "station_flipped": {
      const flips = Array.isArray(fields["flips"]) ? (fields["flips"] as unknown[]) : [];
      return flips.flatMap((flip) => {
        const station = asCard((flip as Record<string, unknown> | null)?.["card"]);
        return station === null ? [] : [{ ...station, turn: true }];
      });
    }
    case "stations_exchanged":
    case "box_chosen":
    case "credits_changed":
    case "credits_lost":
    case "action_blocked":
    case "credits_stolen":
    case "deck_reshuffled":
    case "game_ended":
    case "game_started":
    case "hand_seen":
    case "influences_revealed":
    case "module_stolen":
    case "shuttles_arrived":
    case "supply_dealt":
    case "text_deferred":
    case "turn_started":
      return [];
  }
}

/** The inline style a motion sets; removed together when it ends. */
const PROPERTIES = ["transform", "transition", "will-change", "visibility"];

function start(element: HTMLElement, from: string, schedule: (run: () => void) => void) {
  element.style.setProperty("transform", from);
  element.style.setProperty("will-change", "transform");
  // Flush the start state so the transition has something to leave from.
  element.getBoundingClientRect();
  element.style.setProperty("transition", `transform ${String(MOTION_MS)}ms ease-out`);
  schedule(() => {
    element.style.setProperty("transform", "");
  });
}

function ghostOf(cardId: string, at: Point): HTMLElement {
  const ghost = document.createElement("span");
  ghost.dataset["motionGhost"] = "";
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${String(at.left)}px`,
    top: `${String(at.top)}px`,
    width: `${String(at.width)}px`,
    height: `${String(at.height)}px`,
    pointerEvents: "none",
    zIndex: "30",
  });
  const image = document.createElement("img");
  image.src = assetUrl(`cards/w240/${cardId}.webp`);
  image.alt = "";
  image.draggable = false;
  Object.assign(image.style, { width: "100%", height: "100%", borderRadius: "6px" });
  ghost.append(image);
  return ghost;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Move `ghost` from `from` to wherever `resolve` says the destination is, one
 * frame at a time. The destination is read every frame: layout that settles
 * during the move (the Base re-fits, the hand shrinks) moves it, and the ghost
 * follows. Fixed positioning keeps it clear of scaled and clipped parents.
 */
function fly(ghost: HTMLElement, from: Point, resolve: () => Point | null, frames: number[]): void {
  const startedAt = performance.now();
  let to = resolve() ?? from;
  const tick = () => {
    const t = Math.min(1, (performance.now() - startedAt) / MOTION_MS);
    const eased = 1 - (1 - t) * (1 - t);
    to = resolve() ?? to;
    Object.assign(ghost.style, {
      left: `${String(lerp(from.left, to.left, eased))}px`,
      top: `${String(lerp(from.top, to.top, eased))}px`,
      width: `${String(lerp(from.width, to.width, eased))}px`,
      height: `${String(lerp(from.height, to.height, eased))}px`,
    });
    if (t < 1) frames.push(window.requestAnimationFrame(tick));
  };
  frames.push(window.requestAnimationFrame(tick));
}

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Animate the cards that `events` moved. `events` is the latest update's
 * events: a new array each update. The first render and a reduced-motion
 * setting animate nothing.
 */
export function useCardMotion(root: RefObject<HTMLElement | null>, events: readonly Event[]) {
  const seen = useRef<readonly Event[]>(events);
  const boxes = useRef<Boxes>(new Map());
  const running = useRef<(() => void) | null>(null);
  const settling = useRef(0);

  // The boxes of the table before an update are those it settled into: layout
  // moves without a render (images load, the Base re-fits, the window resizes),
  // so keep them fresh while no card is moving.
  useLayoutEffect(() => {
    const element = root.current;
    if (element === null) return;
    const refresh = () => {
      if (running.current === null) boxes.current = measure(element);
    };
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    element.addEventListener("load", refresh, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(refresh);
    observer?.observe(element);
    for (const region of element.querySelectorAll("section")) observer?.observe(region);
    return () => {
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
      element.removeEventListener("load", refresh, true);
      observer?.disconnect();
      window.cancelAnimationFrame(settling.current);
    };
  }, [root]);

  useLayoutEffect(() => {
    const element = root.current;
    if (element === null) return;
    // After an update, and after its motion, take the boxes the layout settles into.
    const settle = () => {
      window.cancelAnimationFrame(settling.current);
      settling.current = window.requestAnimationFrame(() => {
        if (running.current === null) boxes.current = measure(element);
      });
    };
    if (events === seen.current) {
      // Not a new update: keep the old boxes while cards are still moving.
      if (running.current === null) boxes.current = measure(element);
      return;
    }
    seen.current = events;
    running.current?.();
    running.current = null;
    const next = measure(element);
    const before = boxes.current;
    boxes.current = next;
    settle();
    if (reducedMotion()) return;

    const touched: HTMLElement[] = [];
    const ghosts: HTMLElement[] = [];
    const frames: number[] = [];
    const schedule = (run: () => void) => {
      frames.push(window.requestAnimationFrame(run));
    };
    for (const move of events.flatMap(movesOf)) {
      const target = element.querySelector<HTMLElement>(
        `[data-card="${CSS.escape(move.instance)}"]`,
      );
      if (move.turn === true) {
        if (target !== null) {
          start(target, "scaleX(0)", schedule);
          touched.push(target);
        }
        continue;
      }
      // An opponent's hand card has no box: its seat panel is where it was.
      const from =
        before.get(move.from ?? "") ??
        (move.seat === undefined ? undefined : before.get(seatKey(move.seat)));
      const destination = move.to ?? "";
      // A card that is now drawn somewhere moves itself; one that is not
      // (a Discard, an opponent's hand) moves as a ghost to its pile or panel.
      const to = target === null ? next.get(destination) : next.get(cardKey(move.instance));
      if (from === undefined || to === undefined) continue;
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (dx === 0 && dy === 0) continue;
      if (target !== null && move.fly !== true) {
        start(target, `translate(${String(dx)}px, ${String(dy)}px)`, schedule);
        touched.push(target);
        continue;
      }
      const ghost = ghostOf(move.cardId, from);
      document.body.append(ghost);
      ghosts.push(ghost);
      if (target !== null) {
        // The real card waits, unseen, where it lands; the ghost arrives on it.
        target.style.setProperty("visibility", "hidden");
        touched.push(target);
      }
      fly(
        ghost,
        from,
        () => {
          const now =
            target !== null
              ? element.querySelector(`[data-card="${CSS.escape(move.instance)}"]`)
              : locate(element, destination);
          return now === null ? null : boxOf(now);
        },
        frames,
      );
    }
    if (touched.length === 0 && ghosts.length === 0) return;

    let timer = 0;
    const end = () => {
      window.clearTimeout(timer);
      for (const frame of frames) window.cancelAnimationFrame(frame);
      for (const moved of touched) {
        for (const property of PROPERTIES) moved.style.removeProperty(property);
        if (moved.getAttribute("style") === "") moved.removeAttribute("style");
      }
      for (const ghost of ghosts) ghost.remove();
      if (running.current === end) {
        running.current = null;
        settle();
      }
    };
    running.current = end;
    timer = window.setTimeout(end, MOTION_MS + 30);
  });

  useLayoutEffect(
    () => () => {
      running.current?.();
      running.current = null;
    },
    [],
  );
}
