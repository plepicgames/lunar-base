import { useEffect, useRef, useState } from "react";
import type { GameView } from "../../protocol/messages.ts";
import { cardName } from "../cards.ts";
import type { GameState } from "../connection.ts";
import { Card } from "../cards/Card.tsx";
import { useModalFocus } from "../cards/modal-focus.ts";
import { ZoomView } from "../cards/Zoom.tsx";
import styles from "./Log.module.css";

interface LogProps {
  readonly lines: readonly string[];
  /** The seat-projected events, in the same order as lines. */
  readonly events: readonly ViewEvent[];
  readonly players?: GameView["players"];
}

export type LogEvent = GameState["events"][number];
type ViewEvent = LogEvent;

function cardIds(event: ViewEvent | undefined): readonly string[] {
  if (event === undefined) return [];
  if ("card" in event) return [event.card.cardId];
  if (event.type === "hand_seen" && "cards" in event) return event.cards.map((card) => card.cardId);
  if (event.type === "station_flipped") return event.flips.map((flip) => flip.card.cardId);
  if (event.type === "influences_revealed") return event.cards.map((card) => card.cardId);
  return [];
}

function Sentence({
  text,
  event,
  onZoom,
}: {
  readonly text: string;
  readonly event: ViewEvent | undefined;
  readonly onZoom: (cardId: string) => void;
}) {
  const cards = cardIds(event);
  const names = cards
    .map((id) => ({ id, name: cardName(id) }))
    .sort((a, b) => b.name.length - a.name.length);
  if (cards.length === 0) return <>{text}</>;
  const parts = [];
  let rest = text;
  let key = 0;
  while (rest.length > 0) {
    const matches = names
      .map(({ id, name }) => ({ id, name, at: rest.indexOf(name) }))
      .filter((match) => match.at >= 0);
    matches.sort((a, b) => a.at - b.at || b.name.length - a.name.length);
    if (matches.length === 0) {
      parts.push(rest);
      break;
    }
    const match = matches[0];
    if (match.at > 0) parts.push(rest.slice(0, match.at));
    parts.push(
      <button
        className={styles.cardLink}
        type="button"
        key={key++}
        onClick={() => {
          onZoom(match.id);
        }}
      >
        {match.name}
      </button>,
    );
    rest = rest.slice(match.at + match.name.length);
  }
  return <>{parts}</>;
}

const RETURN_TO =
  'section[aria-label="Your decision"] button, section[aria-label="Your hand"] button';

/** Another player's hand, seen through a private look. A modal dialog. */
function HandDialog({
  name,
  cards,
  onClose,
}: {
  readonly name: string;
  readonly cards: readonly { readonly instance: string; readonly cardId: string }[];
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(ref, { onEscape: onClose, fallback: RETURN_TO });
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={`${name}'s hand`}
      tabIndex={-1}
      className={styles.dialog}
    >
      <h2>{name}'s hand</h2>
      <div className={styles.cards}>
        {cards.map((card) => (
          <Card key={card.instance} cardId={card.cardId} width={110} />
        ))}
      </div>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

/**
 * A card in the zoom view with a Close button: one named in a log line, or a
 * Station's other side. A modal dialog.
 */
export function ZoomDialog({
  cardId,
  onClose,
}: {
  readonly cardId: string;
  readonly onClose: () => void;
}) {
  return (
    <div className={styles.dialog}>
      <ZoomView cardId={cardId} focusOnOpen modal returnTo={RETURN_TO} onEscape={onClose}>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </ZoomView>
    </div>
  );
}

/** The visible, seat-projected event history. */
export function Log({ lines, events, players = [] }: LogProps) {
  const region = useRef<HTMLElement>(null);
  const pinned = useRef(true);
  const seenCount = useRef(events.length);
  const [look, setLook] = useState<
    | (Extract<ViewEvent, { type: "hand_seen" }> & {
        readonly cards: readonly { readonly instance: string; readonly cardId: string }[];
      })
    | null
  >(null);
  const [zoom, setZoom] = useState<string | null>(null);

  useEffect(() => {
    if (pinned.current && region.current) region.current.scrollTop = region.current.scrollHeight;
  }, [lines.length]);

  useEffect(() => {
    for (const event of events.slice(seenCount.current)) {
      if (event.type === "hand_seen" && "cards" in event) setLook(event);
    }
    seenCount.current = events.length;
  }, [events]);

  const name =
    look === null
      ? ""
      : (players.find((player) => player.seat === look.opponent)?.name ??
        `Player ${String(look.opponent + 1)}`);
  return (
    <>
      <section
        ref={region}
        aria-label="Log"
        aria-live="polite"
        className={styles.log}
        onScroll={(event) => {
          const node = event.currentTarget;
          pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight <= 24;
        }}
      >
        <h3 className={styles.heading}>Log</h3>
        <ul className={styles.list}>
          {lines.map((line, index) => {
            const event = index < events.length ? events[index] : undefined;
            return (
              <li key={index}>
                {event?.type === "turn_started" && (
                  <div className={styles.turn}>Turn {event.turn}</div>
                )}
                <Sentence text={line} event={event} onZoom={setZoom} />
              </li>
            );
          })}
        </ul>
      </section>
      {look === null ? null : (
        <HandDialog
          name={name}
          cards={look.cards}
          onClose={() => {
            setLook(null);
          }}
        />
      )}
      {zoom === null ? null : (
        <ZoomDialog
          cardId={zoom}
          onClose={() => {
            setZoom(null);
          }}
        />
      )}
    </>
  );
}
