import { useEffect, useId, useRef, useState } from "react";
import { assetUrl } from "../base.ts";
import { useModalFocus } from "../cards/modal-focus.ts";
import styles from "./Help.module.css";

const pages = [4, 21, 22, 23, 24, 25, 26] as const;

const readings = [
  "Placement: Modules cover two grid cells; touching Orb halves must match. Blank edges may touch.",
  "Game end: victory is checked after each state change. At turn end, Shuttle Credits and the active player's four Influences are checked together.",
  "Achievements: only icons printed on cards count. Asteroid Grinder and Inflatable Habitat have none.",
  "Influence defence: an affected player may ignore an Agent's remaining effects on them or their Base, after the Agent's choices and before the effect.",
  "Kickstarter cards: optional, with eight Influences per game. Transparency shows only the Deck top and hides the Discard pile while active.",
  "Non-human seats: any number, including every seat. An all-bot game's creator watches the public view.",
  "Service limits: a game with no winner stops after 300 turns; a turn stops after 5,000 engine steps.",
] as const;

function HelpDialog({ onClose }: { readonly onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [index, setIndex] = useState(0);
  useModalFocus(ref, { onEscape: onClose });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        setIndex((current) =>
          Math.max(0, Math.min(pages.length - 1, current + (event.key === "ArrowRight" ? 1 : -1))),
        );
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  const page = pages[index];
  return (
    <div className={styles.backdrop}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={styles.dialog}
      >
        <header className={styles.header}>
          <h2 id={titleId}>Rulebook help</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <div className={styles.content}>
          <section className={styles.pages} aria-label="Rulebook pages">
            <img
              src={assetUrl(`help/page-${String(page)}.webp`)}
              alt={`Rulebook page ${String(page)}`}
            />
            <nav className={styles.navigation} aria-label="Help pages">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => {
                  setIndex(index - 1);
                }}
              >
                Previous
              </button>
              <span>
                Page {page} · {index + 1} of {pages.length}
              </span>
              <button
                type="button"
                disabled={index === pages.length - 1}
                onClick={() => {
                  setIndex(index + 1);
                }}
              >
                Next
              </button>
            </nav>
          </section>
          <aside className={styles.readings} aria-label="Lunar Base rulings">
            <h3>How this game reads the rules</h3>
            <p>These choices fill gaps in the printed rulebook.</p>
            <ul>
              {readings.map((reading) => (
                <li key={reading}>{reading}</li>
              ))}
            </ul>
          </aside>
        </div>
      </div>
    </div>
  );
}

export function Help() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.key !== "?" ||
        (target instanceof HTMLElement &&
          (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)))
      )
        return;
      event.preventDefault();
      setOpen(true);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <>
      <button
        type="button"
        className={styles.helpButton}
        onClick={() => {
          setOpen(true);
        }}
      >
        Help
      </button>
      {open && (
        <HelpDialog
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
