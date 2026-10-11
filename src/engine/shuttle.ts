import { orbsOf } from "./base.ts";
import { cardById } from "./catalogue.ts";
import type { EventCard, GameEvent } from "./events.ts";
import { supplyEffects } from "./influences/supply.ts";
import { pop, push, type FrameHandler } from "./loop.ts";
import { shuffle } from "./rng.ts";
import { moveCard } from "./zones.ts";

/**
 * R4.7 / R4.8: inspect the Supply once and pay every Base in one step.
 * The loop's afterStep hook sees `shuttle_step` for the end-of-turn check
 * (T017), including when no Shuttle arrives. Only a surviving game reaches
 * the deal frame; its presence remembers arrival without a second check.
 */
export const shuttleStep: FrameHandler = (state) => {
  const blocked = state.supply.some((instance) => {
    const type = cardById(state.cards[instance]).type;
    return type === "module" || type === "agent";
  });
  if (blocked) return { state: pop(state) };
  const embargo = supplyEffects(state).some(
    ({ effect }) => "rule" in effect && effect.rule === "no_shuttle_credits",
  );
  // R9.6 / Q21: one or more Intellects add red to the paying colours for everyone.
  const redPays = state.bases.some((base) =>
    base.modules.some(({ card }) =>
      cardById(state.cards[card]).passive?.some(({ op }) => op === "shuttle_red_orbs_pay"),
    ),
  );
  const gains = state.bases.map((base, seat) => {
    const orbs = orbsOf(base, (instance) => cardById(state.cards[instance]));
    const delta = embargo ? 0 : orbs.yellow + orbs.wild + (redPays ? orbs.red : 0);
    return { seat, delta, credits: state.credits[seat] + delta };
  });
  return {
    state: push({ ...pop(state), credits: gains.map((gain) => gain.credits) }, "shuttle_deal"),
    events: [{ type: "shuttles_arrived", seat: state.turn.seat, turn: state.turn.number, gains }],
  };
};

/** R4.9 / R8.7: append 3 + N cards, reshuffling only when another card is needed. */
export const shuttleDeal: FrameHandler = (state) => {
  let next = state;
  const cards: EventCard[] = [];
  const events: GameEvent[] = [];
  for (let count = 0; count < 3 + state.config.seats; count += 1) {
    if (next.deck.length === 0 && next.discard.length > 0) {
      const shuffled = shuffle(next.rng, next.discard);
      next = { ...next, deck: shuffled.list, discard: [], rng: shuffled.state };
      events.push({ type: "deck_reshuffled", count: shuffled.list.length });
    }
    const instance = next.deck.at(0);
    if (instance === undefined) break;
    cards.push({ instance, cardId: next.cards[instance] });
    next = moveCard(next, instance, "deck", "supply");
  }
  if (cards.length > 0) events.push({ type: "supply_dealt", cards });
  return { state: pop(next), events };
};
