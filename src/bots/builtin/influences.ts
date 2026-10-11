import {
  catalogue,
  priceOf,
  type ActionDef,
  type CardDef,
  type DecisionOption,
  type ViewPlayer,
} from "../../engine/index.ts";
import type { DecisionRequest } from "../maker.ts";

const cards = new Map(catalogue.map((card) => [card.id, card]));
const WIN = 1_000_000;
type Held = readonly (CardDef | undefined)[];

/** Shallow Influence evaluation; unknown draws have generic card value, never identities. */
export function influenceScorer(
  request: DecisionRequest,
  own: ViewPlayer,
  cardValue: (card: CardDef) => number,
  flipValue: (player: ViewPlayer) => number,
) {
  const { view, seat } = request;
  const hand = view.hand.map((card) => cards.get(card.cardId));
  const supply = view.supply.flatMap((card) => cards.get(card.cardId) ?? []);
  const count = (hand: Held) => hand.filter((card) => card?.type === "influence").length;
  const collection = (n: number) => [0, 6, 15, 36, 250][Math.min(4, n)];
  const loss = (card: CardDef | undefined, held: Held) =>
    card?.type === "influence"
      ? collection(count(held)) - collection(count(held) - 1)
      : card
        ? cardValue(card)
        : 3;
  const blockedSteal = (supply: readonly CardDef[]) =>
    supply.some((card) => {
      const effect = card.supply_effect;
      return effect && "rule" in effect && effect.rule === "forbid_steal_credits";
    });

  function effects(
    actions: readonly ActionDef[],
    held: Held,
    remainingSupply = supply,
    actor = seat,
    depth = 0,
    startingCredits?: number,
  ): { value: number; hand: Held } {
    let value = 0;
    let current = [...held];
    let credits =
      startingCredits ?? view.players.find((player) => player.seat === actor)?.credits ?? 0;
    let available = view.deck + view.discardCount;
    for (const action of actions) {
      if (action.op === "draw") {
        const n = Math.min(action.n, available);
        available -= n;
        current.push(...Array.from<undefined>({ length: n }));
        value += n * 3;
      } else if (action.op === "discard" || action.op === "discard_hand") {
        const n = action.op === "discard_hand" ? current.length : action.n;
        for (let i = 0; i < n && current.length; i++) {
          let best = -Infinity;
          let selected = 0;
          for (let j = 0; j < current.length; j++) {
            const card = current[j];
            const rest = current.filter((_, index) => index !== j);
            // Nested Cascades can recycle forever in the engine; bound this heuristic.
            const immediate =
              depth < 2
                ? effects(card?.on_discard ?? [], rest, remainingSupply, actor, depth + 1).value
                : 0;
            const candidate = immediate - loss(card, current);
            if (candidate > best) {
              best = candidate;
              selected = j;
            }
          }
          const [discarded] = current.splice(selected, 1);
          value += best;
          if (depth < 2)
            current = [
              ...effects(discarded?.on_discard ?? [], current, remainingSupply, actor, depth + 1)
                .hand,
            ];
        }
      } else if (action.op === "steal_credits" && !blockedSteal(remainingSupply)) {
        const gained = Math.min(
          action.n,
          Math.max(
            0,
            ...view.players
              .filter((player) => player.seat !== actor)
              .map((player) => player.credits),
          ),
        );
        value += gained * 3;
        credits += gained;
        if (gained > 0 && credits >= view.targets.credits) return { value: WIN, hand: current };
      } else if (action.op === "flip") {
        const targets =
          action.who === "all_to_terran_outpost"
            ? view.players.filter((player) => player.base.station.side === "named")
            : action.who === "own"
              ? view.players.filter((player) => player.seat === actor)
              : view.players;
        // Flip value is already relative to the maker, unlike the other effects.
        value +=
          targets.reduce((sum, player) => sum + flipValue(player), 0) * (actor === seat ? 1 : -1);
      }
    }
    return { value, hand: current };
  }

  function discard(card: CardDef): number {
    const index = hand.findIndex((held) => held?.id === card.id);
    const remaining = hand.filter((_, i) => i !== index);
    const immediate = effects(card.on_discard ?? [], remaining).value;
    const preserveWin = card.type === "influence" && count(hand) === 4 && view.turn.seat === seat;
    return immediate - (preserveWin ? WIN : loss(card, hand));
  }

  const draftPrice = priceOf(
    supply.flatMap((card) => {
      const effect = card.supply_effect;
      return effect && "rule" in effect && effect.rule === "draft_influence_extra_cost"
        ? effect.cost
        : [];
    }),
    own.base.orbs,
  );
  function gain(card: CardDef): number {
    return card.type === "influence"
      ? collection(count(hand) + 1) - collection(count(hand))
      : cardValue(card);
  }
  function canDraft(card: CardDef, credits = own.credits): boolean {
    if (card.type !== "influence") return true;
    const quarantine = supply.find(
      (source) =>
        source.supply_effect &&
        "rule" in source.supply_effect &&
        source.supply_effect.rule === "forbid_draft_other_influences",
    );
    return draftPrice <= credits && (!quarantine || quarantine.id === card.id);
  }
  function draft(card: CardDef, price = draftPrice, credits = own.credits): number {
    if (card.type !== "influence") return cardValue(card);
    const afterSupply = supply.filter((source) => source.id !== card.id);
    const actions = supply.flatMap((source) => {
      const effect = source.supply_effect;
      return effect && "when" in effect && effect.when === "any_player_drafts_influence"
        ? effect.then
        : [];
    });
    return (
      gain(card) -
      price * 3 +
      effects(actions, [...hand, card], afterSupply, seat, 0, credits - price).value
    );
  }

  function defence(option: DecisionOption, card: CardDef | undefined): number {
    if (option.id === "decline" || !card) return 0;
    const action = option.action as ActionDef | undefined;
    const actor = view.players.find((player) => player.seat === option.actor);
    let danger = 0;
    let losesWin = false;
    let losesInfluences = false;
    if (action?.op === "steal_credits") {
      const lost = Math.min(action.n, own.credits);
      losesWin =
        lost > 0 &&
        actor !== undefined &&
        actor.seat !== seat &&
        actor.credits + lost >= view.targets.credits;
      if (lost >= 3) danger = 1_000;
    } else if (action?.op === "steal_module") danger = 1_000;
    else if (action?.op === "flip") {
      const harm = -flipValue(own);
      if (harm > 0) danger = harm;
      const before = cards.get(own.base.station.cardId);
      const after = cards.get(
        own.base.station.side === "named" ? "stn-terran-outpost" : (own.base.station.named ?? ""),
      );
      if (before && after) {
        const icons = new Set(
          own.base.modules.flatMap((module) => cards.get(module.cardId)?.achievements ?? []),
        );
        const afterIcons = new Set([...icons, ...after.achievements]).size;
        losesWin =
          (own.colonists >= view.targets.colonists &&
            own.colonists + after.colonists - before.colonists < view.targets.colonists) ||
          (own.achievements.length >= view.targets.achievements &&
            afterIcons < view.targets.achievements);
      }
    } else if (
      action &&
      [
        "discard",
        "discard_hand",
        "target_discards",
        "that_opponent_discards",
        "each_opponent_discards",
      ].includes(action.op)
    ) {
      const n = "n" in action ? action.n : hand.length;
      const declining = effects([{ op: "discard", n }], hand);
      losesInfluences = count(declining.hand) < count(hand);
      losesWin = count(hand) >= 4 && count(declining.hand) < 4;
      danger = -declining.value;
    }
    if (losesWin) return WIN * 2 + discard(card);
    const fourthInReach =
      count(hand) === 3 &&
      supply.some((card) => card.type === "influence" && canDraft(card) && draft(card) > 100);
    if ((fourthInReach && !losesInfluences) || count(hand) >= 4) return -WIN;
    return danger + discard(card) - 1;
  }

  function order(option: DecisionOption): number {
    if (!Array.isArray(option.actions) || typeof option.actor !== "number") return 0;
    const actor = option.actor;
    const held =
      actor === seat
        ? hand
        : Array.from<undefined>({
            length: view.players.find((player) => player.seat === actor)?.handSize ?? 0,
          });
    const value = effects(option.actions as readonly ActionDef[], held, supply, actor).value;
    return actor === seat ? value : -value;
  }

  return { draft, canDraft, gain, discard, defence, order };
}
