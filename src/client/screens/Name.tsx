/// <reference types="vite/client" />
import { useState, type SyntheticEvent } from "react";
import type { ErrorMessage } from "../../protocol/messages.ts";
import styles from "./Name.module.css";

interface NameProps {
  /** False until the socket is open: the button waits. */
  readonly ready: boolean;
  readonly error: ErrorMessage | null;
  readonly onSubmit: (name: string) => void;
}

/** The server decides what a name is; this shows what it answered. */
const SHOWN = new Set<ErrorMessage["code"]>(["name_invalid", "name_taken"]);

export function Name({ ready, error, onSubmit }: NameProps) {
  const [name, setName] = useState("");
  const shown = error !== null && SHOWN.has(error.code) ? error : null;

  function submit(event: SyntheticEvent): void {
    event.preventDefault();
    if (ready) onSubmit(name);
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <label className={styles.label}>
        Name
        <input
          type="text"
          className={styles.field}
          value={name}
          autoFocus
          autoComplete="off"
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </label>
      <button className={styles.button} type="submit" disabled={!ready}>
        Enter the lobby
      </button>
      {shown !== null && (
        <p className={styles.error} role="alert">
          {shown.message}
        </p>
      )}
    </form>
  );
}
