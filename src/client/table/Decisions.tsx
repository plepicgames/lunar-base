// Decisions that have an interaction of their own (architecture, Behaviour):
// D2 lists the Main Action boxes grouped by card; D3 and D7 are dialogs over
// the table. Every control is named by the engine's label.

import { useEffect, useId, useRef } from "react";
import type { GameView } from "../../protocol/messages.ts";
import { cardTexts } from "../cards.ts";
import { Card, cardLabel } from "../cards/Card.tsx";
import { useModalFocus } from "../cards/modal-focus.ts";
import { cardIdOf } from "./card-options.ts";
import styles from "./Decisions.module.css";

type Pending = NonNullable<GameView["pending"]>;
export type Asked = Extract<Pending, { options: unknown }>;
type Option = Asked["options"][number];

export const MAIN_ACTION = "main_action";
/** D3 "do one" and D7 resolve now or later. */
export const DIALOG_KINDS: ReadonlySet<string> = new Set([
  "choose_one",
  "defer",
  "defence",
  "order",
]);

interface Props {
  readonly view: GameView;
  readonly pending: Asked;
  readonly onDecide: (decision: string, option: string) => void;
  readonly agentCardId?: string;
}

function cardOf(option: Option): string | null {
  return typeof option.card === "string" ? option.card : null;
}

/** The instances of the cards that D2 offers a box of: the Base highlights them. */
export function boxCards(pending: Asked): ReadonlySet<string> {
  const cards = pending.options.map(cardOf).filter((card): card is string => card !== null);
  return new Set(cards);
}

/** D2: one group per card, in the order the engine lists them, with its image. */
export function MainActionBoxes({ view, pending, onDecide }: Props) {
  const groups = new Map<string | null, Option[]>();
  for (const option of pending.options) {
    const key = cardOf(option);
    groups.set(key, [...(groups.get(key) ?? []), option]);
  }
  return (
    <ul className={styles.groups}>
      {[...groups].map(([instance, options]) => {
        const cardId = instance === null ? null : cardIdOf(view, instance);
        const buttons = options.map((option) => (
          <li key={option.id}>
            <button
              type="button"
              className={styles.option}
              onClick={() => {
                onDecide(pending.id, option.id);
              }}
            >
              {option.label}
            </button>
          </li>
        ));
        return (
          <li key={instance ?? "none"}>
            {cardId === null ? (
              <ul className={styles.boxes}>{buttons}</ul>
            ) : (
              <div role="group" aria-label={cardLabel(cardId)} className={styles.group}>
                <Card cardId={cardId} width={20} />
                <ul className={styles.boxes}>{buttons}</ul>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** D3 and D7: the card in question and one button per option. Focus stays inside. */
export function ChoiceDialog({ view, pending, onDecide, agentCardId }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const instance = pending.options.map(cardOf).find((card) => card !== null) ?? null;
  const cardId =
    pending.kind === "order"
      ? null
      : pending.kind === "defence"
        ? (agentCardId ?? null)
        : instance === null
          ? null
          : cardIdOf(view, instance);
  const title =
    pending.kind === "defer"
      ? "Resolve the text now or later"
      : pending.kind === "defence"
        ? "Defend against Agent"
        : pending.kind === "order"
          ? "Order immediate effects"
          : "Choose one";
  useModalFocus(ref);

  useEffect(() => {
    ref.current?.querySelector("button")?.focus();
  }, [pending.id]);

  return (
    <div className={styles.backdrop}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={styles.dialog}
      >
        <h2 id={titleId} className={styles.title}>
          {title}
          {cardId === null ? "" : `: ${cardLabel(cardId)}`}
        </h2>
        {cardId === null ? null : <Card cardId={cardId} width={160} />}
        {pending.kind === "defence" ? (
          <p>
            {cardId === null
              ? "An Agent action is about to affect you or your Base."
              : `Agent actions: ${cardTexts(cardId)[0] ?? "An Agent action is about to affect you or your Base."}`}
          </p>
        ) : null}
        <ul className={styles.choices}>
          {pending.options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                className={styles.option}
                onClick={() => {
                  onDecide(pending.id, option.id);
                }}
              >
                {pending.kind === "defence" && option.id === "decline" ? "Decline" : option.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
