import { cardById, type ActionDef } from "../catalogue.ts";
import { ask } from "../decisions.ts";
import { pop, push, update, type FrameHandler } from "../loop.ts";
import type { CardInstanceId, Frame, GameState, Seat } from "../state.ts";

/** The public source and the seat that resolves its triggered text. */
export type ImmediateEffect = {
  readonly card: CardInstanceId;
  readonly seat: Seat;
  readonly actions: readonly ActionDef[];
};

type ImmediateFrame = Frame & { readonly effects: readonly ImmediateEffect[] };

function pushEffect(state: GameState, effect: ImmediateEffect): GameState {
  return push(state, "box", { ...effect, position: 0, repeated: 0, deferred: [] });
}

/** R8.4: interrupt everything waiting; D13 orders effects triggered together. */
export function pushImmediate(state: GameState, effects: readonly ImmediateEffect[]): GameState {
  if (effects.length === 0) return state;
  if (effects.length === 1) return pushEffect(state, effects[0]);
  return push(state, "immediate", { effects });
}

/** Choose the next whole text, then resume ordering after it and its interrupts finish. */
export const immediate: FrameHandler = (state, frame, answer) => {
  const { effects } = frame as ImmediateFrame;
  if (effects.length === 0) return { state: pop(state) };
  if (effects.length === 1) return { state: pushEffect(pop(state), effects[0]) };
  if (answer === null) {
    return {
      state: ask(state, {
        seat: state.turn.seat,
        kind: "order",
        options: effects.map(({ card, seat, actions }, index) => ({
          id: String(index),
          card,
          actor: seat,
          actions,
          label: `Resolve ${cardById(state.cards[card]).name} next`,
        })),
      }),
    };
  }
  const selected = Number(answer.option.id);
  const remaining = effects.filter((_, index) => index !== selected);
  return {
    state: pushEffect(update(state, { ...frame, effects: remaining }), effects[selected]),
  };
};
