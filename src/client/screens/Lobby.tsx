import { useState, type SyntheticEvent } from "react";
import type { BotBrain, ErrorMessage, LobbyGame } from "../../protocol/messages.ts";
import styles from "./Lobby.module.css";

interface LobbyProps {
  readonly jev?: boolean;
  readonly games: readonly LobbyGame[];
  /** The latest refusal, shown as the server worded it. */
  readonly error: ErrorMessage | null;
  readonly onCreate: (options: {
    seats: number;
    bots: number;
    influences: boolean;
    kickstarter: boolean;
    botBrain?: BotBrain;
  }) => void;
  readonly onJoin: (game: string) => void;
}

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;

/** The number in `text` held between `min` and `max`; `fallback` when it is no number. */
function clamp(text: string, min: number, max: number, fallback: number): number {
  const value = Number.parseInt(text, 10);
  if (Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function Lobby({ games, error, onCreate, onJoin, jev = false }: LobbyProps) {
  const [seats, setSeats] = useState(MIN_PLAYERS);
  const [bots, setBots] = useState(0);
  const [botBrain, setBotBrain] = useState<BotBrain>("builtin");
  const [influences, setInfluences] = useState(false);
  const [kickstarter, setKickstarter] = useState(false);

  function submit(event: SyntheticEvent): void {
    event.preventDefault();
    onCreate({
      seats,
      bots,
      influences,
      kickstarter,
      ...(jev && botBrain === "jev" ? { botBrain } : {}),
    });
  }

  return (
    <section className={styles.layout}>
      <div className={styles.panel}>
        <h2>Open games</h2>
        {games.length === 0 ? (
          <p className={styles.empty}>No open games.</p>
        ) : (
          <ul className={styles.games}>
            {games.map((game) => (
              <li className={styles.game} key={game.id}>
                <span className={styles.gameInfo}>
                  <strong>{game.creator}</strong>
                  <span>
                    {game.seats} players · {game.humans.length} of {game.humansWanted} humans joined
                    · {game.bots} non-human
                  </span>
                  <small>
                    Influences: {game.options.influences ? "on" : "off"} · Kickstarter cards:{" "}
                    {game.options.kickstarter ? "on" : "off"}
                  </small>
                </span>
                <button
                  className={styles.button}
                  type="button"
                  onClick={() => {
                    onJoin(game.id);
                  }}
                >
                  Join
                </button>
              </li>
            ))}
          </ul>
        )}
        {error !== null && (
          <p className={styles.error} role="alert">
            {error.message}
          </p>
        )}
      </div>
      <form className={styles.panel} onSubmit={submit}>
        <h2>Create a game</h2>
        <label className={styles.field}>
          Players
          <input
            type="number"
            min={MIN_PLAYERS}
            max={MAX_PLAYERS}
            value={seats}
            onChange={(event) => {
              const next = clamp(event.target.value, MIN_PLAYERS, MAX_PLAYERS, seats);
              setSeats(next);
              setBots((current) => Math.min(current, next));
            }}
          />
        </label>
        <label className={styles.field}>
          Non-human players
          <input
            type="number"
            min={0}
            max={seats}
            value={bots}
            onChange={(event) => {
              setBots(clamp(event.target.value, 0, seats, bots));
            }}
          />
        </label>
        {jev ? (
          <label className={styles.field}>
            Non-human brain
            <select
              value={botBrain}
              onChange={(event) => {
                setBotBrain(event.target.value === "jev" ? "jev" : "builtin");
              }}
            >
              <option value="builtin">Built-in player</option>
              <option value="jev">Jev</option>
            </select>
          </label>
        ) : (
          <p>Non-human players use the built-in player.</p>
        )}
        <label className={styles.option}>
          <input
            type="checkbox"
            checked={influences}
            onChange={(event) => {
              setInfluences(event.target.checked);
            }}
          />
          Influences
        </label>
        <label className={styles.option}>
          <input
            type="checkbox"
            checked={kickstarter}
            onChange={(event) => {
              setKickstarter(event.target.checked);
            }}
          />
          Kickstarter cards
        </label>
        <p>Kickstarter cards have no printed rules and follow the readings of the specification.</p>
        <button className={styles.button} type="submit">
          Create game
        </button>
      </form>
    </section>
  );
}
