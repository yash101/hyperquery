import fs from "node:fs";
import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { IndexerService } from "../index/indexer.js";
import type { RpcRequest, RpcResponse } from "../protocol/messages.js";
import { socketPath } from "../util/paths.js";

export class HyperDaemon {
  private server?: Server;

  constructor(private service = new IndexerService(), private sock = socketPath()) {}

  async start(): Promise<void> {
    if (fs.existsSync(this.sock)) fs.unlinkSync(this.sock);

    this.server = http.createServer((req, res) => this.handleHttp(req, res));

    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.sock, resolve);
    });
  }

  async stop(): Promise<void> {
    this.service.close();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    if (fs.existsSync(this.sock)) fs.unlinkSync(this.sock);
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (req.method !== "POST" || req.url !== "/rpc") {
        writeJson(res, 404, { ok: false, error: "Not found" });
        return;
      }
      const request = await readJson(req) as RpcRequest;
      const response = await this.handle(request);
      writeJson(res, response.ok ? 200 : 400, response);
    } catch (error) {
      writeJson(res, 500, {
        id: randomUUID(),
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async handle(request: RpcRequest): Promise<RpcResponse> {
    try {
      switch (request.method) {
        case "health":
          return ok(request.id, { status: "ok", indexing: this.service.indexingStatus() });
        case "shutdown":
          setTimeout(() => void this.stop(), 10);
          return ok(request.id, { status: "stopping" });
        case "add_root":
          return ok(request.id, await this.service.addRoot(String(request.params?.path)));
        case "remove_root":
          return ok(request.id, await this.service.removeRoot(String(request.params?.root)));
        case "list_roots":
          return ok(request.id, this.service.listRoots());
        case "indexing_status":
          return ok(request.id, this.service.indexingStatus(typeof request.params?.root === "string" ? request.params.root : undefined));
        case "search":
          return ok(request.id, await this.service.search(String(request.params?.query), {
            root: typeof request.params?.root === "string" ? request.params.root : undefined,
            limit: typeof request.params?.limit === "number" ? request.params.limit : undefined
          }));
        case "inspect_symbol":
          return ok(request.id, this.service.inspectSymbol(String(request.params?.fqn), typeof request.params?.root === "string" ? request.params.root : undefined));
        case "get_record":
          return ok(request.id, this.service.getRecord(Number(request.params?.record_id)) ?? null);
        case "get_parent":
          return ok(request.id, this.service.getParent(Number(request.params?.record_id)));
        case "get_children":
          return ok(request.id, this.service.getChildren(Number(request.params?.record_id)));
        case "get_duplicates":
          return ok(request.id, this.service.getDuplicates(Number(request.params?.record_id)));
        case "read_record":
          return ok(request.id, await this.service.readRecord(Number(request.params?.record_id)));
        case "debug_sqlite_fts5":
          this.requireDebug();
          return ok(request.id, this.service.debugSqliteFts5(String(request.params?.query), typeof request.params?.limit === "number" ? request.params.limit : undefined));
        case "debug_sqlite_raw":
          this.requireDebug();
          return ok(request.id, this.service.debugSqliteRaw(String(request.params?.sql)));
        case "debug_lmdb":
          this.requireDebug();
          return ok(request.id, this.service.debugLmdb(String(request.params?.prefix), typeof request.params?.count === "number" ? request.params.count : undefined));
        case "debug_dump_record":
          this.requireDebug();
          return ok(request.id, this.service.debugDumpRecord(Number(request.params?.record_id)));
        case "debug_dump_file":
          this.requireDebug();
          return ok(request.id, this.service.debugDumpFile(String(request.params?.root_id), String(request.params?.file)));
        case "debug_stats":
          this.requireDebug();
          return ok(request.id, this.service.debugStats());
        default:
          return { id: request.id, ok: false, error: `Unknown method: ${request.method}` };
      }
    } catch (error) {
      return { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private requireDebug(): void {
    if (process.env.DEBUG !== "true") throw new Error("Debug commands require DEBUG=true on the daemon process");
  }
}

function ok(id: string, result: unknown): RpcResponse {
  return { id, ok: true, result };
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.once("error", reject);
    req.once("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function writeJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text)
  });
  res.end(text);
}
