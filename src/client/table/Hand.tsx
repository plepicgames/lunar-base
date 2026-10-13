// Your hand as overlapping cards in a fan (architecture, Behaviour). The
// cards share the width of the region: they overlap more as the hand grows,
// and the hovered or focused card rises. A card that an option of the pending
// decision points at glows and is that option's button; a Module the Build
// decision offers glows too and is the button that picks it.

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { GameView } from "../../protocol/messages.ts";
import { ZoomCard } from "../cards/Zoom.tsx";
import styles from "./Hand.module.css";

export const HAND_CARD_WIDTH = 110;
const GAP = 8;

/**
 * In a window of 800 px or less in height the hand is drawn smaller, so that
 * Supply, Base, decision and hand lie one above the other without overlapping
 * at 1280 x 720 and 1024 x 768. Supply is a small strip: the room goes to the
 * Base. Only a window at least 1440 px wide and more than 850 px high has
 * the room for Supply cards half as big again, with nine of them and the two
 * piles still in one row. The zoom view shows the full card.
 */
const SHORT_WINDOW = "(max-height: 800px)";
const ROOMY_WINDOW = "(min-width: 1440px) and (min-height: 851px)";
const SUPPLY_CARD_WIDTH = 44;
const COMPACT_WIDTHS = { hand: 64, supply: SUPPLY_CARD_WIDTH } as const;
const FULL_WIDTHS = { hand: HAND_CARD_WIDTH, supply: SUPPLY_CARD_WIDTH } as const;
const ROOMY_WIDTHS = { hand: HAND_CARD_WIDTH, supply: 66 } as const;

type CardWidths = { readonly hand: number; readonly supply: number };

function subscribeWindow(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const queries = [SHORT_WINDOW, ROOMY_WINDOW].map((query) => window.matchMedia(query));
  for (const query of queries) query.addEventListener("change", onChange);
  return () => {
    for (const query of queries) query.removeEventListener("change", onChange);
  };
}

function cardWidths(): CardWidths {
  if (typeof window.matchMedia !== "function") return FULL_WIDTHS;
  if (window.matchMedia(SHORT_WINDOW).matches) return COMPACT_WIDTHS;
  return window.matchMedia(ROOMY_WINDOW).matches ? ROOMY_WIDTHS : FULL_WIDTHS;
}

/** The width of a card in the hand and in Supply for this window. */
export function useCardWidths(): CardWidths {
  return useSyncExternalStore(subscribeWindow, cardWidths, () => FULL_WIDTHS);
}

/** The distance between the left edges of neighbours so `count` cards fit `width`. */
export function fanStep(count: number, width: number, cardWidth: number): number {
  if (count < 2) return 0;
  const spread = (width - cardWidth) / (count - 1);
  return Math.max(0, Math.min(cardWidth + GAP, spread));
}

/** What pressing a card of the hand does while a decision points at it. */
export interface HandAction {
  /** The accessible name of the card's button. */
  readonly label: string;
  readonly onPress: () => void;
  /** Set for a card that is picked and stays picked: true for the one chosen. */
  readonly pressed?: boolean;
}

interface HandProps {
  readonly cards: GameView["hand"];
  /** Card instance to its action. A card without one only opens its zoom view. */
  readonly actions: ReadonlyMap<string, HandAction>;
  /** The width of a card; the fan is twice as tall. */
  readonly cardWidth?: number;
}

export function Hand({ cards, actions, cardWidth = HAND_CARD_WIDTH }: HandProps) {
  const region = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = region.current;
    if (element === null) return;
    const measure = () => {
      setWidth(element.clientWidth);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Before the first measure the region has no width: lay the cards out loose.
  const step = width === 0 ? cardWidth + GAP : fanStep(cards.length, width, cardWidth);
  const total = cards.length === 0 ? 0 : cardWidth + step * (cards.length - 1);
  const start = Math.max(0, (width - total) / 2);

  return (
    <section ref={region} aria-label="Your hand" className={styles.hand}>
      <ul className={styles.fan} style={{ height: cardWidth * 2 }}>
        {cards.map((card, index) => {
          const action = actions.get(card.instance);
          return (
            <li
              key={card.instance}
              className={styles.slot}
              data-instance={card.instance}
              style={{ left: start + step * index, width: cardWidth }}
            >
              <ZoomCard
                cardId={card.cardId}
                instance={card.instance}
                width={cardWidth}
                actionLabel={action?.label}
                pressed={action?.pressed}
                onPress={action?.onPress}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
