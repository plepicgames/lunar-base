// The zoom view: hover for half a second, a long press, or the space bar on a
// focused card opens the w591 image with the card's name and rules text as
// real text beside it. Escape or moving away closes it (architecture,
// Behaviour).

import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { cardTexts } from "../cards.ts";
import { Card, DECK_BACK, cardLabel } from "./Card.tsx";
import type { CardProps } from "./Card.tsx";
import { useModalFocus } from "./modal-focus.ts";
import styles from "./Zoom.module.css";

const DELAY_MS = 500;

interface ZoomViewProps {
  readonly cardId: string;
  readonly onEscape: () => void;
  readonly focusOnOpen: boolean;
  /** Set when the view is a modal dialog of its own: focus is kept in it. */
  readonly modal?: boolean;
  /** A selector for where the focus goes on close when its origin is gone. */
  readonly returnTo?: string;
  /** Controls inside the dialog, after the card's text. */
  readonly children?: ReactNode;
}

export function ZoomView({
  cardId,
  onEscape,
  focusOnOpen,
  modal = false,
  returnTo,
  children,
}: ZoomViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(ref, { enabled: modal, fallback: returnTo });
  const titleId = useId();
  const name = cardLabel(cardId);
  useEffect(() => {
    if (focusOnOpen) ref.current?.focus();
  }, [focusOnOpen]);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal={modal ? true : undefined}
      aria-labelledby={titleId}
      tabIndex={-1}
      className={styles.zoom}
      onKeyDown={(event) => {
        if (event.key === "Escape") onEscape();
      }}
    >
      <img className={styles.image} src={`/cards/w591/${cardId}.webp`} alt="" />
      <div className={styles.text}>
        <h2 id={titleId} className={styles.name}>
          {name}
        </h2>
        {cardId === DECK_BACK
          ? null
          : cardTexts(cardId).map((text) => (
              <p key={text} className={styles.rules}>
                {text}
              </p>
            ))}
        {children}
      </div>
    </div>
  );
}

export interface ZoomCardProps extends CardProps {
  /** Called when the card is pressed; the zoom view does not use it. */
  readonly onPress?: () => void;
  /** Set when pressing the card answers a decision: the card glows and this names the button. */
  readonly actionLabel?: string;
  /** Names a press that does not answer a game decision. */
  readonly pressLabel?: string;
  /** Set when pressing the card picks it and it stays picked: true for the picked card. */
  readonly pressed?: boolean;
  /** The instance id; the card's motion finds its button by it. */
  readonly instance?: string;
}

/** A card that opens its zoom view; the card is one button named by the card. */
export function ZoomCard({
  onPress,
  actionLabel,
  pressLabel,
  pressed,
  instance,
  ...card
}: ZoomCardProps) {
  const [open, setOpen] = useState<"hover" | "keyboard" | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);

  const cancel = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  const later = () => {
    cancel();
    timer.current = window.setTimeout(() => {
      setOpen("hover");
    }, DELAY_MS);
  };
  const close = () => {
    cancel();
    setOpen(null);
  };
  useEffect(() => cancel, []);

  // Escape also closes it when focus is on the card and not in the dialog.
  useEffect(() => {
    if (open === null) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(null);
      trigger.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== " ") return;
    event.preventDefault();
    cancel();
    setOpen("keyboard");
  };
  const onPointerEnter = (event: PointerEvent) => {
    if (event.pointerType === "mouse" || event.pointerType === "pen") later();
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "touch") later();
  };

  return (
    <span className={styles.anchor}>
      <button
        ref={trigger}
        type="button"
        className={actionLabel === undefined ? styles.trigger : `${styles.trigger} ${styles.glow}`}
        aria-haspopup="dialog"
        data-zoom-card=""
        data-card={instance}
        aria-label={pressLabel ?? actionLabel}
        aria-pressed={pressed}
        data-decision-option={actionLabel === undefined ? undefined : ""}
        onClick={onPress}
        onKeyDown={onKeyDown}
        onPointerEnter={onPointerEnter}
        onPointerLeave={close}
        onPointerDown={onPointerDown}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onBlur={() => {
          if (open !== "keyboard") close();
        }}
      >
        <Card {...card} />
      </button>
      {open === null ? null : (
        <ZoomView
          cardId={card.cardId}
          focusOnOpen={open === "keyboard"}
          modal={open === "keyboard"}
          onEscape={() => {
            close();
            trigger.current?.focus();
          }}
        />
      )}
    </span>
  );
}
