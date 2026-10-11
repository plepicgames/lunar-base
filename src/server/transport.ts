// The server's view of one client: a text channel. `wsConnection` wraps a
// WebSocket, `memoryConnection` gives the tests a pair with no network.

import type { WebSocket } from "ws";

export interface Connection {
  send(text: string): void;
  onMessage(handler: (text: string) => void): void;
  /** `code` is the WebSocket close code. */
  onClose(handler: (code: number) => void): void;
  close(code?: number, reason?: string): void;
  /** Asks the peer for a sign of life; a live peer answers with a pong. */
  ping(): void;
  onPong(handler: () => void): void;
  /** Drops the connection without a close handshake; `onClose` gets 1006. */
  terminate(): void;
}

const OPEN = 1;
const UNSUPPORTED_DATA = 1003;
const ABNORMAL_CLOSURE = 1006;

/** A text frame arrives as one Buffer unless the socket is set to fragments. */
function frameText(data: Buffer | ArrayBuffer | Buffer[]): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data)).toString("utf8");
  return data.toString("utf8");
}

export function wsConnection(socket: WebSocket): Connection {
  // ws reports a malformed frame as an `error` event and then closes the
  // socket. With no listener the event would throw and stop the server; the
  // close that follows is all the server needs.
  socket.on("error", () => undefined);
  return {
    send(text) {
      if (socket.readyState === OPEN) socket.send(text);
    },
    onMessage(handler) {
      socket.on("message", (data, isBinary) => {
        // The protocol is text only.
        if (isBinary) socket.close(UNSUPPORTED_DATA);
        else handler(frameText(data));
      });
    },
    onClose(handler) {
      socket.on("close", handler);
    },
    close(code, reason) {
      socket.close(code, reason);
    },
    ping() {
      if (socket.readyState === OPEN) socket.ping();
    },
    onPong(handler) {
      socket.on("pong", () => {
        handler();
      });
    },
    terminate() {
      socket.terminate();
    },
  };
}

export interface MemoryOptions {
  /** Asked at every ping. A browser always answers; false plays a dead peer. */
  readonly answersPing?: () => boolean;
}

/**
 * A connected pair. A text sent on one end reaches the other end's handler at
 * once; closing either end closes both. Nothing is sent after a close. A ping
 * is answered at once with a pong, as a WebSocket peer does by itself.
 */
export function memoryConnection(options: MemoryOptions = {}): [Connection, Connection] {
  const state = { closed: false };
  const handlers: {
    message: ((text: string) => void)[];
    close: ((code: number) => void)[];
    pong: (() => void)[];
  }[] = [
    { message: [], close: [], pong: [] },
    { message: [], close: [], pong: [] },
  ];

  function close(code: number): void {
    if (state.closed) return;
    state.closed = true;
    for (const side of handlers) for (const handler of side.close) handler(code);
  }

  function end(own: number, other: number): Connection {
    return {
      send(text) {
        if (state.closed) return;
        for (const handler of handlers[other].message) handler(text);
      },
      onMessage(handler) {
        handlers[own].message.push(handler);
      },
      onClose(handler) {
        handlers[own].close.push(handler);
      },
      close(code = 1000) {
        close(code);
      },
      ping() {
        if (state.closed || options.answersPing?.() === false) return;
        for (const handler of handlers[own].pong) handler();
      },
      onPong(handler) {
        handlers[own].pong.push(handler);
      },
      terminate() {
        close(ABNORMAL_CLOSURE);
      },
    };
  }

  return [end(0, 1), end(1, 0)];
}
