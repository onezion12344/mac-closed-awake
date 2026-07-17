#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import net from "node:net";

const SOCKET = "/tmp/com.mca.helper.sock";

const TOOLS = [
  {
    name: "mca_start",
    description: "Disable system sleep — Mac stays awake even with lid closed. Pass duration_seconds. Auto-restores via timer. Use 0 for forever mode.",
    inputSchema: { type: "object", properties: { duration_seconds: { type: "number", description: "Seconds. 1800=30min, 3600=1h, 7200=2h, 0=forever." } }, required: ["duration_seconds"] },
  },
  {
    name: "mca_stop",
    description: "Immediately re-enable normal sleep. Kills any pending auto-restore timers.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "mca_status",
    description: "Check current disablesleep state and any running background restore timers.",
    inputSchema: { type: "object", properties: {} },
  },
];

function helperSend(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    sock.setTimeout(3000);
    sock.connect(SOCKET, () => sock.write(cmd));
    sock.on("data", (d) => { const m = d.toString().trim(); sock.destroy(); resolve(m); });
    sock.on("error", () => { sock.destroy(); reject(new Error("Helper not running. Run `mca` app and install helper.")); });
    sock.on("timeout", () => { sock.destroy(); reject(new Error("Helper timeout")); });
  });
}

function exec(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let o = "", e = "";
    c.stdout.on("data", (d: Buffer) => (o += d.toString()));
    c.stderr.on("data", (d: Buffer) => (e += d.toString()));
    c.on("close", (code) => resolve({ stdout: o.trim(), stderr: e.trim(), code: code ?? 0 }));
  });
}

async function mcaStart(secs: number): Promise<string> {
  await helperSend("DISABLE");
  if (secs > 0) {
    spawn("sh", ["-c", `sleep ${secs} && ${process.argv[0]} -e "const net = require('net'); const s = new net.Socket(); s.connect('${SOCKET}', () => s.write('ENABLE')); s.on('data', () => s.destroy());"`], { detached: true, stdio: "ignore" }).unref();
    return secs >= 60
      ? `✅ Sleep disabled for ${Math.round(secs / 60)} min. Auto-restore in ${secs}s.`
      : `✅ Sleep disabled for ${secs}s.`;
  }
  return `✅ Sleep disabled forever. Use mca_stop to restore.`;
}

async function mcaStop(): Promise<string> {
  await helperSend("ENABLE");
  return "✅ Sleep re-enabled.";
}

async function mcaStatus(): Promise<string> {
  try {
    const status = await helperSend("STATUS");
    const isOn = status === "1";
    return isOn ? "🟢 Sleep disabled (Mac will stay awake)" : "⚪ Sleep normal (Mac will sleep on lid close)";
  } catch (e) {
    return `⚠️ Helper not running. Start the MacClosedAwake app to install it.\nError: ${e}`;
  }
}

async function handle(req: { id: number | string; method: string; params?: Record<string, unknown> }): Promise<object | null> {
  const { id, method, params } = req;
  switch (method) {
    case "initialize":
      return { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "mca", version: "1.0.0" } };
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const p = params as { name: string; arguments?: Record<string, unknown> };
      const args = p.arguments ?? {};
      try {
        let text: string;
        switch (p.name) {
          case "mca_start": text = await mcaStart(args.duration_seconds as number); break;
          case "mca_stop": text = await mcaStop(); break;
          case "mca_status": text = await mcaStatus(); break;
          default: return { isError: true, content: [{ type: "text", text: `Unknown: ${p.name}` }] };
        }
        return { content: [{ type: "text", text }] };
      } catch (e: unknown) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
    }
    case "notifications/initialized": return null;
    default: return {};
  }
}

async function main() {
  const rl = createInterface({ input: process.stdin });
  process.stderr.write("[mca] started\n");
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const req = JSON.parse(line);
      const result = await handle(req);
      if (result !== null) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }) + "\n");
    } catch { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 0, error: { code: -32700, message: "Parse error" } }) + "\n"); }
  }
}
main();
