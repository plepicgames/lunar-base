import type { GameView } from "../../protocol/messages.ts";
import type { GameState } from "../connection.ts";
import { Card } from "../cards/Card.tsx";
import styles from "./Result.module.css";

interface ResultProps {
  readonly view: GameView;
  readonly onBack: () => void;
  readonly history?: GameState["events"];
}

function names(view: GameView, seats: readonly number[]): string {
  const list = seats.map(
    (seat) =>
      view.players.find((player) => player.seat === seat)?.name ?? `Seat ${String(seat + 1)}`,
  );
  return list.length > 1
    ? `${list.slice(0, -1).join(", ")} and ${list.at(-1) ?? ""}`
    : (list[0] ?? "");
}

function headline(view: GameView, result: NonNullable<GameView["result"]>): string {
  switch (result.reason) {
    case "victory":
      return result.winners.length > 1
        ? `${names(view, result.winners)} share the victory`
        : `${names(view, result.winners)} wins`;
    case "step_limit":
      return "The game was stopped: it ran past its step limit. Nobody won.";
    case "turn_limit":
      return "The game was stopped: it ran past its turn limit. Nobody won.";
    case "engine_error":
      return "The game was stopped by an error. Nobody won.";
  }
}

function met(value: number, target: number): string {
  return `${String(value)} of ${String(target)}: ${value >= target ? "met" : "not met"}`;
}

function condition(label: string, value: number, target: number, badge: string) {
  return (
    <li className={`${styles.condition} ${value >= target ? styles.met : styles.unmet}`}>
      <img src={`/brand/badges/${badge}.webp`} alt="" />
      <span>
        {label} {met(value, target)}
      </span>
    </li>
  );
}

export function Result({ view, history = [], onBack }: ResultProps) {
  const { result, targets } = view;
  if (result === null) return null;
  const reveal = history.findLast((event) => event.type === "influences_revealed");
  return (
    <section className={styles.result} aria-label="Result">
      <p className={styles.eyebrow}>Game result</p>
      <h2>{headline(view, result)}</h2>
      <div className={styles.players}>
        {view.players.map((player) => (
          <section className={styles.player} key={player.seat} aria-label={player.name}>
            <h3>{player.name}</h3>
            <ul className={styles.conditions}>
              {condition("Credits", player.credits, targets.credits, "credits")}
              {condition("colonists", player.colonists, targets.colonists, "colonists")}
              {condition(
                "achievements",
                player.achievements.length,
                targets.achievements,
                "scientific-achievement",
              )}
            </ul>
            {reveal?.type === "influences_revealed" &&
            reveal.seat === player.seat &&
            result.winners.includes(player.seat) ? (
              <section aria-label="Revealed Influences">
                <h4>Revealed Influences</h4>
                <div className={styles.revealed}>
                  {reveal.cards.map((card) => (
                    <Card key={card.instance} cardId={card.cardId} width={85} />
                  ))}
                </div>
              </section>
            ) : null}
            <p className={styles.score}>score {result.scores[player.seat] ?? 0}</p>
          </section>
        ))}
      </div>
      <button className={styles.button} type="button" onClick={onBack}>
        Back to lobby
      </button>
    </section>
  );
}
