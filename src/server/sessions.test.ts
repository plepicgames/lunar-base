import { afterEach, describe, expect, test, vi } from "vitest";
import { PROTOCOL_VERSION, serverMessageSchema, type ServerMessage } from "../protocol/messages.ts";
import { createSessions, PING_INTERVAL_MS, type Sessions } from "./sessions.ts";
import { memoryConnection, type Connection } from "./transport.ts";

/** A client end of a memory connection, collecting what the server sends. */
interface Client {
  readonly connection: Connection;
  readonly received: ServerMessage[];
  readonly closes: number[];
  send(message: unknown): void;
  sendRaw(text: string): void;
  last(): ServerMessage;
}

/** `answersPing` is asked at every ping of the server; false plays a dead peer. */
function connect(sessions: Sessions, answersPing: () => boolean = () => true): Client {
  const [clientEnd, serverEnd] = memoryConnection({ answersPing });
  const received: ServerMessage[] = [];
  const closes: number[] = [];
  clientEnd.onMessage((text) => {
    received.push(serverMessageSchema.parse(JSON.parse(text)));
  });
  clientEnd.onClose((code) => closes.push(code));
  sessions.accept(serverEnd);
  return {
    connection: clientEnd,
    received,
    closes,
    send: (message) => {
      clientEnd.send(JSON.stringify(message));
    },
    sendRaw: (text) => {
      clientEnd.send(text);
    },
    last: () => {
      const message = received.at(-1);
      if (message === undefined) throw new Error("nothing received");
      return message;
    },
  };
}

const hello = (name: string): unknown => ({ type: "hello", protocol: PROTOCOL_VERSION, name });

function welcomed(client: Client): { token: string; name: string } {
  const message = client.last();
  if (message.type !== "welcome") throw new Error(`expected welcome, got ${message.type}`);
  return { token: message.token, name: message.name };
}

describe("hello", () => {
  test("a disconnected lobby session expires at 30 minutes and frees its name", () => {
    vi.useFakeTimers();
    const sessions = createSessions({ jev: false });
    const ann = connect(sessions);
    ann.send(hello("Ann"));
    const { token } = welcomed(ann);
    ann.connection.close();
    vi.advanceTimersByTime(30 * 60_000 - 1);
    expect(sessions.get(token)).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(sessions.get(token)).toBeUndefined();
    const replacement = connect(sessions);
    replacement.send(hello("ann"));
    expect(replacement.last()).toMatchObject({ type: "welcome", name: "ann" });
    vi.useRealTimers();
  });

  test("resuming before expiry keeps the token and name", () => {
    vi.useFakeTimers();
    const sessions = createSessions({ jev: false });
    const ann = connect(sessions);
    ann.send(hello("Ann"));
    const { token } = welcomed(ann);
    ann.connection.close();
    vi.advanceTimersByTime(29 * 60_000);
    const resumed = connect(sessions);
    resumed.send({ type: "hello", protocol: PROTOCOL_VERSION, token });
    vi.advanceTimersByTime(2 * 60_000);
    expect(sessions.get(token)?.connection).not.toBeNull();
    expect(resumed.last()).toMatchObject({ type: "welcome", token, name: "Ann" });
    vi.useRealTimers();
  });

  test("a disconnected running seat survives 30 minutes and expires when its game ends", () => {
    vi.useFakeTimers();
    let running = true;
    const sessions = createSessions({ jev: false, isRunning: () => running });
    const ann = connect(sessions);
    ann.send(hello("Ann"));
    const { token } = welcomed(ann);
    ann.connection.close();
    vi.advanceTimersByTime(31 * 60_000);
    expect(sessions.get(token)).toBeDefined();
    running = false;
    const absent = sessions.get(token);
    if (!absent) throw new Error("Expected retained session");
    sessions.refresh(absent);
    vi.advanceTimersByTime(0);
    expect(sessions.get(token)).toBeUndefined();
    vi.useRealTimers();
  });

  test("a name returns welcome with a 32-hex token and that name", () => {
    const client = connect(createSessions({ jev: false }));
    client.send(hello("Ann"));
    const message = client.last();
    expect(message).toMatchObject({
      type: "welcome",
      protocol: PROTOCOL_VERSION,
      name: "Ann",
      jev: false,
    });
    expect(welcomed(client).token).toMatch(/^[0-9a-f]{32}$/);
  });

  test("welcome says jev: true when the server has the credential", () => {
    const client = connect(createSessions({ jev: true }));
    client.send(hello("Ann"));
    expect(client.last()).toMatchObject({ type: "welcome", jev: true });
  });

  test("two sessions get different tokens", () => {
    const sessions = createSessions({ jev: false });
    const a = connect(sessions);
    const b = connect(sessions);
    a.send(hello("Ann"));
    b.send(hello("Bo"));
    expect(welcomed(a).token).not.toBe(welcomed(b).token);
  });

  test("the name is trimmed", () => {
    const client = connect(createSessions({ jev: false }));
    client.send(hello("  Ann  "));
    expect(welcomed(client).name).toBe("Ann");
  });

  test("the same name in another case gets name_taken", () => {
    const sessions = createSessions({ jev: false });
    connect(sessions).send(hello("Ann"));
    const second = connect(sessions);
    second.send(hello("ANN"));
    expect(second.last()).toMatchObject({ type: "error", code: "name_taken" });
  });

  test("a refused name leaves the connection usable", () => {
    const sessions = createSessions({ jev: false });
    connect(sessions).send(hello("Ann"));
    const second = connect(sessions);
    second.send(hello("ann"));
    second.send(hello("Bo"));
    expect(second.last()).toMatchObject({ type: "welcome", name: "Bo" });
  });

  test.each([["   "], ["a\tb"], ["x".repeat(21)]])("name %j gets name_invalid", (name) => {
    const client = connect(createSessions({ jev: false }));
    client.send(hello(name));
    expect(client.last()).toMatchObject({ type: "error", code: "name_invalid" });
  });

  test("a new session without a name gets name_invalid", () => {
    const client = connect(createSessions({ jev: false }));
    client.send({ type: "hello", protocol: PROTOCOL_VERSION });
    expect(client.last()).toMatchObject({ type: "error", code: "name_invalid" });
  });

  test("protocol 2 gets unsupported_protocol", () => {
    const client = connect(createSessions({ jev: false }));
    client.send({ type: "hello", protocol: 2, name: "Ann" });
    expect(client.last()).toMatchObject({ type: "error", code: "unsupported_protocol" });
  });

  test("a first message that is not hello gets bad_message", () => {
    const client = connect(createSessions({ jev: false }));
    client.send({ type: "game.leave" });
    expect(client.last()).toMatchObject({ type: "error", code: "bad_message" });
    client.send(hello("Ann"));
    expect(client.last()).toMatchObject({ type: "welcome" });
  });

  test("a second hello on a bound connection gets bad_message", () => {
    const client = connect(createSessions({ jev: false }));
    client.send(hello("Ann"));
    client.send(hello("Bo"));
    expect(client.last()).toMatchObject({ type: "error", code: "bad_message" });
  });
});

describe("raw messages", () => {
  test("a message that is not JSON gets bad_message and the session stays usable", () => {
    const client = connect(createSessions({ jev: false }));
    client.sendRaw("{nope");
    expect(client.last()).toMatchObject({ type: "error", code: "bad_message" });
    client.send(hello("Ann"));
    expect(client.last()).toMatchObject({ type: "welcome", name: "Ann" });
    client.sendRaw("not json either");
    expect(client.last()).toMatchObject({ type: "error", code: "bad_message" });
    expect(client.closes).toEqual([]);
  });

  test("a bound session passes parsed messages to the handler", () => {
    const onMessage = vi.fn();
    const sessions = createSessions({ jev: false, onMessage });
    const client = connect(sessions);
    client.send(hello("Ann"));
    client.send({ type: "lobby.join", game: "g1" });
    expect(onMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: "Ann" }), {
      type: "lobby.join",
      game: "g1",
    });
  });
});

describe("resume", () => {
  test("a known token and no name returns welcome with the first name", () => {
    const sessions = createSessions({ jev: false });
    const first = connect(sessions);
    first.send(hello("Ann"));
    const { token } = welcomed(first);
    first.connection.close();
    const second = connect(sessions);
    second.send({ type: "hello", protocol: PROTOCOL_VERSION, token });
    expect(second.last()).toMatchObject({ type: "welcome", token, name: "Ann" });
  });

  test("a known token ignores a different name", () => {
    const sessions = createSessions({ jev: false });
    const first = connect(sessions);
    first.send(hello("Ann"));
    const { token } = welcomed(first);
    const second = connect(sessions);
    second.send({ type: "hello", protocol: PROTOCOL_VERSION, token, name: "Zed" });
    expect(second.last()).toMatchObject({ type: "welcome", name: "Ann" });
  });

  test("the new socket wins and the old one is closed with 4001", () => {
    const sessions = createSessions({ jev: false });
    const first = connect(sessions);
    first.send(hello("Ann"));
    const { token } = welcomed(first);
    const second = connect(sessions);
    second.send({ type: "hello", protocol: PROTOCOL_VERSION, token });
    expect(first.closes).toEqual([4001]);
    expect(second.closes).toEqual([]);
    expect(sessions.get(token)?.connection).not.toBeNull();
  });

  test("the name stays taken while the socket is down", () => {
    const sessions = createSessions({ jev: false });
    const first = connect(sessions);
    first.send(hello("Ann"));
    first.connection.close();
    const other = connect(sessions);
    other.send(hello("ann"));
    expect(other.last()).toMatchObject({ type: "error", code: "name_taken" });
  });

  test("an unknown token is a new session that needs a name", () => {
    const sessions = createSessions({ jev: false });
    const stale = "f".repeat(32);
    const bare = connect(sessions);
    bare.send({ type: "hello", protocol: PROTOCOL_VERSION, token: stale });
    expect(bare.last()).toMatchObject({ type: "error", code: "name_invalid" });
    const named = connect(sessions);
    named.send({ type: "hello", protocol: PROTOCOL_VERSION, token: stale, name: "Ann" });
    expect(named.last()).toMatchObject({ type: "welcome", name: "Ann" });
    expect(welcomed(named).token).not.toBe(stale);
  });

  test("a dropped socket unbinds the connection and tells the listener", () => {
    const onDisconnect = vi.fn();
    const sessions = createSessions({ jev: false, onDisconnect });
    const client = connect(sessions);
    client.send(hello("Ann"));
    const { token } = welcomed(client);
    client.connection.close();
    expect(sessions.get(token)?.connection).toBeNull();
    expect(onDisconnect).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ token }));
  });

  test("closing the replaced socket does not unbind the new one", () => {
    const onDisconnect = vi.fn();
    const sessions = createSessions({ jev: false, onDisconnect });
    const first = connect(sessions);
    first.send(hello("Ann"));
    const { token } = welcomed(first);
    const second = connect(sessions);
    second.send({ type: "hello", protocol: PROTOCOL_VERSION, token });
    expect(sessions.get(token)?.connection).not.toBeNull();
    expect(onDisconnect).not.toHaveBeenCalled();
  });

  test("a message from a replaced socket is dropped while its close is pending", () => {
    // A real socket keeps delivering frames until the close handshake ends;
    // the memory pair closes at once and hides that, so this one lingers.
    let deliver: (text: string) => void = () => undefined;
    const sent: string[] = [];
    const lingering: Connection = {
      send: (text) => sent.push(text),
      onMessage: (handler) => {
        deliver = handler;
      },
      onClose: () => undefined,
      close: () => undefined,
      ping: () => undefined,
      onPong: () => undefined,
      terminate: () => undefined,
    };
    const onMessage = vi.fn();
    const sessions = createSessions({ jev: false, onMessage });
    sessions.accept(lingering);
    deliver(JSON.stringify(hello("Ann")));
    const { token } = serverMessageSchema.parse(JSON.parse(sent[0] ?? "null")) as {
      token: string;
    };
    const second = connect(sessions);
    second.send({ type: "hello", protocol: PROTOCOL_VERSION, token });
    deliver(JSON.stringify({ type: "game.leave" }));
    expect(onMessage).not.toHaveBeenCalled();
    second.send({ type: "game.leave" });
    expect(onMessage).toHaveBeenCalledOnce();
  });
});

describe("heartbeat", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("the interval is 15 seconds", () => {
    expect(PING_INTERVAL_MS).toBe(15_000);
  });

  test("a socket that answers is pinged every interval and stays bound", () => {
    vi.useFakeTimers();
    const sessions = createSessions({ jev: false });
    const answersPing = vi.fn(() => true);
    const client = connect(sessions, answersPing);
    client.send(hello("Ann"));
    vi.advanceTimersByTime(PING_INTERVAL_MS - 1);
    expect(answersPing).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(answersPing).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3 * PING_INTERVAL_MS);
    expect(answersPing).toHaveBeenCalledTimes(4);
    expect(client.closes).toEqual([]);
    expect(sessions.get(welcomed(client).token)?.connection).not.toBeNull();
  });

  test("a socket that never answers a ping is dropped after the next ping interval", () => {
    vi.useFakeTimers();
    const onDisconnect = vi.fn();
    const sessions = createSessions({ jev: false, onDisconnect });
    const client = connect(sessions, () => false);
    client.send(hello("Ann"));
    const { token } = welcomed(client);
    vi.advanceTimersByTime(2 * PING_INTERVAL_MS - 1);
    expect(client.closes).toEqual([]);
    expect(onDisconnect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(client.closes).toEqual([1006]);
    expect(sessions.get(token)?.connection).toBeNull();
    expect(onDisconnect).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ token }));
  });

  test("a socket that stops answering is dropped one interval after the unanswered ping", () => {
    vi.useFakeTimers();
    let alive = true;
    const client = connect(createSessions({ jev: false }), () => alive);
    client.send(hello("Ann"));
    vi.advanceTimersByTime(3 * PING_INTERVAL_MS);
    alive = false;
    vi.advanceTimersByTime(2 * PING_INTERVAL_MS - 1);
    expect(client.closes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(client.closes).toEqual([1006]);
  });

  test("a socket that never said hello is pinged and dropped like any other", () => {
    vi.useFakeTimers();
    const client = connect(createSessions({ jev: false }), () => false);
    vi.advanceTimersByTime(2 * PING_INTERVAL_MS);
    expect(client.closes).toEqual([1006]);
  });

  test("a dropped session resumes on a new socket, which gets its own pings", () => {
    vi.useFakeTimers();
    const sessions = createSessions({ jev: false });
    const dead = connect(sessions, () => false);
    dead.send(hello("Ann"));
    const { token } = welcomed(dead);
    vi.advanceTimersByTime(2 * PING_INTERVAL_MS);
    const answersPing = vi.fn(() => true);
    const back = connect(sessions, answersPing);
    back.send({ type: "hello", protocol: PROTOCOL_VERSION, token });
    expect(back.last()).toMatchObject({ type: "welcome", token, name: "Ann" });
    vi.advanceTimersByTime(2 * PING_INTERVAL_MS);
    expect(answersPing).toHaveBeenCalledTimes(2);
    expect(back.closes).toEqual([]);
  });

  test("a closed connection trades its ping timer for an expiry timer", () => {
    vi.useFakeTimers();
    const sessions = createSessions({ jev: false });
    const client = connect(sessions);
    client.send(hello("Ann"));
    expect(vi.getTimerCount()).toBe(1);
    client.connection.close();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(30 * 60_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("pingIntervalMs sets another interval", () => {
    vi.useFakeTimers();
    const client = connect(createSessions({ jev: false, pingIntervalMs: 50 }), () => false);
    vi.advanceTimersByTime(99);
    expect(client.closes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(client.closes).toEqual([1006]);
  });
});

describe("send", () => {
  test("session.send writes a server message to the bound connection", () => {
    const sessions = createSessions({ jev: false });
    const client = connect(sessions);
    client.send(hello("Ann"));
    const session = sessions.get(welcomed(client).token);
    session?.send({ type: "lobby.state", games: [] });
    expect(client.last()).toEqual({ type: "lobby.state", games: [] });
  });
});
