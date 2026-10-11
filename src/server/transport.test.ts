import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vitest";
import type { WebSocket } from "ws";
import { memoryConnection, wsConnection } from "./transport.ts";

describe("memoryConnection", () => {
  test("a text sent on one end arrives on the other", () => {
    const [a, b] = memoryConnection();
    const atA = vi.fn();
    const atB = vi.fn();
    a.onMessage(atA);
    b.onMessage(atB);
    a.send("one");
    b.send("two");
    expect(atB).toHaveBeenCalledExactlyOnceWith("one");
    expect(atA).toHaveBeenCalledExactlyOnceWith("two");
  });

  test("closing one end closes both with the code", () => {
    const [a, b] = memoryConnection();
    const atA = vi.fn();
    const atB = vi.fn();
    a.onClose(atA);
    b.onClose(atB);
    a.close(4001);
    expect(atA).toHaveBeenCalledExactlyOnceWith(4001);
    expect(atB).toHaveBeenCalledExactlyOnceWith(4001);
  });

  test("a closed connection drops sends and closes once", () => {
    const [a, b] = memoryConnection();
    const atB = vi.fn();
    const closed = vi.fn();
    b.onMessage(atB);
    b.onClose(closed);
    a.close();
    a.send("late");
    b.close();
    expect(atB).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledTimes(1);
  });

  test("a ping is answered with a pong on the pinging end only", () => {
    const [a, b] = memoryConnection();
    const atA = vi.fn();
    const atB = vi.fn();
    a.onPong(atA);
    b.onPong(atB);
    a.ping();
    expect(atA).toHaveBeenCalledTimes(1);
    expect(atB).not.toHaveBeenCalled();
  });

  test("a peer that does not answer pings sends no pong", () => {
    let answers = false;
    const [a] = memoryConnection({ answersPing: () => answers });
    const pong = vi.fn();
    a.onPong(pong);
    a.ping();
    expect(pong).not.toHaveBeenCalled();
    answers = true;
    a.ping();
    expect(pong).toHaveBeenCalledTimes(1);
  });

  test("terminate closes both ends with 1006 and a later ping gets no pong", () => {
    const [a, b] = memoryConnection();
    const atA = vi.fn();
    const atB = vi.fn();
    const pong = vi.fn();
    a.onClose(atA);
    b.onClose(atB);
    a.onPong(pong);
    a.terminate();
    a.ping();
    expect(atA).toHaveBeenCalledExactlyOnceWith(1006);
    expect(atB).toHaveBeenCalledExactlyOnceWith(1006);
    expect(pong).not.toHaveBeenCalled();
  });
});

/** The part of a ws socket that wsConnection uses. */
class FakeSocket extends EventEmitter {
  readyState = 1;
  readonly sent: string[] = [];
  readonly closed: [number | undefined, string | undefined][] = [];
  send(text: string): void {
    this.sent.push(text);
  }
  close(code?: number, reason?: string): void {
    this.closed.push([code, reason]);
  }
  pings = 0;
  terminated = 0;
  ping(): void {
    this.pings++;
  }
  terminate(): void {
    this.terminated++;
  }
}

function wrap(): { socket: FakeSocket; connection: ReturnType<typeof wsConnection> } {
  const socket = new FakeSocket();
  return { socket, connection: wsConnection(socket as unknown as WebSocket) };
}

describe("wsConnection", () => {
  test("sends text and passes text frames to the handler", () => {
    const { socket, connection } = wrap();
    const handler = vi.fn();
    connection.onMessage(handler);
    connection.send("out");
    socket.emit("message", Buffer.from("in"), false);
    expect(socket.sent).toEqual(["out"]);
    expect(handler).toHaveBeenCalledExactlyOnceWith("in");
  });

  test("a binary frame closes the socket with 1003", () => {
    const { socket, connection } = wrap();
    const handler = vi.fn();
    connection.onMessage(handler);
    socket.emit("message", Buffer.from([1, 2]), true);
    expect(handler).not.toHaveBeenCalled();
    expect(socket.closed).toEqual([[1003, undefined]]);
  });

  test("does not send on a socket that is not open", () => {
    const { socket, connection } = wrap();
    socket.readyState = 3;
    connection.send("late");
    expect(socket.sent).toEqual([]);
  });

  test("reports the close code once", () => {
    const { socket, connection } = wrap();
    const closed = vi.fn();
    connection.onClose(closed);
    socket.emit("close", 1001);
    expect(closed).toHaveBeenCalledExactlyOnceWith(1001);
  });

  test("close passes its code and reason to the socket", () => {
    const { socket, connection } = wrap();
    connection.close(4001, "replaced");
    expect(socket.closed).toEqual([[4001, "replaced"]]);
  });

  test("ping reaches an open socket only, and a pong frame reaches the handler", () => {
    const { socket, connection } = wrap();
    const pong = vi.fn();
    connection.onPong(pong);
    connection.ping();
    expect(socket.pings).toBe(1);
    socket.emit("pong", Buffer.alloc(0));
    expect(pong).toHaveBeenCalledTimes(1);
    socket.readyState = 3;
    connection.ping();
    expect(socket.pings).toBe(1);
  });

  test("terminate destroys the socket without a close handshake", () => {
    const { socket, connection } = wrap();
    connection.terminate();
    expect(socket.terminated).toBe(1);
    expect(socket.closed).toEqual([]);
  });

  test("a socket error is not thrown; the close that follows reports the drop", () => {
    const { socket, connection } = wrap();
    const closed = vi.fn();
    connection.onClose(closed);
    expect(() => socket.emit("error", new Error("invalid frame"))).not.toThrow();
    socket.emit("close", 1002);
    expect(closed).toHaveBeenCalledExactlyOnceWith(1002);
  });
});
