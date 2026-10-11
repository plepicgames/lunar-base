import { orbsOf } from "../base.ts";
import { cardById } from "../catalogue.ts";
import { ask } from "../decisions.ts";
import { pushImmediate } from "../influences/immediate.ts";
import { supplyEffects } from "../influences/supply.ts";
import { pop, update } from "../loop.ts";
import { canPay, priceOf } from "../price.ts";
import { moveCard } from "../zones.ts";
import type { ActionFrame, ActionHandler } from "./index.ts";

type DraftFrame = ActionFrame & { readonly paid?: string };

/** R7.4 / D4: pay any R12.6 cost, then move one Supply card into the hand. */
export const draft: ActionHandler = (state, frame, answer) => {
  const { seat, paid } = frame as DraftFrame;
  const supply = supplyEffects(state);
  const quarantine = supply.find(
    ({ effect }) => "rule" in effect && effect.rule === "forbid_draft_other_influences",
  );
  if (paid === undefined) {
    // Combine printed costs before applying Orbs so a wild Orb is used only once.
    const cost = supply.flatMap(({ effect }) =>
      "rule" in effect && effect.rule === "draft_influence_extra_cost" ? effect.cost : [],
    );
    const price = priceOf(
      cost,
      orbsOf(state.bases[seat], (id) => cardById(state.cards[id])),
    );
    const cards = state.supply.filter(
      (instance) =>
        cardById(state.cards[instance]).type !== "influence" ||
        ((quarantine === undefined || instance === quarantine.card.instance) &&
          canPay(price, state.credits[seat])),
    );
    if (cards.length === 0) return { state: pop(state) };
    if (answer === null) {
      return {
        state: ask(state, {
          seat,
          kind: "draft",
          options: cards.map((card) => {
            const definition = cardById(state.cards[card]);
            return {
              id: card,
              card,
              label: `Draft ${definition.name}${definition.type === "influence" ? `, pay ${String(price)}` : ""}`,
              ...(definition.type === "influence" ? { price } : {}),
            };
          }),
        }),
      };
    }
    if (cardById(state.cards[answer.option.id]).type === "influence" && price > 0) {
      const credits = state.credits[seat] - price;
      const paying = update(state, { ...frame, paid: answer.option.id });
      return {
        state: {
          ...paying,
          credits: state.credits.map((old, index) => (index === seat ? credits : old)),
        },
        events: [{ type: "credits_changed", seat, delta: -price, credits }],
      };
    }
  }
  const instance = paid ?? answer?.option.id;
  if (instance === undefined) throw new Error("Expected a chosen Draft card");
  // R10.9: capture the Supply before moving the card, so it can trigger itself.
  const effects =
    cardById(state.cards[instance]).type === "influence"
      ? supply.flatMap(({ card, effect }) =>
          "when" in effect && effect.when === "any_player_drafts_influence"
            ? [{ card: card.instance, seat, actions: effect.then }]
            : [],
        )
      : [];
  return {
    state: pushImmediate(pop(moveCard(state, instance, "supply", { hand: seat })), effects),
    events: [{ type: "card_drafted", seat, card: { instance, cardId: state.cards[instance] } }],
  };
};
