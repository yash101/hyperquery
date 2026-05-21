import fs from "node:fs";
import net from "node:net";
import type { Server } from "node:net";
import { IndexerService } from "../index/indexer.js";
import { createFrameReader, writeFrame } from "../protocol/framing.js";
import type { RpcRequest, RpcResponse } from "../protocol/messages.js";
import { socketPath } from "../util/paths.js";

export class HyperDaemon {
  private server?: Server;

  constructor(private service = new IndexerService(), private sock = socketPath()) {}

  async start(): Promise<void> {
    await this.service.startWatchers();
    if (fs.existsSync(this.sock)) fs.unlinkSync(this.sock);
    this.server = net.createServer((socket) => {
      socket.on("data", createFrameReader((message) => {
        void this.handle(message as RpcRequest).then((response) => writeFrame(socket, response));
      }));
    });
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
