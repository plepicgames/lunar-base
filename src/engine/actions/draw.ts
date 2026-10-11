import type { GameEvent } from "../events.ts";
import { pop } from "../loop.ts";
import { shuffle } from "../rng.ts";
import { supplyEffects } from "../influences/supply.ts";
import { moveCard } from "../zones.ts";
import type { ActionHandler } from "./index.ts";

/** R7.6 / R8.7: reshuffle only when needed, then move one top Deck card. */
export const draw: ActionHandler = (state, { seat }) => {
  const events: GameEvent[] = [];
  let ready = state;
  if (ready.deck.length === 0 && ready.discard.length > 0) {
    const shuffled = shuffle(ready.rng, ready.discard);
    ready = { ...ready, deck: shuffled.list, discard: [], rng: shuffled.state };
    events.push({ type: "deck_reshuffled", count: shuffled.list.length });
  }
  const instance = ready.deck.at(0);
  if (instance === undefined) return { state: pop(ready) };
  const transparency = supplyEffects(ready).some(
    ({ effect }) => "rule" in effect && effect.rule === "deck_face_up_discard_face_down",
  );
  events.push({
    type: "card_drawn",
    seat,
    card: { instance, cardId: ready.cards[instance] },
    ...(transparency ? { cardAudience: "all" as const } : {}),
  });
  return { state: pop(moveCard(ready, instance, "deck", { hand: seat })), events };
};
