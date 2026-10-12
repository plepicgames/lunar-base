import { useId, useRef, useState } from "react";
import { useModalFocus } from "../cards/modal-focus.ts";
import styles from "./Leave.module.css";

interface LeaveDialogProps {
  readonly onStay: () => void;
  readonly onLeave: () => void;
}

function LeaveDialog({ onStay, onLeave }: LeaveDialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Stay is first in the document: it gets the focus, so Enter does not leave.
  useModalFocus(ref, { onEscape: onStay });
  return (
    <div className={styles.backdrop}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={styles.dialog}
      >
        <h2 id={titleId}>Leave game?</h2>
        <p>
          You cannot come back to this game. If other people are still playing, a non-human player
          takes your seat and plays it to the end.
        </p>
        <div className={styles.actions}>
          <button type="button" onClick={onStay}>
            Stay
          </button>
          <button type="button" onClick={onLeave}>
            Leave game
          </button>
        </div>
      </div>
    </div>
  );
}

interface LeaveProps {
  /** Called after the player confirmed: once, unless the connection dropped since. */
  readonly onLeave: () => void;
  /** The picture table: a wide window has the button in the footer band, off the table. */
  readonly below: boolean;
  /** The connection is down, so a `game.leave` sent on it may be lost. */
  readonly interrupted: boolean;
}

/** The way out of a running game for a seated player: a button and one confirmation. */
export function Leave({ onLeave, below, interrupted }: LeaveProps) {
  const [open, setOpen] = useState(false);
  // The table stays until lobby.state answers; a second game.leave would be refused.
  const [sent, setSent] = useState(false);
  if (sent && interrupted) setSent(false);
  return (
    <>
      <button
        type="button"
        className={`${styles.leaveButton} ${below ? styles.below : ""}`}
        disabled={sent}
        onClick={() => {
          setOpen(true);
        }}
      >
        Leave game
      </button>
      {open && (
        <LeaveDialog
          onStay={() => {
            setOpen(false);
          }}
          onLeave={() => {
            setOpen(false);
            setSent(true);
            onLeave();
          }}
        />
      )}
    </>
  );
}
