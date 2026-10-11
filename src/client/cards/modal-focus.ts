// The focus rules of a modal dialog (architecture, Behaviour): focus goes in
// when it opens, Tab and Shift+Tab stay inside, stray focus is pulled back, and
// on close the focus returns to the control that had it.

import { useEffect, useState } from "react";
import type { RefObject } from "react";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

interface Options {
  /** Called for Escape pressed anywhere while the dialog is open. */
  readonly onEscape?: () => void;
  /** A selector for the control to focus when the one that had focus is gone. */
  readonly fallback?: string;
  /** Set to false for a view that is not modal; nothing is trapped. */
  readonly enabled?: boolean;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
}

function isTopModal(root: HTMLElement): boolean {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
  return dialogs[dialogs.length - 1] === root;
}

/**
 * Makes `ref` a modal dialog while it is mounted. The element that has the
 * focus at the first render is read before any effect can move it, so a
 * dialog that takes focus in a child still gives it back to the right place.
 */
export function useModalFocus(
  ref: RefObject<HTMLElement | null>,
  { onEscape, fallback, enabled = true }: Options = {},
): void {
  const [before] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  useEffect(() => {
    const root = ref.current;
    if (!enabled || root === null) return;
    if (isTopModal(root) && !root.contains(document.activeElement))
      (focusables(root)[0] ?? root).focus();

    const keepIn = (event: FocusEvent) => {
      if (!isTopModal(root) || root.contains(event.target as Node)) return;
      (focusables(root)[0] ?? root).focus();
    };
    const onKey = (event: KeyboardEvent) => {
      if (!isTopModal(root)) return;
      if (event.key === "Escape") {
        onEscape?.();
        return;
      }
      if (event.key !== "Tab") return;
      const stops = focusables(root);
      if (stops.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = stops[0];
      const last = stops[stops.length - 1];
      const at = document.activeElement;
      if (!root.contains(at) || (at === root && event.shiftKey)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && (at === first || at === root)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && at === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("focusin", keepIn);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("focusin", keepIn);
      document.removeEventListener("keydown", onKey);
      if (before?.isConnected === true && before !== document.body) before.focus();
      else if (fallback !== undefined) document.querySelector<HTMLElement>(fallback)?.focus();
    };
    // The handlers read the latest callbacks through the closure of this run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
