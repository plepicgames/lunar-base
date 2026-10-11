import type { LobbyGame } from "../../protocol/messages.ts";
import styles from "./Waiting.module.css";

interface WaitingProps {
  readonly game: LobbyGame;
  readonly onLeave: () => void;
}

/**
 * The seats in seat order: the creator, the non-human players, the humans
 * who joined, then the free seats (architecture, Lobby: Seats).
 */
function seatLabels(game: LobbyGame): string[] {
  const creator = game.humans.slice(0, 1);
  const joined = game.humans.slice(1);
  const free = Math.max(0, game.humansWanted - game.humans.length);
  return [
    ...creator.map((name) => `${name}: taken`),
    ...Array.from({ length: game.bots }, () => "Non-human"),
    ...joined.map((name) => `${name}: taken`),
    ...Array.from({ length: free }, () => "Free"),
  ];
}

export function Waiting({ game, onLeave }: WaitingProps) {
  return (
    <section className={styles.panel}>
      <h2>Waiting for players</h2>
      <p className={styles.intro}>The game starts when every seat is taken.</p>
      <p>
        Influences: {game.options.influences ? "on" : "off"} · Kickstarter cards:{" "}
        {game.options.kickstarter ? "on" : "off"}
      </p>
      <p className={styles.count}>
        {game.seats - Math.max(0, game.humansWanted - game.humans.length)} of {game.seats} seats
        filled
      </p>
      <ul className={styles.seats}>
        {seatLabels(game).map((label, index) => (
          // Seats have no identity beyond their place in the list.
          <li className={label === "Free" ? styles.free : styles.taken} key={index}>
            <span>{label}</span>
          </li>
        ))}
      </ul>
      <button className={styles.button} type="button" onClick={onLeave}>
        Leave
      </button>
    </section>
  );
}
