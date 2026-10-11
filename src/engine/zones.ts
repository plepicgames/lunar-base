import type { CardInstanceId, GameState, Seat } from "./state.ts";

/** A loose-card zone, or the hand of a seat. Base placement has its own rules. */
export type Zone = "deck" | "discard" | "supply" | "play" | { readonly hand: Seat };

function cardsIn(state: GameState, zone: Zone): readonly CardInstanceId[] {
  return typeof zone === "string" ? state[zone] : state.hands[zone.hand];
}

function replace(state: GameState, zone: Zone, cards: readonly CardInstanceId[]): GameState {
  return typeof zone === "string"
    ? { ...state, [zone]: cards }
    : { ...state, hands: state.hands.map((hand, seat) => (seat === zone.hand ? cards : hand)) };
}

/** Remove one instance, preserving order, and append it to its destination. */
export function moveCard(state: GameState, card: CardInstanceId, from: Zone, to: Zone): GameState {
  const source = cardsIn(state, from);
  const index = source.indexOf(card);
  if (index < 0) throw new Error(`Card ${card} is not in the source zone`);
  const removed = replace(state, from, [...source.slice(0, index), ...source.slice(index + 1)]);
  return replace(removed, to, [...cardsIn(removed, to), card]);
}
