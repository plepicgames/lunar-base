import {
  catalogue,
  legalPlacements,
  priceOf,
  type ActionDef,
  type Base,
  type CardDef,
  type DecisionOption,
  type ViewPlayer,
} from "../../engine/index.ts";
import type { DecisionRequest } from "../maker.ts";
import { influenceScorer } from "./influences.ts";

const cards = new Map(catalogue.map((card) => [card.id, card]));
const WIN = 1_000_000;
const CARD = 3;
const CREDIT = 3;
const DRAFT_FLOOR = 1;

/** One evaluation context per request; placement searches are shared by its boxes. */
export function scorer(request: DecisionRequest): (option: DecisionOption) => number {
  const { view, seat } = request;
  const player = view.players.find((player) => player.seat === seat);
  if (!player) return () => 0;
  const own = player;
  const visible = new Map(
    [
      ...view.hand,
      ...view.supply,
      ...view.play,
      ...view.discard,
      ...view.players.flatMap((player) => [player.base.station, ...player.base.modules]),
    ].map((card) => [card.instance, cards.get(card.cardId)]),
  );
  const cardOf = (instance: unknown) =>
    typeof instance === "string" ? visible.get(instance) : undefined;
  const station = cardOf(own.base.station.instance);
  if (!station) return () => 0;
  const visibleStation = station;
  const held = view.hand.flatMap((card) => {
    const def = cards.get(card.cardId);
    return def ? [{ instance: card.instance, def }] : [];
  });
  // The rules need only the face that is showing, never the hidden Station face.
  const base: Base = {
    station: { card: own.base.station.instance, side: "named", revealed: true },
    modules: own.base.modules.map((module) => ({
      card: module.instance,
      x: module.x,
      y: module.y,
      q: module.q,
    })),
  };
  const achievements = new Set(own.achievements);
  const progress = (before: number, gain: number, target: number) =>
    20 * ((Math.min(target, before + gain) / target) ** 2 - (before / target) ** 2);

  function moduleValue(
    card: CardDef,
    price: number,
    formed: readonly string[] = [],
    instance?: string,
  ): number {
    const gained = new Set(card.achievements.filter((icon) => !achievements.has(icon))).size;
    if (
      own.colonists + card.colonists >= view.targets.colonists ||
      achievements.size + gained >= view.targets.achievements
    )
      return WIN;
    const after = { ...own.base.orbs };
    for (const colour of [...formed, ...card.orbs]) {
      const orb = colour === "gray" ? "wild" : colour;
      if (orb === "red" || orb === "blue" || orb === "yellow" || orb === "wild") after[orb]++;
    }
    const savings = held
      .filter((card) => card.instance !== instance)
      .reduce(
        (sum, { def }) => sum + priceOf(def.cost, own.base.orbs) - priceOf(def.cost, after),
        0,
      );
    return (
      4 +
      card.colonists * 12 +
      gained * 18 +
      progress(own.colonists, card.colonists, view.targets.colonists) +
      progress(achievements.size, gained, view.targets.achievements) +
      savings * 5 +
      formed.length -
      price * CREDIT
    );
  }

  const buildValues = new Map<number, number>();
  function bestBuild(credits: number): number {
    const cached = buildValues.get(credits);
    if (cached !== undefined) return cached;
    let best = 0;
    for (const { instance, def } of held) {
      if (def.type !== "module") continue;
      const price = priceOf(def.cost, own.base.orbs);
      if (price > credits) continue;
      // Every Base card was placed by the engine and is public in a valid view.
      for (const placement of legalPlacements(
        base,
        def,
        (id) => visible.get(id) ?? visibleStation,
      )) {
        best = Math.max(best, moduleValue(def, price, placement.orbs, instance));
      }
    }
    buildValues.set(credits, best);
    return best;
  }

  function draftValue(card: CardDef): number {
    const price = priceOf(card.cost, own.base.orbs);
    // Drafting does not itself meet a victory condition. Discount future gains.
    if (card.type === "module")
      return (
        CARD +
        Math.min(60, moduleValue(card, price)) / 4 -
        Math.max(0, price - own.credits) * CREDIT
      );
    if (card.type === "agent") return CARD - price;
    return 0;
  }

  // Weight public progress toward any victory condition, not just Base size.
  function threat(target: ViewPlayer): number {
    return (
      1 +
      Math.max(
        target.colonists / view.targets.colonists,
        new Set(target.achievements).size / view.targets.achievements,
        target.credits / view.targets.credits,
      )
    );
  }

  function targetValue(option: DecisionOption): number {
    const opponent = view.players.find((player) => player.seat === option.target);
    if (!opponent) return 0;
    // Resell gives the target Credits, so favour the trailing opponent.
    if (option.op === "opponent_resells") return -CARD * threat(opponent);
    return opponent.seat === seat ? -CARD : CARD * threat(opponent);
  }

  function flipValue(target: ViewPlayer): number {
    const station = target.base.station;
    const before = cards.get(station.cardId);
    const after = cards.get(
      station.side === "named" ? "stn-terran-outpost" : (station.named ?? ""),
    );
    // An unrevealed opponent's named face is not available to this maker.
    if (!before || !after) return 0;
    const moduleIcons = new Set(
      target.base.modules.flatMap((module) => cardOf(module.instance)?.achievements ?? []),
    );
    const unique = (card: CardDef) =>
      card.achievements.filter((icon) => !moduleIcons.has(icon)).length;
    const colonists = target.colonists + after.colonists - before.colonists;
    const icons = new Set([...moduleIcons, ...after.achievements]).size;
    const gain =
      colonists >= view.targets.colonists || icons >= view.targets.achievements
        ? WIN
        : (after.colonists - before.colonists) * 12 +
          (unique(after) - unique(before)) * 18 +
          (after.orbs.length - before.orbs.length) * 5;
    return target.seat === seat ? gain : -gain * threat(target);
  }

  function stationChange(target: ViewPlayer, before: CardDef, after: CardDef): number {
    const moduleIcons = new Set(
      target.base.modules.flatMap((module) => cardOf(module.instance)?.achievements ?? []),
    );
    const remaining = target.achievements.filter(
      (icon) => !before.achievements.includes(icon) || moduleIcons.has(icon),
    );
    const icons = new Set([...remaining, ...after.achievements]).size;
    const colonists = target.colonists + after.colonists - before.colonists;
    if (colonists >= view.targets.colonists || icons >= view.targets.achievements) return WIN;
    return (
      (after.colonists - before.colonists) * 12 +
      (icons - new Set(target.achievements).size) * 18 +
      (after.orbs.length - before.orbs.length) * 5
    );
  }

  function exchangeValue(option: DecisionOption): number {
    const target = view.players.find((player) => player.seat === option.target);
    const theirs = target && cardOf(target.base.station.instance);
    if (!target || !theirs) return 0;
    // Exchange keeps the showing faces; never consult a hidden named side.
    return (
      stationChange(own, visibleStation, theirs) -
      stationChange(target, theirs, visibleStation) * threat(target)
    );
  }

  function flipsValue(seats: readonly unknown[]): number {
    return view.players
      .filter((player) => seats.includes(player.seat))
      .reduce((sum, player) => sum + flipValue(player), 0);
  }

  function stealValue(card: CardDef, target: unknown): number {
    const owner = view.players.find((player) => player.seat === target);
    if (!owner || owner.seat === seat) return 0;
    // Stolen Modules go to hand, not directly into our Base.
    return (
      draftValue(card) +
      threat(owner) *
        (CARD + card.colonists * 12 + card.achievements.length * 18 + card.orbs.length * 5)
    );
  }

  function seenDiscardValue(count: number): number {
    for (const event of [...request.events].reverse()) {
      if (event.type === "agent_played" && event.seat === seat) break;
      if (event.type !== "hand_seen" || event.looker !== seat || !("cards" in event)) continue;
      const target = view.players.find((player) => player.seat === event.opponent);
      // The opponent chooses its least valuable cards, not the best ones we saw.
      const values = event.cards
        .map(({ cardId }) => {
          const card = cards.get(cardId);
          return card?.type === "influence" ? CARD * 2 : card?.type === "module" ? CARD : CARD / 2;
        })
        .sort((a, b) => a - b);
      return (
        values.slice(0, count).reduce((sum, value) => sum + value, 0) *
        (target ? threat(target) : 1)
      );
    }
    return 0;
  }

  const influences = influenceScorer(request, own, draftValue, flipValue);

  function actionsValue(actions: readonly ActionDef[], credits: number): number {
    let value = 0;
    let buildCounted = false;
    let drawable = view.deck + view.discardCount;
    let top = view.deckTop ? cards.get(view.deckTop.cardId) : undefined;
    let resellable = view.supply.filter((card) => {
      const type = cards.get(card.cardId)?.type;
      return type === "module" || type === "agent";
    }).length;
    for (const action of actions) {
      // No hidden draws are predicted, nor the same held Module built twice.
      if (action.op === "build") {
        if (!buildCounted) value += bestBuild(credits);
        buildCounted = true;
      } else if (action.op === "draw") {
        const count = Math.min(action.n, drawable);
        value += count * CARD;
        if (count > 0 && top) value += influences.gain(top) - CARD;
        if (count > 0) top = undefined;
        drawable -= count;
      } else if (action.op === "draft") {
        // Taking a Module or Agent brings the Shuttles nearer, so it beats a box that does nothing.
        const values = view.supply
          .flatMap((card) => {
            const def = cards.get(card.cardId);
            if (!def || !influences.canDraft(def, credits)) return [];
            const value = influences.draft(def, undefined, credits);
            return [def.type === "influence" ? value : Math.max(DRAFT_FLOOR, value)];
          })
          .sort((a, b) => b - a);
        value += values.slice(0, action.n).reduce((sum, item) => sum + item, 0);
      } else if (action.op === "resell") {
        const gained = Math.min(action.n, resellable);
        value += gained * CREDIT;
        credits += gained;
        resellable -= gained;
      } else if (action.op === "gain_credit_per_hand_card") value += view.hand.length * CREDIT;
      else if (action.op === "discard")
        value += held
          .map(({ def }) => influences.discard(def))
          .sort((a, b) => b - a)
          .slice(0, action.n)
          .reduce((sum, item) => sum + item, 0);
      else if (action.op === "discard_hand")
        value += held.reduce((sum, { def }) => sum + influences.discard(def), 0);
      else if (action.op === "steal_credits") {
        const gained = Math.min(
          action.n,
          Math.max(0, ...view.players.filter((p) => p.seat !== seat).map((p) => p.credits)),
        );
        value += gained * CREDIT;
        credits += gained;
      } else if (action.op === "that_opponent_discards") value += seenDiscardValue(action.n);
      else if (action.op === "target_discards")
        value += Math.max(
          0,
          ...view.players
            .filter((p) => p.seat !== seat)
            .map((p) => Math.min(action.n, p.handSize) * CARD * threat(p)),
        );
      else if (action.op === "steal_module")
        value += Math.max(
          0,
          ...view.players
            .filter((p) => p.seat !== seat)
            .flatMap((p) =>
              p.base.modules.flatMap((module) => {
                const card = cardOf(module.instance);
                return card?.kind === action.kind ? [stealValue(card, p.seat)] : [];
              }),
            ),
        );
      else if (action.op === "flip") {
        const values = view.players.map(flipValue).sort((a, b) => b - a);
        if (action.who === "own") value += flipValue(own);
        else if (action.who === "any_one") value += values[0];
        else if (action.who === "any_two")
          value += values.slice(0, 2).reduce((sum, value) => sum + value, 0);
        else if (action.who === "any_number")
          value += values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
        else if (action.who === "each_player")
          value += values.reduce((sum, value) => sum + value, 0);
      } else if (action.op === "choose_one")
        value += Math.max(0, ...action.options.map((branch) => actionsValue(branch, credits)));
    }
    return value;
  }

  return (option) => {
    const card = cardOf(option.card);
    const price = typeof option.price === "number" ? option.price : 0;
    switch (request.decision.kind) {
      case "build":
        return option.id === "skip" || card?.type !== "module"
          ? 0
          : moduleValue(
              card,
              price,
              Array.isArray(option.orbs)
                ? option.orbs.filter((orb): orb is string => typeof orb === "string")
                : [],
              typeof option.card === "string" ? option.card : undefined,
            );
      case "main_action":
        return actionsValue(
          typeof option.box === "number" ? (card?.main_action?.[option.box] ?? []) : [],
          own.credits,
        );
      case "draft":
        return card ? influences.draft(card, price) : 0;
      case "discard":
        return card ? influences.discard(card) : 0;
      case "defence":
        return influences.defence(option, card);
      case "order":
        return influences.order(option);
      case "resell":
        return card ? -draftValue(card) : 0;
      case "target":
        return Array.isArray(option.seats) ? flipsValue(option.seats) : targetValue(option);
      case "exchange_station":
        return exchangeValue(option);
      case "flip":
        return Array.isArray(option.seats) ? flipsValue(option.seats) : 0;
      case "steal_module":
        return card ? stealValue(card, option.target) : 0;
      case "choose_one": {
        // Every base-game printed choose-one is a single on-play action.
        const choice = card?.on_play?.find((action) => action.op === "choose_one");
        return choice?.op === "choose_one"
          ? actionsValue(choice.options[Number(option.id)] ?? [], own.credits)
          : 0;
      }
      case "agent":
        return option.id === "go_on" || card?.type !== "agent"
          ? 0
          : actionsValue(card.on_play ?? [], own.credits - price) - price * CREDIT;
      case "defer":
        return option.id === "now" && card ? actionsValue(card.on_play ?? [], own.credits) : 0;
      default:
        return 0;
    }
  };
}

/** Scores only the request's visible information and structured option data. */
export function score(request: DecisionRequest, option: DecisionOption): number {
  return scorer(request)(option);
}
