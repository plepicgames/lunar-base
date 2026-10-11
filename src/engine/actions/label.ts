// English names of actions, for the labels of decision options. The wording
// is that of rules.md, sections 7 and 9.

import type { ActionDef, FlipWho } from "../catalogue.ts";

const FLIPS: Readonly<Record<FlipWho, string>> = {
  own: "Flip your Station",
  any_one: "Flip a Station",
  any_two: "Flip two Stations",
  any_number: "Flip any number of Stations",
  neighbours_of_target: "Both neighbours of target player Flip their Station",
  each_player: "Each player Flips their Station",
  all_to_terran_outpost: "Flip all Stations to Terran Outposts",
};

/** "Resell x2": an action done n times; "Resell" when n is 1. */
function times(name: string, n: number): string {
  return n === 1 ? name : `${name} x${String(n)}`;
}

function credits(n: number): string {
  return `${String(n)} ${n === 1 ? "Credit" : "Credits"}`;
}

/** "asteroid_grinder" is "Asteroid Grinder". */
function kindName(kind: string): string {
  return kind
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** The name of one action as a player reads it. */
export function actionLabel(action: ActionDef): string {
  switch (action.op) {
    case "draft":
      return times("Draft", action.n);
    case "draw":
      return times("Draw", action.n);
    case "discard":
      return times("Discard", action.n);
    case "build":
      return times("Build", action.n);
    case "resell":
      return times("Resell", action.n);
    case "opponent_resells":
      return times("An opponent Resells", action.n);
    case "target_discards":
      return times("Target Discards", action.n);
    case "each_opponent_discards":
      return times("Each opponent Discards", action.n);
    case "that_opponent_discards":
      return times("That opponent Discards", action.n);
    case "each_player_loses_credits":
      return `Each player Loses ${credits(action.n)}`;
    case "steal_credits":
      return `Steal ${credits(action.n)}`;
    case "gain_credit_per_hand_card":
      return "Gain 1 Credit per card in your hand";
    case "look_at_opponent_hand":
      return "Look at an opponent's hand";
    case "discard_hand":
      return "Discard all your cards";
    case "resell_per_supply_influence":
      return "Resell per Influence in the Supply";
    case "shuttle_red_orbs_pay":
      return "Red Orbs pay Shuttle Credits";
    case "exchange_station":
      return "Exchange Stations";
    case "neighbours_exchange_stations":
      return "Neighbours Exchange Stations";
    case "that_opponent_discards_all_agents":
      return "That opponent Discards all Agents";
    case "flip":
      return FLIPS[action.who];
    case "steal_module":
      return `Steal Module: ${kindName(action.kind)}`;
    case "choose_one":
      return `Do one: ${action.options.map(actionsLabel).join(" / ")}`;
  }
}

/** The actions of a box or text, left to right (R8.1): "Resell x2, Draw". */
export function actionsLabel(actions: readonly ActionDef[]): string {
  return actions.map(actionLabel).join(", ");
}
