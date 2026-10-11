// The Build interaction D6 (architecture, Behaviour): pick a Module in your
// hand, pick one of its places on your Base, turn it, confirm. The hand, the
// Base and the bar each draw their part of one selection. Every place, turn,
// price and Orb shown is what an option of the engine says.

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { GameView } from "../../../protocol/messages.ts";
import { cardLabel } from "../../cards/Card.tsx";
import type { Offer } from "../BaseView.tsx";
import { cardIdOf } from "../card-options.ts";
import type { Asked } from "../Decisions.tsx";
import type { HandAction } from "../Hand.tsx";
import {
  buildSelection,
  placementsOf,
  plainOptions,
  type BuildAction,
  type Selection,
} from "./selection.ts";
import styles from "./Build.module.css";

export const BUILD = "build";

export interface Build {
  readonly pending: Asked;
  readonly selection: Selection;
  /** The name of the chosen Module. */
  readonly name: string | null;
  /** The Modules of the hand that can be picked. */
  readonly modules: ReadonlyMap<string, HandAction>;
  /** The places and the preview on your Base, once a Module is picked. */
  readonly offer: Offer | undefined;
  readonly back: () => void;
}

/** Where the focus goes after a step, so the keyboard goes on from there. */
type Focus = readonly [attribute: string, value?: string];

function focusOn([attribute, value]: Focus): void {
  const marked = [...document.querySelectorAll<HTMLElement>(`[${attribute}]`)];
  const found = marked.find(
    (element) => value === undefined || element.getAttribute(attribute) === value,
  );
  const control = found?.matches("button") === true ? found : found?.querySelector("button");
  control?.focus();
}

/**
 * The Build decision of this seat as a selection, or null when `pending` is
 * not one. `onPick` is called when a Module is picked.
 */
export function useBuild(view: GameView, pending: Asked | null, onPick: () => void): Build | null {
  const [held, setHeld] = useState<{ decision: string; selection: Selection } | null>(null);
  const focus = useRef<Focus | null>(null);
  const options = pending?.options;
  const decision = pending?.id;
  // A selection belongs to one decision: the next one starts with nothing chosen.
  const selection = useMemo(
    () =>
      options === undefined
        ? null
        : held !== null && held.decision === decision
          ? held.selection
          : buildSelection(options, { type: "open" }),
    [options, decision, held],
  );

  useEffect(() => {
    if (focus.current === null) return;
    focusOn(focus.current);
    focus.current = null;
  });

  const step = (action: BuildAction, then: Focus | null) => {
    if (options === undefined || decision === undefined || selection === null) return;
    focus.current = then;
    setHeld({ decision, selection: buildSelection(options, action, selection) });
  };
  const back = () => {
    if (selection === null) return;
    const { module, cell } = selection;
    if (cell !== null) step({ type: "back" }, ["data-offer-cell", at(cell.x, cell.y)]);
    else if (module !== null) step({ type: "back" }, ["data-instance", module]);
  };
  const turn = () => {
    step({ type: "turn" }, null);
  };

  const chosen = selection?.module ?? null;
  const placed = selection?.cell != null;
  useEffect(() => {
    if (chosen === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // Escape belongs to an open dialog first, such as a card's zoom view.
      if (document.querySelector('[role="dialog"]') !== null) return;
      if (event.key === "Escape") {
        event.preventDefault();
        back();
      } else if (placed && event.key.toLowerCase() === "r") {
        event.preventDefault();
        turn();
      }
    };
    // In the capture phase, so the dialog is still there to be seen.
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
    };
  });

  if (pending === null || selection === null) return null;
  const nameOf = (instance: string) => cardLabel(cardIdOf(view, instance) ?? instance);
  const name = chosen === null ? null : nameOf(chosen);
  const modules = new Map(
    selection.modules.map((instance): [string, HandAction] => [
      instance,
      {
        label: `Build ${nameOf(instance)}`,
        pressed: instance === chosen,
        onPress: () => {
          onPick();
          step({ type: "module", card: instance }, ["data-offer-cell"]);
        },
      },
    ]),
  );
  const { cell, option } = selection;
  const offer: Offer | undefined =
    chosen === null || name === null
      ? undefined
      : {
          cells: selection.cells
            .filter((other) => other.x !== cell?.x || other.y !== cell.y)
            .map(({ x, y }) => ({ x, y, label: `Place ${name} at ${at(x, y)}` })),
          preview:
            option === null
              ? null
              : {
                  cardId: cardIdOf(view, chosen) ?? chosen,
                  label: `Turn ${name}`,
                  x: option.x,
                  y: option.y,
                  q: option.q,
                },
          extent: placementsOf(pending.options, chosen),
          onCell: (x, y) => {
            step({ type: "cell", x, y }, ["data-offer-preview"]);
          },
          onPreview: turn,
        };
  return { pending, selection, name, modules, offer, back };
}

function at(x: number, y: number): string {
  return `${String(x)},${String(y)}`;
}

function credits(price: number): string {
  return `${String(price)} ${price === 1 ? "Credit" : "Credits"}`;
}

interface BuildBarProps {
  readonly build: Build;
  /** What every decision bar starts with; the status goes on in the same line. */
  readonly lead: ReactNode;
  readonly onDecide: (decision: string, option: string) => void;
}

/**
 * The bar of D6: what to do next, the price and Orbs of the preview, Confirm,
 * Back and skip. It is one line of text and one row of buttons, as tall as the
 * generic bar, so the Base above keeps its room.
 */
export function BuildBar({ build, lead, onDecide }: BuildBarProps) {
  const { pending, selection, name } = build;
  const { option, turns } = selection;
  const send = (id: string) => () => {
    onDecide(pending.id, id);
  };
  let status;
  if (name === null) {
    // With no Module to pick, the buttons below are all there is.
    status = selection.modules.length === 0 ? null : "Pick a Module in your hand.";
  } else if (option === null) {
    status = `${name}: pick a place on your Base.`;
  } else {
    const turn = `Turn ${String(turns.indexOf(option.q) + 1)} of ${String(turns.length)}`;
    status = (
      <>
        {name}. <strong>Price: {credits(option.price)}.</strong>{" "}
        <strong>Orbs formed: {option.orbs.length === 0 ? "none" : option.orbs.join(", ")}.</strong>{" "}
        {turns.length > 1 ? `${turn}: R or a click turns it.` : `${turn}.`}
      </>
    );
  }
  return (
    <>
      <p role="status" className={styles.status}>
        {lead}. {status}
      </p>
      <ul className={styles.buttons}>
        {option === null ? null : (
          <li>
            <button type="button" className={styles.confirm} onClick={send(option.id)}>
              Confirm: {option.label}
            </button>
          </li>
        )}
        {name === null ? null : (
          <li>
            <button type="button" className={styles.button} onClick={build.back}>
              Back
            </button>
          </li>
        )}
        {plainOptions(pending.options).map((plain) => (
          <li key={plain.id}>
            <button type="button" className={styles.button} onClick={send(plain.id)}>
              {plain.label}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
