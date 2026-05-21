import http from "node:http";
import { randomUUID } from "node:crypto";
import type { RpcMethod, RpcRequest, RpcResponse } from "./messages.js";
import { socketPath } from "../util/paths.js";

export async function rpc(method: RpcMethod, params: Record<string, unknown> = {}): Promise<unknown> {
  const body = JSON.stringify({ id: randomUUID(), method, params } satisfies RpcRequest);
  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath: socketPath(),
      path: "/rpc",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body)
      }
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.once("end", () => {
        try {
          const response = JSON.parse(Buffer.concat(chunks).toString("utf8")) as RpcResponse;
          if (!response.ok) reject(new Error(response.error ?? `HTTP ${res.statusCode ?? "error"}`));
          else resolve(response.result);
        } catch (error) {
          reject(error);
        }
      });
    });
    req.once("error", (error) => reject(new Error(`${error.message}. Is hypercode-daemon running?`)));
    req.end(body);
  });
}
