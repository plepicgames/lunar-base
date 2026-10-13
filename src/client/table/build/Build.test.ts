import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../../App.tsx";
import type { GameState } from "../../connection.ts";
import { buildView, capitalView } from "../../testing/build-fixture.ts";
import { FakeWebSocket } from "../../testing/fake-socket.ts";
import { player } from "../../testing/view-fixture.ts";
import { Table } from "../Table.tsx";

let restore: () => void;
beforeEach(() => {
  restore = FakeWebSocket.install();
});
afterEach(() => {
  cleanup();
  restore();
  window.sessionStorage.clear();
});

function mount(gameView = buildView()) {
  const onDecide = vi.fn();
  const game: GameState = { game: "g1", seq: 1, view: gameView, events: [], log: [] };
  render(createElement(Table, { game, onDecide, onLeave: vi.fn() }));
  return onDecide;
}

const hand = () => within(screen.getByRole("region", { name: "Your hand" }));
const base = () => within(screen.getByRole("region", { name: "Base" }));
const bar = () => screen.getByRole("region", { name: "Your decision" });
const places = () => base().queryAllByRole("button", { name: /^Place / });
const names = (buttons: HTMLElement[]) =>
  buttons.map((button) => button.getAttribute("aria-label"));

function pick(module: string, place: string): void {
  fireEvent.click(hand().getByRole("button", { name: `Build ${module}` }));
  fireEvent.click(base().getByRole("button", { name: `Place ${module} at ${place}` }));
}

function key(name: string, init: KeyboardEventInit = {}): boolean {
  return fireEvent.keyDown(document.activeElement ?? document.body, { key: name, ...init });
}

describe("Build: Module, place, turn, Confirm", () => {
  test("the whole path sends game.decide with the id of the matching option", () => {
    render(createElement(App));
    const socket = FakeWebSocket.current;
    act(() => {
      socket.open();
      socket.receive({
        type: "welcome",
        protocol: 1,
        token: "0123456789abcdef0123456789abcdef",
        name: "Ann",
        jev: false,
      });
      socket.receive({ type: "game.update", game: "g1", seq: 1, view: buildView(), events: [] });
    });
    const sent = socket.messages.length;

    fireEvent.click(hand().getByRole("button", { name: "Build Depot" }));
    fireEvent.click(base().getByRole("button", { name: "Place Depot at 1,0" }));
    fireEvent.click(base().getByRole("button", { name: "Turn Depot" }));
    // Nothing is sent before Confirm.
    expect(socket.messages).toHaveLength(sent);

    fireEvent.click(
      within(bar()).getByRole("button", {
        name: "Confirm: Build Depot at 1,0 upside down, pay 1",
      }),
    );
    expect(socket.messages.slice(sent)).toEqual([
      { type: "game.decide", game: "g1", decision: "d6", option: "c-1:1,0,2" },
    ]);
  });

  test("only the Modules the options name can be picked; no place shows before one is", () => {
    mount();
    expect(names(hand().getAllByRole("button"))).toEqual([
      "Build Depot",
      "Build Fusion Reactor",
      null,
    ]);
    expect(places()).toHaveLength(0);
    expect(base().queryByRole("button", { name: /^Turn / })).toBeNull();
    expect(within(bar()).queryByRole("button", { name: /^Confirm/ })).toBeNull();
  });

  test("a picked Module is marked and outlines every cell a placement of it covers", () => {
    mount();
    fireEvent.click(hand().getByRole("button", { name: "Build Depot" }));
    expect(names(places())).toEqual([
      "Place Depot at 1,-1",
      "Place Depot at 2,-1",
      "Place Depot at -2,0",
      "Place Depot at -1,0",
      "Place Depot at 1,0",
      "Place Depot at 2,0",
      "Place Depot at -1,1",
      "Place Depot at 1,1",
    ]);
    expect(hand().getByRole("button", { name: "Build Depot" }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    fireEvent.click(hand().getByRole("button", { name: "Build Fusion Reactor" }));
    expect(names(places())).toEqual([
      "Place Fusion Reactor at -1,-1",
      "Place Fusion Reactor at -1,0",
      "Place Fusion Reactor at 0,2",
      "Place Fusion Reactor at 0,3",
    ]);
    expect(hand().getByRole("button", { name: "Build Depot" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  test("the Module is previewed at the place, turned as the option says; the other places stay", () => {
    mount();
    pick("Depot", "1,0");
    const preview = base().getByRole("button", { name: "Turn Depot" });
    expect(within(preview).getByRole("img", { name: "Depot" })).toBeTruthy();
    expect([preview.dataset.gridX, preview.dataset.gridY, preview.dataset.turns]).toEqual([
      "1",
      "0",
      "0",
    ]);
    expect(names(places())).toEqual([
      "Place Depot at 1,-1",
      "Place Depot at 2,-1",
      "Place Depot at -2,0",
      "Place Depot at -1,0",
      "Place Depot at 2,0",
      "Place Depot at -1,1",
      "Place Depot at 1,1",
    ]);

    // A click takes the next placement that covers the place: 0, 2, 3 and round again.
    const turns = [];
    for (let press = 0; press < 3; press += 1) {
      fireEvent.click(preview);
      turns.push(base().getByRole("button", { name: "Turn Depot" }).dataset.turns);
    }
    expect(turns).toEqual(["2", "3", "0"]);
  });

  test("R turns the previewed Module, and not with a modifier key", () => {
    mount();
    pick("Depot", "1,0");
    key("r");
    expect(base().getByRole("button", { name: "Turn Depot" }).dataset.turns).toBe("2");
    key("R");
    expect(base().getByRole("button", { name: "Turn Depot" }).dataset.turns).toBe("3");
    key("r", { ctrlKey: true });
    expect(base().getByRole("button", { name: "Turn Depot" }).dataset.turns).toBe("3");
  });

  test("picking a Module brings your Base back into focus", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "View Bea's Base" }));
    fireEvent.click(hand().getByRole("button", { name: "Build Depot" }));
    expect(base().getByRole("heading").textContent).toBe("Your Base");
    expect(places()).toHaveLength(8);
  });

  test("an opponent's Base shows no place", () => {
    mount();
    fireEvent.click(hand().getByRole("button", { name: "Build Depot" }));
    fireEvent.click(screen.getByRole("button", { name: "View Bea's Base" }));
    expect(places()).toHaveLength(0);
  });

  test("while another seat Builds nothing can be picked", () => {
    mount(buildView({ pending: { seat: 1, kind: "build" } }));
    expect(hand().queryByRole("button", { name: /^Build / })).toBeNull();
    expect(screen.getByRole("region", { name: "Decision" }).textContent).toContain("Bea");
  });
});

describe("Build: the bar before Confirm", () => {
  test("shows the price and names the Orb colours of the previewed option", () => {
    const onDecide = mount();
    expect(bar().textContent).toContain("Pick a Module in your hand");
    fireEvent.click(hand().getByRole("button", { name: "Build Depot" }));
    expect(bar().textContent).toContain("Depot: pick a place on your Base");
    expect(bar().textContent).not.toContain("Price");

    fireEvent.click(base().getByRole("button", { name: "Place Depot at 1,0" }));
    const status = () => within(bar()).getByRole("status").textContent;
    expect(status()).toContain("Price: 1 Credit.");
    expect(status()).toContain("Orbs formed: yellow.");
    expect(status()).toContain("Turn 1 of 3");

    key("r");
    expect(status()).toContain("Orbs formed: yellow, red.");
    expect(status()).toContain("Turn 2 of 3");
    expect(onDecide).not.toHaveBeenCalled();
  });

  test("the price is the option's own, whatever the Module", () => {
    mount();
    pick("Fusion Reactor", "-1,0");
    const status = within(bar()).getByRole("status").textContent;
    expect(status).toContain("Price: 2 Credits.");
    expect(status).toContain("Orbs formed: red.");
    expect(status).toContain("Turn 1 of 1");
    expect(
      within(bar()).getByRole("button", {
        name: "Confirm: Build Fusion Reactor at -1,0 upside down, pay 2",
      }),
    ).toBeTruthy();
  });
});

describe("Build: a place is any cell a placement covers", () => {
  const status = () => within(bar()).getByRole("status").textContent;
  const preview = () => base().getByRole("button", { name: "Turn Lunar Capital" });
  const lies = () => {
    const { gridX, gridY, gridWidth, turns } = preview().dataset;
    return [gridX, gridY, gridWidth, turns];
  };

  test("the bar counts the placements that cover the place", () => {
    mount(capitalView());
    pick("Lunar Capital", "-1,-1");
    expect(status()).toContain("Turn 1 of 5");

    key("r");
    key("r");
    key("r");
    expect(status()).toContain("Turn 4 of 5");
    // The Module moved up; the place it covers did not.
    expect(lies()).toEqual(["-1", "-2", "1", "0"]);

    fireEvent.click(within(bar()).getByRole("button", { name: "Back" }));
    fireEvent.click(base().getByRole("button", { name: "Place Lunar Capital at -1,-2" }));
    expect(status()).toContain("Turn 1 of 2");
  });

  test("the report's position: the place above the Station previews Lunar Capital lying across", () => {
    const onDecide = mount(capitalView());
    pick("Lunar Capital", "0,-1");
    expect(lies()).toEqual(["-1", "-1", "2", "3"]);
    expect(status()).toContain("Orbs formed: red, blue.");
    expect(status()).toContain("Turn 1 of 1.");

    fireEvent.click(
      within(bar()).getByRole("button", {
        name: "Confirm: Build Lunar Capital at -1,-1 turned left, pay 4",
      }),
    );
    expect(onDecide).toHaveBeenCalledExactlyOnceWith("d6", "c-4:-1,-1,3");
  });

  test("the picked place has no outline; the other cell of the preview keeps one", () => {
    mount(capitalView());
    pick("Lunar Capital", "0,-1");
    expect(names(places())).not.toContain("Place Lunar Capital at 0,-1");
    expect(names(places())).toContain("Place Lunar Capital at -1,-1");
  });
});

describe("Build: Skip and Escape", () => {
  test("Skip sends the skip option at every step", () => {
    const onDecide = mount();
    fireEvent.click(within(bar()).getByRole("button", { name: "Do not Build" }));
    expect(onDecide).toHaveBeenLastCalledWith("d6", "skip");

    pick("Depot", "1,0");
    fireEvent.click(within(bar()).getByRole("button", { name: "Do not Build" }));
    expect(onDecide).toHaveBeenCalledTimes(2);
    expect(onDecide).toHaveBeenLastCalledWith("d6", "skip");
  });

  test("Escape steps back from the turn to the places and from the places to the Modules", () => {
    const onDecide = mount();
    pick("Depot", "1,0");

    key("Escape");
    expect(base().queryByRole("button", { name: "Turn Depot" })).toBeNull();
    expect(places()).toHaveLength(8);
    // Focus is on the place that was left, so the keyboard goes on from there.
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Place Depot at 1,0");

    key("Escape");
    expect(places()).toHaveLength(0);
    expect(bar().textContent).toContain("Pick a Module in your hand");
    const depot = hand().getByRole("button", { name: "Build Depot" });
    expect(depot.getAttribute("aria-pressed")).toBe("false");
    expect(document.activeElement).toBe(depot);

    // With nothing chosen Escape has nothing to step back from.
    key("Escape");
    expect(bar().textContent).toContain("Pick a Module in your hand");
    expect(onDecide).not.toHaveBeenCalled();
  });

  test("the Back button does what Escape does", () => {
    mount();
    expect(within(bar()).queryByRole("button", { name: "Back" })).toBeNull();
    pick("Depot", "1,0");
    fireEvent.click(within(bar()).getByRole("button", { name: "Back" }));
    expect(places()).toHaveLength(8);
    fireEvent.click(within(bar()).getByRole("button", { name: "Back" }));
    expect(places()).toHaveLength(0);
  });

  test("Escape closes an open card view first and leaves the choice as it is", () => {
    mount();
    pick("Depot", "1,0");
    const agent = hand().getByRole("button", { name: "Investor" });
    agent.focus();
    key(" ");
    expect(screen.getByRole("dialog")).toBeTruthy();
    key("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(base().getByRole("button", { name: "Turn Depot" })).toBeTruthy();
  });

  test("a new decision starts with nothing chosen", () => {
    const onDecide = vi.fn();
    const game = (id: string): GameState => {
      const gameView = buildView();
      const pending = { ...gameView.pending, id } as GameState["view"]["pending"];
      return { game: "g1", seq: 1, view: { ...gameView, pending }, events: [], log: [] };
    };
    const props = (id: string) => ({ game: game(id), onDecide, onLeave: vi.fn() });
    const { rerender } = render(createElement(Table, props("d6")));
    pick("Depot", "1,0");
    rerender(createElement(Table, props("d9")));
    expect(places()).toHaveLength(0);
    expect(base().queryByRole("button", { name: "Turn Depot" })).toBeNull();
  });
});

/** What Tab does in a browser: focus moves to the next control in document order. */
function tab(): void {
  const stops = [
    ...document.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]'),
  ];
  const next = stops[(stops.indexOf(document.activeElement as HTMLElement) + 1) % stops.length];
  next.focus();
}

/** Tab until the control with this name has focus; fails when Tab never reaches it. */
function tabTo(name: string | RegExp): void {
  const reached = () => {
    const label = document.activeElement?.getAttribute("aria-label") ?? "";
    const text = label === "" ? (document.activeElement?.textContent ?? "") : label;
    return typeof name === "string" ? text === name : name.test(text);
  };
  for (let press = 0; press < 100 && !reached(); press += 1) tab();
  expect(reached(), `Tab reaches ${String(name)}`).toBe(true);
}

/** What Enter does on a button in a browser: a click, unless the key was taken. */
function enter(): void {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLButtonElement)) throw new Error("Enter needs a focused button");
  if (key("Enter")) fireEvent.click(focused);
}

describe("Build with the keyboard", () => {
  test("Tab, Enter and R alone pick the Module, the place and the turn and confirm", () => {
    const onDecide = mount();
    tabTo("Build Depot");
    enter();
    // Focus moves to the first place, so Tab goes on through the places.
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Place Depot at 1,-1");

    tabTo("Place Depot at 1,0");
    enter();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Turn Depot");

    key("r");
    expect(base().getByRole("button", { name: "Turn Depot" }).dataset.turns).toBe("2");
    // The turned Module keeps the focus.
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Turn Depot");

    tabTo(/^Confirm: /);
    enter();
    expect(onDecide).toHaveBeenCalledExactlyOnceWith("d6", "c-1:1,0,2");
  });

  test("Enter on the previewed Module turns it too", () => {
    mount();
    tabTo("Build Depot");
    enter();
    tabTo("Place Depot at 1,0");
    enter();
    enter();
    expect(base().getByRole("button", { name: "Turn Depot" }).dataset.turns).toBe("2");
  });

  test("Tab reaches Skip without a Module picked", () => {
    const onDecide = mount();
    tabTo("Do not Build");
    enter();
    expect(onDecide).toHaveBeenCalledExactlyOnceWith("d6", "skip");
  });
});

describe("Build options the interaction cannot place", () => {
  test("an option that names no placement keeps a button with the engine's label", () => {
    const gameView = buildView({
      players: [player(0), player(1)],
      pending: {
        id: "d6",
        seat: 0,
        kind: "build",
        options: [
          { id: "skip", label: "Do not Build" },
          { id: "c-1:0,1,0", label: "Build Depot at 0,1 upright, pay 1" },
        ],
      },
    });
    const onDecide = mount(gameView);
    expect(hand().queryByRole("button", { name: /^Build / })).toBeNull();
    // No Module can be picked, so the bar does not ask for one.
    expect(bar().textContent).not.toContain("Pick a Module");
    fireEvent.click(
      within(bar()).getByRole("button", { name: "Build Depot at 0,1 upright, pay 1" }),
    );
    expect(onDecide).toHaveBeenCalledExactlyOnceWith("d6", "c-1:0,1,0");
  });
});
