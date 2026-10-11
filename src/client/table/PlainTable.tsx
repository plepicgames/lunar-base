// The whole view as text, with one button per option (architecture,
// Behaviour). It holds no rules: it draws `view` and offers `pending.options`.

import { cardName } from "../cards.ts";
import type { GameView } from "../../protocol/messages.ts";
import { Log, type LogEvent } from "./Log.tsx";

type Card = GameView["hand"][number];

const TURNS = ["upright", "turned right", "upside down", "turned left"] as const;

interface PlainTableProps {
  readonly view: GameView;
  /** One sentence per event, oldest first. */
  readonly log: readonly string[];
  readonly history?: readonly LogEvent[];
  readonly onDecide: (decision: string, option: string) => void;
}

function nameOf(card: Card): string {
  return cardName(card.cardId);
}

function CardList({ cards }: { readonly cards: readonly Card[] }) {
  if (cards.length === 0) return <p>None.</p>;
  return (
    <ul>
      {cards.map((card) => (
        <li key={card.instance}>{nameOf(card)}</li>
      ))}
    </ul>
  );
}

interface PlayerSectionProps {
  readonly player: GameView["players"][number];
  readonly targets: GameView["targets"];
}

function PlayerSection({ player, targets }: PlayerSectionProps) {
  const { station, modules } = player.base;
  return (
    <section aria-label={player.name}>
      <h3>{player.name}</h3>
      <p>
        Credits {player.credits} of {targets.credits}, colonists {player.colonists} of{" "}
        {targets.colonists}, achievements {player.achievements.length} of {targets.achievements},
        hand {player.handSize}
        {player.kind === "bot" ? ", non-human" : ""}
        {player.connected ? "" : ", ● away"}
      </p>
      <ul aria-label={`Base of ${player.name}`}>
        <li>{cardName(station.cardId)}</li>
        {modules.map((module) => (
          <li key={module.instance}>
            {`${nameOf(module)} at ${String(module.x)},${String(module.y)} ${TURNS[module.q]}`}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Decision({ view, onDecide }: Pick<PlainTableProps, "view" | "onDecide">) {
  const { pending } = view;
  if (pending === null) return <p role="status">Nothing is pending.</p>;
  if ("options" in pending && pending.seat === view.you) {
    return (
      <section aria-label="Your decision">
        <p>
          You decide: <span data-decision-kind>{pending.kind}</span>
        </p>
        <ul>
          {pending.options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => {
                  onDecide(pending.id, option.id);
                }}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  const who = view.players.find((player) => player.seat === pending.seat)?.name;
  return (
    <p role="status">
      {who ?? `Seat ${String(pending.seat + 1)}`} decides: {pending.kind}
    </p>
  );
}

export function PlainTable({ view, log, history = [], onDecide }: PlainTableProps) {
  const active = view.players.find((player) => player.seat === view.turn.seat);
  return (
    <section aria-label="Table">
      <p>
        Turn {view.turn.number}, {active?.name ?? `seat ${String(view.turn.seat + 1)}`} is active (
        {view.turn.step.replace("_", " ")})
      </p>
      {view.players.map((player) => (
        <PlayerSection key={player.seat} player={player} targets={view.targets} />
      ))}
      <section aria-label="Supply">
        <h3>Supply</h3>
        <CardList cards={view.supply} />
      </section>
      <p>Deck {view.deck}</p>
      <p>Discard {view.discardCount}</p>
      <section aria-label="Your hand">
        <h3>Your hand</h3>
        <CardList cards={view.hand} />
      </section>
      <Decision view={view} onDecide={onDecide} />
      <Log lines={log} events={history} players={view.players} />
    </section>
  );
}
