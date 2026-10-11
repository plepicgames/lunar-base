import { cardById } from "../catalogue.ts";
import { ask } from "../decisions.ts";
import { pushImmediate } from "../influences/immediate.ts";
import { pop, update, type Step } from "../loop.ts";
import type { CardInstanceId, GameState, Seat } from "../state.ts";
import { supplyEffects } from "../influences/supply.ts";
import { moveCard } from "../zones.ts";
import type { ActionFrame, ActionHandler } from "./index.ts";

/** D5: the seat chooses one of `cards`, which are in its hand. */
function askDiscard(state: GameState, seat: Seat, cards: readonly CardInstanceId[]): GameState {
  return ask(state, {
    seat,
    kind: "discard",
    options: cards.map((card) => ({
      id: card,
      card,
      label: `Discard ${cardById(state.cards[card]).name}`,
    })),
  });
}

/** One card from the seat's hand to the Discard pile: one step (R8.5). */
export function discardCard(state: GameState, seat: Seat, instance: CardInstanceId): Step {
  const card = cardById(state.cards[instance]);
  const hidden =
    card.type !== "influence" &&
    supplyEffects(state).some(
      ({ effect }) => "rule" in effect && effect.rule === "deck_face_up_discard_face_down",
    );
  const moved = moveCard(state, instance, { hand: seat }, "discard");
  const actions = card.type === "influence" ? (card.on_discard ?? []) : [];
  return {
    state: pushImmediate(moved, actions.length ? [{ card: instance, seat, actions }] : []),
    events: [
      {
        type: "card_discarded",
        seat,
        card: { instance, cardId: state.cards[instance] },
        ...(hidden ? { cardAudience: "seat" as const } : {}),
      },
    ],
  };
}

/** R7.5 / D5: the discarding seat chooses from its own hand. */
export const discard: ActionHandler = (state, { seat }, answer) => {
  const hand = state.hands[seat];
  if (hand.length === 0) return { state: pop(state) };
  if (answer === null) return { state: askDiscard(state, seat, hand) };
  return discardCard(pop(state), seat, answer.option.id);
};

/** The `action` frame of Discard all. It holds `set`, the hand as the action found it. */
type DiscardHandFrame = ActionFrame & { readonly set?: readonly CardInstanceId[] };

/**
 * R7.17: the hand at the first step is the set. Each answer Discards one card
 * and the frame stays, so D5 is asked again over the cards of the set still
 * in hand, in hand order. A card that came later is never offered; a card of
 * the set that left the hand is not waited for.
 */
export const discardHand: ActionHandler = (state, frame, answer) => {
  const { seat } = frame;
  if (answer !== null) return discardCard(state, seat, answer.option.id);
  const hand = state.hands[seat];
  const set = (frame as DiscardHandFrame).set ?? hand;
  const left = hand.filter((card) => set.includes(card));
  if (left.length === 0) return { state: pop(state) };
  return { state: askDiscard(update(state, { ...frame, set }), seat, left) };
};
