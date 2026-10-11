import { Socket } from "node:net";

delete process.env.TYPESAFE_API_KEY;

const guardMessage = "Test network guard: external connections are forbidden";
const loopback = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function assertLoopback(host: string): void {
  if (!loopback.has(host.toLowerCase())) {
    throw new Error(`${guardMessage}: ${host}`);
  }
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  assertLoopback(url.hostname);
  return await originalFetch(input, init);
};

// Keep the original method to call with the socket as its receiver below.
// eslint-disable-next-line @typescript-eslint/unbound-method
const originalConnect = Socket.prototype.connect;
Socket.prototype.connect = function (...args: unknown[]): Socket {
  // net.connect and HTTP pass [options, callback] as one argument.
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const first: unknown = normalized[0];
  if (typeof first === "number" || (typeof first === "string" && /^\d+$/.test(first))) {
    assertLoopback(typeof normalized[1] === "string" ? normalized[1] : "localhost");
  } else if (typeof first === "object" && first !== null && "port" in first) {
    const host = "host" in first && typeof first.host === "string" ? first.host : "localhost";
    assertLoopback(host);
  }
  return Reflect.apply(originalConnect, this, args) as Socket;
};
