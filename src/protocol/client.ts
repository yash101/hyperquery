import net from "node:net";
import { randomUUID } from "node:crypto";
import { createFrameReader, writeFrame } from "./framing.js";
import type { RpcRequest, RpcResponse } from "./messages.js";
import { socketPath } from "../util/paths.js";

export async function rpc(method: RpcRequest["method"], params: Record<string, unknown> = {}): Promise<unknown> {
  const socket = net.createConnection(socketPath());
  const id = randomUUID();
  const request: RpcRequest = { id, method, params };
  return new Promise((resolve, reject) => {
    socket.once("error", (error) => reject(new Error(`${error.message}. Is hypercode-daemon running?`)));
    socket.on("data", createFrameReader((message) => {
      const response = message as RpcResponse;
      socket.end();
      if (!response.ok) reject(new Error(response.error ?? "Unknown daemon error"));
      else resolve(response.result);
    }));
    socket.once("connect", () => writeFrame(socket, request));
  });
}
