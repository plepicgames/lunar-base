// The options of a pending decision that point at a card (rules, section 13).
// The engine names the card of each option; the client only looks it up.

import type { GameView } from "../../protocol/messages.ts";

/** D1 play an Agent, D4 Draft, D5 Discard and D8 Resell pick a card. */
const CARD_KINDS: ReadonlySet<string> = new Set(["agent", "draft", "discard", "resell"]);

export interface CardOption {
  readonly decision: string;
  readonly option: string;
  readonly label: string;
}

type Pending = NonNullable<GameView["pending"]>;
type Asked = Extract<Pending, { options: unknown }>;

/** Your pending decision when it asks you, else null. */
export function yourDecision(view: GameView): Asked | null {
  const { pending } = view;
  return pending !== null && "options" in pending && pending.seat === view.you ? pending : null;
}

/** The card instance an option points at, or null for an option without a card. */
export function optionCard(kind: string, option: Asked["options"][number]): string | null {
  const { card } = option;
  return CARD_KINDS.has(kind) && typeof card === "string" ? card : null;
}

/** Card instance to the option that picks it. Empty unless you are the one deciding. */
export function cardOptions(view: GameView): ReadonlyMap<string, CardOption> {
  const result = new Map<string, CardOption>();
  const pending = yourDecision(view);
  if (pending === null) return result;
  for (const option of pending.options) {
    const card = optionCard(pending.kind, option);
    if (card !== null) {
      result.set(card, { decision: pending.id, option: option.id, label: option.label });
    }
  }
  return result;
}

/** The catalogue id of a card instance anywhere the view shows one, or null. */
export function cardIdOf(view: GameView, instance: string): string | null {
  const bases = view.players.flatMap(({ base }) => [base.station, ...base.modules]);
  const places = [...bases, ...view.hand, ...view.supply, ...view.play, ...view.discard];
  return places.find((card) => card.instance === instance)?.cardId ?? null;
}

/**
 * The ids of your options that no control on the table carries: a card that is
 * neither in your hand nor in Supply, a target without a seat, a Module that is
 * in no Base. The decision bar lists them, so every option can be reached.
 */
export function strandedOptions(view: GameView): ReadonlySet<string> {
  const pending = yourDecision(view);
  const stranded = new Set<string>();
  if (pending === null) return stranded;
  const shown = new Set([...view.hand, ...view.supply].map((card) => card.instance));
  const seatOf = (option: Asked["options"][number]) =>
    typeof option.target === "number" ? option.target : null;
  for (const option of pending.options) {
    const { card } = option;
    if (CARD_KINDS.has(pending.kind)) {
      if (typeof card === "string" && !shown.has(card)) stranded.add(option.id);
    } else if (pending.kind === "target") {
      const seat = seatOf(option);
      if (seat === null || !view.players.some((player) => player.seat === seat)) {
        stranded.add(option.id);
      }
    } else if (pending.kind === "steal_module") {
      const seat = seatOf(option);
      const owner = view.players.find((player) => player.seat === seat);
      const held = owner?.base.modules.some((module) => module.instance === card) === true;
      if (!held) stranded.add(option.id);
    }
  }
  return stranded;
}
