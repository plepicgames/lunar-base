import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { App } from "./App.tsx";
import { FakeWebSocket } from "./testing/fake-socket.ts";

const token = "0123456789abcdef0123456789abcdef";

let restore: () => void;
beforeEach(() => {
  restore = FakeWebSocket.install();
});
afterEach(() => {
  // Testing Library cleans up by itself only when the test globals are on.
  cleanup();
  restore();
  window.sessionStorage.clear();
});

function openApp(): void {
  render(createElement(App));
  const socket = FakeWebSocket.current;
  act(() => {
    socket.open();
  });
}

describe("Name screen", () => {
  test("shows the Lunar Base logo, one text field and one button", () => {
    openApp();
    expect(screen.getByRole("img", { name: "Lunar Base" })).toBeTruthy();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  test("typing a name and pressing the button sends hello with protocol 1 and the name", () => {
    openApp();
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Ann" } });
    fireEvent.click(screen.getByRole("button", { name: "Enter the lobby" }));
    expect(FakeWebSocket.current.messages).toEqual([{ type: "hello", protocol: 1, name: "Ann" }]);
  });

  test("the button waits for the connection", () => {
    render(createElement(App));
    const button = screen.getByRole("button", { name: "Enter the lobby" });
    expect(button).toHaveProperty("disabled", true);
    act(() => {
      FakeWebSocket.current.open();
    });
    expect(button).toHaveProperty("disabled", false);
  });

  test("name_taken shows its message and the field stays editable", () => {
    openApp();
    const field = screen.getByRole("textbox", { name: "Name" });
    fireEvent.change(field, { target: { value: "Ann" } });
    fireEvent.click(screen.getByRole("button", { name: "Enter the lobby" }));
    act(() => {
      FakeWebSocket.current.receive({
        type: "error",
        code: "name_taken",
        message: "That name is taken.",
      });
    });
    expect(screen.getByRole("alert").textContent).toBe("That name is taken.");
    expect(field).toHaveProperty("disabled", false);
    expect(field).toHaveProperty("value", "Ann");
    fireEvent.change(field, { target: { value: "Bea" } });
    fireEvent.click(screen.getByRole("button", { name: "Enter the lobby" }));
    expect(FakeWebSocket.current.messages.at(-1)).toEqual({
      type: "hello",
      protocol: 1,
      name: "Bea",
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("name_invalid shows its message", () => {
    openApp();
    act(() => {
      FakeWebSocket.current.receive({
        type: "error",
        code: "name_invalid",
        message: "Use 1 to 20 characters.",
      });
    });
    expect(screen.getByRole("alert").textContent).toBe("Use 1 to 20 characters.");
  });

  test("welcome replaces the Name screen with the lobby", () => {
    openApp();
    act(() => {
      FakeWebSocket.current.receive({
        type: "welcome",
        protocol: 1,
        token,
        name: "Ann",
        jev: false,
      });
    });
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    expect(screen.getByRole("button", { name: "Create game" })).toBeTruthy();
  });
});

const root = join(import.meta.dirname);

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

describe("client style contract", () => {
  test("tokens.css defines exactly the ten approved colour values", () => {
    const css = readFileSync(join(root, "styles/tokens.css"), "utf8");
    const colours = [...css.matchAll(/(--[\w-]+):\s*(#[\da-fA-F]{6})\b/g)].map((match) => [
      match[1],
      match[2].toUpperCase(),
    ]);
    expect(Object.fromEntries(colours)).toEqual({
      "--space-900": "#101533",
      "--space-800": "#131E4E",
      "--space-700": "#272476",
      "--nebula": "#2D1D5B",
      "--paper": "#F7F4EC",
      "--credit": "#FCB61F",
      "--colonist": "#1D8CCC",
      "--achievement": "#D81F38",
      "--influence": "#F4804E",
      "--action": "#25A8C5",
    });
    expect(colours).toHaveLength(10);
  });

  test("CSS Modules contain no literal hex colours", () => {
    for (const path of filesUnder(root).filter((path) => path.endsWith(".module.css"))) {
      expect(readFileSync(path, "utf8"), path).not.toMatch(
        /#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})\b/i,
      );
    }
  });

  test("stylesheets and HTML contain no external URL", () => {
    for (const path of filesUnder(root).filter((path) => /\.(css|html)$/.test(path))) {
      expect(readFileSync(path, "utf8"), path).not.toMatch(/https?:\/\//);
    }
  });
});
