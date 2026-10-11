import { cardById, type SupplyEffect } from "../catalogue.ts";
import type { EventCard } from "../events.ts";
import type { GameState } from "../state.ts";

/** R10.3: derive effects from the current Supply, never from stored flags. */
export function supplyEffects(
  state: GameState,
): readonly { readonly card: EventCard; readonly effect: SupplyEffect }[] {
  return state.supply.flatMap((instance) => {
    const card = cardById(state.cards[instance]);
    return card.type === "influence" && card.supply_effect
      ? [{ card: { instance, cardId: card.id }, effect: card.supply_effect }]
      : [];
  });
}
