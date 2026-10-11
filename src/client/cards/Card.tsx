// A card drawn from its catalogue id, or the Deck back (architecture,
// Material). The images carry the print trim and no rounding, so CSS rounds
// the corners from the width.

import type { CSSProperties } from "react";
import { assetUrl } from "../base.ts";
import { cardName } from "../cards.ts";
import styles from "./Card.module.css";

/** The id of the Deck back image. */
export const DECK_BACK = "back-deck";

export type Turns = 0 | 1 | 2 | 3;

export interface CardProps {
  /** A catalogue id, or `back-deck` for the Deck back. */
  readonly cardId: string;
  /** Width in pixels; the card is twice as tall. */
  readonly width: number;
  /** Quarter turns clockwise, 0 to 3. */
  readonly turns?: Turns;
}

export function cardLabel(cardId: string): string {
  return cardId === DECK_BACK ? "Deck back" : cardName(cardId);
}

export function Card({ cardId, width, turns = 0 }: CardProps) {
  const degrees = turns * 90;
  const style = {
    "--card-width": `${String(width)}px`,
    transform: degrees === 0 ? undefined : `rotate(${String(degrees)}deg)`,
  } as CSSProperties;
  return (
    <span className={styles.card} style={style} data-rotation={degrees}>
      <img
        className={styles.image}
        src={assetUrl(`cards/w240/${cardId}.webp`)}
        alt={cardLabel(cardId)}
        draggable={false}
      />
    </span>
  );
}
