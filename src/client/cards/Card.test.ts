import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Card } from "./Card.tsx";
import { ZoomCard } from "./Zoom.tsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Card", () => {
  test("renders an image named for the card, from its w240 path", () => {
    render(createElement(Card, { cardId: "mod-depot", width: 110 }));
    const image = screen.getByRole("img", { name: "Depot" });
    expect(image.getAttribute("src")).toBe("/cards/w240/mod-depot.webp");
  });

  test("turns a card by quarter turns and draws the Deck back from back-deck", () => {
    render(
      createElement("div", null, [
        createElement(Card, { key: "a", cardId: "mod-depot", width: 110, turns: 1 }),
        createElement(Card, { key: "b", cardId: "back-deck", width: 110 }),
      ]),
    );
    const turned = screen.getByRole("img", { name: "Depot" }).parentElement as HTMLElement;
    expect(turned.dataset.rotation).toBe("90");
    expect(turned.style.transform).toBe("rotate(90deg)");
    const back = screen.getByRole("img", { name: "Deck back" });
    expect(back.getAttribute("src")).toBe("/cards/w240/back-deck.webp");
  });

  test("sizes the card from its width", () => {
    render(createElement(Card, { cardId: "mod-depot", width: 200 }));
    const frame = screen.getByRole("img", { name: "Depot" }).parentElement as HTMLElement;
    expect(frame.style.getPropertyValue("--card-width")).toBe("200px");
  });
});

describe("ZoomCard", () => {
  function open() {
    render(createElement(ZoomCard, { cardId: "mod-depot", width: 110 }));
    return screen.getByRole("button", { name: "Depot" });
  }

  test("space on a focused card opens the w591 image with its name and rules text", () => {
    const trigger = open();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: " " });
    const dialog = screen.getByRole("dialog", { name: "Depot" });
    const large = dialog.querySelector("img");
    expect(large?.getAttribute("src")).toBe("/cards/w591/mod-depot.webp");
    expect(dialog.textContent).toContain("Depot");
    expect(dialog.querySelector("p")?.textContent).toBeTruthy();
  });

  test("Escape closes the dialog and focus returns to the card", () => {
    const trigger = open();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: " " });
    const dialog = screen.getByRole("dialog", { name: "Depot" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test("hovering for half a second opens it and moving away closes it", () => {
    vi.useFakeTimers();
    const trigger = open();
    fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByRole("dialog", { name: "Depot" })).toBeTruthy();
    fireEvent.pointerLeave(trigger, { pointerType: "mouse" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a hover that ends before half a second opens nothing", () => {
    vi.useFakeTimers();
    const trigger = open();
    fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    fireEvent.pointerLeave(trigger, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a long press opens it", () => {
    vi.useFakeTimers();
    const trigger = open();
    fireEvent.pointerDown(trigger, { pointerType: "touch" });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole("dialog", { name: "Depot" })).toBeTruthy();
  });
});

describe("zoom view layout", () => {
  // jsdom has no layout, so these guard the rules that the review reproduced in
  // Chromium (lb-2v5): the view must not take the pointer from a centred card,
  // must be sized from the viewport rather than half of it, and must round by
  // its displayed width.
  const css = readFileSync("src/client/cards/Zoom.module.css", "utf8");
  const rule = (name: string) => new RegExp(`\\.${name} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";

  test("the view does not intercept the pointer", () => {
    expect(rule("zoom")).toMatch(/pointer-events:\s*none/);
  });

  test("the view is centred by margin, not by a half-viewport offset", () => {
    expect(rule("zoom")).toMatch(/inset:\s*0/);
    expect(rule("zoom")).toMatch(/margin:\s*auto/);
    expect(rule("zoom")).not.toMatch(/translate|inset:[^;]*50%/);
  });

  test("the image rounds by its displayed size, not the intrinsic 591px", () => {
    expect(rule("image")).toMatch(/border-radius:[^;]*var\(--card-radius-ratio\)[^;]*%/);
    expect(rule("image")).not.toMatch(/591px/);
  });
});
