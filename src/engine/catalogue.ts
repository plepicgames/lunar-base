import source from "../../docs/design/cards.json" with { type: "json" };

export type Colour = "red" | "blue" | "yellow" | "gray";
export type HalfOrbSlot = "T" | "RU" | "RL" | "B" | "LL" | "LU";
export type FlipWho =
  | "own"
  | "any_one"
  | "any_two"
  | "any_number"
  | "neighbours_of_target"
  | "each_player"
  | "all_to_terran_outpost";

type CountedOp =
  | "draft"
  | "draw"
  | "discard"
  | "build"
  | "resell"
  | "opponent_resells"
  | "each_player_loses_credits"
  | "steal_credits"
  | "target_discards"
  | "each_opponent_discards"
  | "that_opponent_discards";
type SimpleOp =
  | "gain_credit_per_hand_card"
  | "look_at_opponent_hand"
  | "discard_hand"
  | "resell_per_supply_influence"
  | "shuttle_red_orbs_pay"
  | "exchange_station"
  | "neighbours_exchange_stations"
  | "that_opponent_discards_all_agents";

export type ActionDef =
  | { [Op in CountedOp]: { readonly op: Op; readonly n: number } }[CountedOp]
  | { [Op in SimpleOp]: { readonly op: Op } }[SimpleOp]
  | { readonly op: "flip"; readonly who: FlipWho }
  | { readonly op: "steal_module"; readonly kind: string }
  | { readonly op: "choose_one"; readonly options: readonly (readonly ActionDef[])[] };

export type SupplyEffect =
  | {
      readonly rule:
        | "forbid_draft_other_influences"
        | "forbid_steal_credits"
        | "no_shuttle_credits"
        | "deck_face_up_discard_face_down"
        | "forbid_steal_modules";
    }
  | {
      readonly rule: "draft_influence_extra_cost";
      readonly cost: readonly Colour[];
      readonly achievements_to_win?: number;
      readonly colonists_to_win?: number;
    }
  | {
      readonly when: "any_player_builds";
      readonly kinds: readonly string[];
      readonly then: readonly ActionDef[];
    }
  | { readonly when: "any_player_drafts_influence"; readonly then: readonly ActionDef[] };

export interface CardDef {
  readonly id: string;
  readonly name: string;
  readonly type: "station" | "module" | "agent" | "influence" | "info";
  readonly set: "base" | "kickstarter";
  readonly kind: string;
  readonly cost: readonly Colour[];
  readonly half_orbs: Readonly<Record<HalfOrbSlot, Colour | null>> | null;
  readonly orbs: readonly Colour[];
  readonly colonists: number;
  readonly achievements: readonly string[];
  readonly main_action: readonly (readonly ActionDef[])[] | null;
  readonly on_play: readonly ActionDef[] | null;
  readonly other_side?: string | null;
  readonly count: number;
  readonly tags: readonly string[];
  readonly passive?: readonly ActionDef[];
  readonly on_flip_to?: readonly ActionDef[];
  readonly supply_effect?: SupplyEffect | null;
  readonly on_discard?: readonly ActionDef[] | null;
  readonly defence_text?: string;
  readonly footer_text?: string;
}

export interface CatalogueConfig {
  readonly seats: number;
  readonly influences: boolean;
  readonly kickstarter: boolean;
}

export type ActionKey = Exclude<ActionDef["op"], "flip"> | `flip:${FlipWho}`;

// Record makes an added/removed union member require a matching loader update.
const knownOps: Record<ActionDef["op"], true> = {
  draft: true,
  draw: true,
  discard: true,
  build: true,
  resell: true,
  opponent_resells: true,
  each_player_loses_credits: true,
  steal_credits: true,
  target_discards: true,
  each_opponent_discards: true,
  that_opponent_discards: true,
  gain_credit_per_hand_card: true,
  look_at_opponent_hand: true,
  discard_hand: true,
  resell_per_supply_influence: true,
  shuttle_red_orbs_pay: true,
  exchange_station: true,
  neighbours_exchange_stations: true,
  that_opponent_discards_all_agents: true,
  flip: true,
  steal_module: true,
  choose_one: true,
};

function validateOps(value: unknown, cardId: string): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const child of value) validateOps(child, cardId);
    return;
  }
  const object = value as Record<string, unknown>;
  if ("op" in object && (typeof object.op !== "string" || !Object.hasOwn(knownOps, object.op))) {
    throw new Error(`Card ${cardId}: unknown action op ${String(object.op)}`);
  }
  for (const child of Object.values(object)) validateOps(child, cardId);
}

/** Load authored repository data; validate-cards.sh checks its vocabulary and counts. */
export function loadCatalogue(data: {
  readonly cards: readonly { readonly id: string }[];
}): readonly CardDef[] {
  for (const card of data.cards) validateOps(card, card.id);
  // JSON imports widen literal strings. Validate op codes before narrowing the authored data.
  return data.cards as readonly CardDef[];
}

export const catalogue = loadCatalogue(source);
const cardsById = new Map(catalogue.map((card) => [card.id, card]));

export function cardById(id: string): CardDef {
  const card = cardsById.get(id);
  if (!card) throw new Error(`Unknown card id: ${id}`);
  return card;
}

/** Named Station faces to shuffle and deal; Terran Outpost is their shared reverse. */
export function stationSides(config: CatalogueConfig): readonly CardDef[] {
  return catalogue.filter(
    (card) =>
      card.type === "station" && card.count > 0 && (card.set === "base" || config.kickstarter),
  );
}

export function actionKey(action: ActionDef): ActionKey {
  return action.op === "flip" ? `flip:${action.who}` : action.op;
}

function expandActions(actions: readonly ActionDef[]): ActionDef[] {
  return actions.flatMap((action) =>
    action.op === "choose_one" ? [action, ...expandActions(action.options.flat())] : [action],
  );
}

/** Include choice containers and descendants, plus every event-triggered action. */
export function actionsOf(card: CardDef): readonly ActionDef[] {
  const effect = card.supply_effect;
  return expandActions([
    ...(card.main_action?.flat() ?? []),
    ...(card.on_play ?? []),
    ...(card.passive ?? []),
    ...(card.on_flip_to ?? []),
    ...(card.on_discard ?? []),
    ...(effect && "then" in effect ? effect.then : []),
  ]);
}

/** R3.4: every physical Module and Agent; `influenceCards` holds the variant's cards. */
export function deckCards(config: CatalogueConfig): string[] {
  return catalogue.flatMap((card) => {
    if (card.type !== "module" && card.type !== "agent") return [];
    if (card.set === "kickstarter" && !config.kickstarter) return [];
    return Array.from({ length: card.count }, () => card.id);
  });
}

/**
 * R3.4: the Influences of the sets in use, in catalogue order; none without
 * the option. Each is one physical card. With both options these are the 16
 * that R12.2 picks 8 from.
 */
export function influenceCards(config: CatalogueConfig): readonly CardDef[] {
  if (!config.influences) return [];
  return catalogue.filter(
    (card) => card.type === "influence" && (card.set === "base" || config.kickstarter),
  );
}
