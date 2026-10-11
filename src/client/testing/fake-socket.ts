// A WebSocket the component tests drive by hand: the test opens it, hands it
// server messages and reads what the client sent. No test reaches a network.

type Listener<T> = ((event: T) => void) | null;

export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  /** Every socket made since the last `install`, oldest first. */
  static instances: FakeWebSocket[] = [];

  /** The latest socket the client opened. */
  static get current(): FakeWebSocket {
    const socket = FakeWebSocket.instances.at(-1);
    if (socket === undefined) throw new Error("The client has not opened a socket");
    return socket;
  }

  /** Replaces the global `WebSocket`. Returns the function that puts it back. */
  static install(): () => void {
    const original = globalThis.WebSocket;
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    return () => {
      globalThis.WebSocket = original;
    };
  }

  readyState: number = FakeWebSocket.CONNECTING;
  /** Frames the client sent, as text. */
  readonly sent: string[] = [];
  closeCode: number | null = null;
  onopen: Listener<Event> = null;
  onmessage: Listener<MessageEvent<string>> = null;
  onclose: Listener<CloseEvent> = null;
  onerror: Listener<Event> = null;

  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  /** The frames the client sent, parsed. */
  get messages(): Record<string, unknown>[] {
    return this.sent.map((frame) => JSON.parse(frame) as Record<string, unknown>);
  }

  send(data: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error("The socket is not open");
    this.sent.push(data);
  }

  close(code = 1000): void {
    this.closeCode = code;
    this.readyState = FakeWebSocket.CLOSED;
  }

  // Test side.

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  /** A frame from the server: text as it is, anything else as JSON. */
  receive(message: unknown): void {
    const data = typeof message === "string" ? message : JSON.stringify(message);
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  /** The server or the network ends the connection. */
  drop(code = 1006): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close", { code }));
  }
}
