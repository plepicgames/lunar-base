import { request } from "node:http";
import { connect, Socket } from "node:net";
import { expect, test } from "vitest";

test("removes the Jev credential from the test process", () => {
  expect(process.env.TYPESAFE_API_KEY).toBeUndefined();
});

test("blocks external fetch before a request is sent", async () => {
  await expect(fetch("https://example.com")).rejects.toThrow("Test network guard");
});

test("blocks external socket connections before a request is sent", () => {
  const socket = new Socket();
  expect(() => socket.connect(443, "example.com")).toThrow("Test network guard");
  socket.destroy();
});

test("blocks net.connect through its normalized arguments", () => {
  expect(() =>
    connect({
      port: 80,
      host: "example.com",
      lookup: () => {
        throw new Error("DNS lookup reached");
      },
    }),
  ).toThrow("Test network guard");
});

test("blocks http.request before DNS lookup", () => {
  expect(() =>
    request({
      port: 80,
      host: "example.com",
      lookup: () => {
        throw new Error("DNS lookup reached");
      },
    }),
  ).toThrow("Test network guard");
});
