// One player's public counters: Credits, colonists and achievements each
// against its target, and the hand size as a number on a Deck back. Opponents
// and you use this one component. It draws only what the view publishes: no
// opponent Influences, and no card of an opponent hand (architecture, Hidden information).

import type { GameView } from "../../protocol/messages.ts";
import { assetUrl } from "../base.ts";
import { Card, DECK_BACK } from "../cards/Card.tsx";
import styles from "./Counters.module.css";

type Player = GameView["players"][number];

interface CountersProps {
  readonly player: Player;
  readonly targets: GameView["targets"];
  /** The name as the group is announced; defaults to the player's name. */
  readonly label?: string;
  /** Present only for the owner when the Influence option is on. */
  readonly influenceCount?: number;
}

interface CounterProps {
  readonly name: string;
  readonly value: number;
  readonly target: number;
  readonly badge: string;
  readonly tone: string;
}

function Counter({ name, value, target, badge, tone }: CounterProps) {
  return (
    <span
      role="group"
      aria-label={`${name} ${String(value)} of ${String(target)}`}
      className={`${styles.counter} ${tone}`}
    >
      <img className={styles.badge} src={assetUrl(`brand/badges/${badge}.webp`)} alt="" />
      <span className={styles.value}>
        {value}/{target}
      </span>
    </span>
  );
}

function CreditDial({ value, target }: { readonly value: number; readonly target: number }) {
  const limit = Math.max(target, value, 1);
  const angle = -150 + (300 * Math.max(0, value)) / limit;
  const position = (number: number) => ((-240 + (number * 300) / limit) * Math.PI) / 180;
  const labels = [0, Math.round(limit / 2), limit];
  return (
    <span
      role="group"
      aria-label={`Credits ${String(value)} of ${String(target)}`}
      className={styles.dial}
    >
      <svg className={styles.dialRing} viewBox="0 0 80 80" aria-hidden="true">
        <circle cx="40" cy="40" r="35" fill="none" stroke="currentColor" strokeWidth="1" />
        {Array.from({ length: limit + 1 }, (_, number) => {
          const tickAngle = position(number);
          return (
            <line
              key={number}
              data-credit-tick={number}
              data-current={number === value ? "true" : undefined}
              x1={40 + 31 * Math.cos(tickAngle)}
              y1={40 + 31 * Math.sin(tickAngle)}
              x2={40 + 35 * Math.cos(tickAngle)}
              y2={40 + 35 * Math.sin(tickAngle)}
              stroke="currentColor"
              strokeWidth={number === value ? 2 : 1}
            />
          );
        })}
        {labels.map((label) => (
          <text
            key={label}
            x={40 + 23 * Math.cos(position(label))}
            y={40 + 23 * Math.sin(position(label))}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {label}
          </text>
        ))}
        <g className={styles.dialMarker} style={{ transform: `rotate(${String(angle)}deg)` }}>
          <circle cx="40" cy="5" r="4" fill="currentColor" />
        </g>
      </svg>
      <span className={styles.dialReadout}>
        <span>{value}</span>/<span>{target}</span>
      </span>
    </span>
  );
}

export function Counters({ player, targets, label, influenceCount }: CountersProps) {
  return (
    <section
      role="group"
      aria-label={label ?? player.name}
      className={styles.counters}
      data-seat={player.seat}
    >
      <header className={styles.heading}>
        <span className={styles.name}>{player.name}</span>
        <span className={styles.kind}>{player.kind === "bot" ? "non-human" : "human"}</span>
        <span className={player.connected ? styles.connected : styles.disconnected}>
          {player.connected ? "connected" : "● away"}
        </span>
      </header>
      <div className={styles.row}>
        <CreditDial value={player.credits} target={targets.credits} />
        <Counter
          name="Colonists"
          value={player.colonists}
          target={targets.colonists}
          badge="colonists"
          tone={styles.colonists}
        />
        <span
          role="group"
          aria-label={`Hand ${String(player.handSize)} cards`}
          className={styles.hand}
        >
          <Card cardId={DECK_BACK} width={28} />
          <span className={styles.handSize}>{player.handSize}</span>
        </span>
        <span
          role="group"
          aria-label={`Achievements ${String(player.achievements.length)} of ${String(targets.achievements)}`}
          className={`${styles.counter} ${styles.achievements}`}
        >
          <img
            className={styles.badge}
            src={assetUrl("brand/badges/scientific-achievement.webp")}
            alt=""
          />
          <span className={styles.value}>
            {player.achievements.length}/{targets.achievements}
          </span>
          <span className={styles.icons}>
            {player.achievements.map((name) => (
              <img
                key={name}
                className={styles.icon}
                src={assetUrl(`brand/achievements/${name}.webp`)}
                alt={`Achievement ${name.replace("_", " ")}`}
              />
            ))}
          </span>
        </span>
        {influenceCount === undefined ? null : (
          <span
            role="group"
            aria-label={`Influences ${String(influenceCount)} of 4`}
            className={styles.counter}
          >
            <span className={styles.value}>{influenceCount}/4</span>
          </span>
        )}
      </div>
    </section>
  );
}
