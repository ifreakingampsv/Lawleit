#!/usr/bin/env node
/**
 * Runs the front-end (vite, :3000) and the reference backend (:8787) together,
 * with line-prefixed output, and tears both down on exit. Combined log is
 * appended to logs/dev.log.
 *
 *   npm run dev:http     (from app/)
 *   VITE_API_MODE=http is set for the vite process automatically.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url)); // app/scripts
const root = path.resolve(appDir, "..", "..");               // repo root
const logDir = path.join(root, "logs");
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, "dev.log");

const stamp = () => new Date().toTimeString().slice(0, 8);
function pipe(child, tag) {
  const write = (line) => {
    const text = `[${stamp()}] [${tag}] ${line}`;
    console.log(text);
    fs.appendFileSync(logFile, text + "\n");
  };
  let stdoutBuf = "";
  let stderrBuf = "";
  child.stdout.on("data", (d) => {
    stdoutBuf += d;
    const lines = stdoutBuf.split("\n");
    stdoutBuf = lines.pop();
    lines.forEach(write);
  });
  child.stderr.on("data", (d) => {
    stderrBuf += d;
    const lines = stderrBuf.split("\n");
    stderrBuf = lines.pop();
    lines.forEach(write);
  });
}

const procs = [];

const api = spawn("node", [path.join(root, "backend", "server.mjs")], {
  cwd: root,
  env: { ...process.env, PORT: process.env.API_PORT ?? "8787" },
  stdio: ["ignore", "pipe", "pipe"],
});
api.on("exit", (code) => console.log(`[${stamp()}] [api] exited (${code})`));
pipe(api, "api");
procs.push(api);

// Vite is launched via node + its bin entry, not `npx`: npx is npx.cmd on
// Windows and cannot be spawned directly without a shell.
const vite = spawn(process.execPath, [path.join(root, "app", "node_modules", "vite", "bin", "vite.js")], {
  cwd: path.join(root, "app"),
  env: {
    ...process.env,
    VITE_API_MODE: "http",
    VITE_API_PROXY_TARGET: `http://127.0.0.1:${process.env.API_PORT ?? 8787}`,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
pipe(vite, "web");
procs.push(vite);

console.log(`[${stamp()}] [dev] api on :${process.env.API_PORT ?? 8787} · web on :3000 · log: logs/dev.log`);

function shutdown() {
  procs.forEach((p) => p.kill("SIGTERM"));
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
