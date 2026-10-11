// R7.15 / R7.16 / R12.5: remember the opponent for this text's later actions.
import { cardById } from "../catalogue.ts";
import { ask } from "../decisions.ts";
import { isTextFrame, pop, push } from "../loop.ts";
import type { Frame, GameState, Seat } from "../state.ts";
import { discardCard } from "./discard.ts";
import type { ActionHandler } from "./index.ts";

/** Choice boxes inherit their source; an immediate Influence owns its own target. */
function sourceFrame(state: GameState, seat: Seat): Frame {
  const source = state.stack.findLast(
    (frame) =>
      frame.kind === "agent" ||
      (isTextFrame(frame) && (typeof frame.card === "string" || typeof frame.source === "string")),
  );
  if (!source || source.seat !== seat) throw new Error("Look action requires its acting text");
  return source;
}

export const lookAtOpponentHand: ActionHandler = (state, { seat }, answer) => {
  if (answer === null) {
    return {
      state: ask(state, {
        seat,
        kind: "target",
        options: state.hands.flatMap((_, target) =>
          target === seat
            ? []
            : [
                {
                  id: String(target),
                  label: `Look at Player ${String(target + 1)}'s hand`,
                  target,
                },
              ],
        ),
      }),
    };
  }
  const opponent = answer.option.target as Seat;
  const source = sourceFrame(state, seat);
  return {
    state: pop({
      ...state,
      stack: state.stack.map((frame) => (frame.id === source.id ? { ...frame, opponent } : frame)),
    }),
    events: [
      {
        type: "hand_seen",
        looker: seat,
        opponent,
        cards: state.hands[opponent].map((instance) => ({
          instance,
          cardId: state.cards[instance],
        })),
      },
    ],
  };
};

export const thatOpponentDiscards: ActionHandler = (state, { action, seat }) => {
  if (action.op !== "that_opponent_discards") throw new Error("Expected that_opponent_discards");
  const opponent = sourceFrame(state, seat).opponent;
  if (typeof opponent !== "number") throw new Error("Text has no looked-at opponent");
  return {
    state: push(pop(state), "box", {
      seat: opponent,
      defenceCovered: true,
      actions: [{ op: "discard", n: action.n }],
      position: 0,
      repeated: 0,
      deferred: [],
    }),
  };
};

/** R12.5: the opponent chooses the order, one Agent at a time; other cards stay. */
export const thatOpponentDiscardsAllAgents: ActionHandler = (state, { seat }, answer) => {
  const opponent = sourceFrame(state, seat).opponent;
  if (typeof opponent !== "number") throw new Error("Text has no looked-at opponent");
  if (answer !== null) return discardCard(state, opponent, answer.option.id);
  const agents = state.hands[opponent].filter(
    (card) => cardById(state.cards[card]).type === "agent",
  );
  if (agents.length === 0) return { state: pop(state) };
  return {
    state: ask(state, {
      seat: opponent,
      kind: "discard",
      options: agents.map((card) => ({
        id: card,
        card,
        label: `Discard ${cardById(state.cards[card]).name}`,
      })),
    }),
  };
};
