#!/usr/bin/env node
import { HyperDaemon } from "./server.js";
import { socketPath } from "../util/paths.js";

const daemon = new HyperDaemon();
await daemon.start();
console.log(`hypercode-daemon listening on ${socketPath()}`);

const stop = async () => {
  await daemon.stop();
  process.exit(0);
};

process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
