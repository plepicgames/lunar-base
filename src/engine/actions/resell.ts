import { cardById } from "../catalogue.ts";
import { ask } from "../decisions.ts";
import { pop, push } from "../loop.ts";
import { moveCard } from "../zones.ts";
import type { ActionHandler } from "./index.ts";

/** R7.9 / D8: one Agent or Module is Resold; its Credit is part of the same step. */
export const resell: ActionHandler = (state, { seat }, answer) => {
  const cards = state.supply.filter((card) => {
    const { type } = cardById(state.cards[card]);
    return type === "agent" || type === "module";
  });
  if (cards.length === 0) return { state: pop(state) };
  if (answer === null) {
    return {
      state: ask(state, {
        seat,
        kind: "resell",
        options: cards.map((card) => ({
          id: card,
          card,
          label: `Resell ${cardById(state.cards[card]).name}`,
        })),
      }),
    };
  }
  const instance = answer.option.id;
  const credits = state.credits[seat] + 1;
  const moved = moveCard(state, instance, "supply", "discard");
  return {
    state: pop({
      ...moved,
      credits: moved.credits.map((old, index) => (index === seat ? credits : old)),
    }),
    events: [
      { type: "card_resold", seat, card: { instance, cardId: state.cards[instance] }, credits: 1 },
    ],
  };
};

/** R7.18: capture the count now; each Resell remains a separate step (R8.5). */
export const resellPerSupplyInfluence: ActionHandler = (state, { seat }) => {
  const n = state.supply.filter((card) => cardById(state.cards[card]).type === "influence").length;
  if (n === 0) return { state: pop(state) };
  return {
    state: push(pop(state), "box", {
      seat,
      actions: [{ op: "resell", n }],
      position: 0,
      repeated: 0,
      deferred: [],
    }),
  };
};
