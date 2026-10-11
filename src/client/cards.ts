// Card names for the text views. The client reads the catalogue's data only;
// every rule stays in the engine.

import source from "../../docs/design/cards.json" with { type: "json" };

const NAMES: ReadonlyMap<string, string> = new Map(
  source.cards.map((card): [string, string] => [card.id, card.name]),
);

/** The printed name of a card, or its id when the catalogue does not know it. */
export function cardName(cardId: string): string {
  return NAMES.get(cardId) ?? cardId;
}

interface PrintedText {
  readonly id: string;
  readonly rules_text: string | null;
  readonly defence_text?: string | null;
  readonly footer_text?: string | null;
}

const TEXTS: ReadonlyMap<string, readonly string[]> = new Map(
  (source.cards as readonly PrintedText[]).map((card): [string, readonly string[]] => [
    card.id,
    [card.rules_text, card.defence_text, card.footer_text].filter(
      (text): text is string => typeof text === "string" && text !== "",
    ),
  ]),
);

/** The printed rules text of a card, one paragraph per printed block. */
export function cardTexts(cardId: string): readonly string[] {
  return TEXTS.get(cardId) ?? [];
}

/** Printed effect active while an Influence is face up in the Supply. */
export function supplyInfluenceText(cardId: string): string | null {
  const card = (
    source.cards as readonly (PrintedText & { type: string; supply_effect?: unknown })[]
  ).find((entry) => entry.id === cardId);
  return card?.type === "influence" && card.supply_effect != null ? card.rules_text : null;
}
