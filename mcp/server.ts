#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";

const TOOLS = [
  {
    name: "sleep_disable",
    description: "Disable system sleep — Mac stays awake even with lid closed. REQUIRES duration_seconds. Auto-restores via background timer.",
    inputSchema: { type: "object", properties: { duration_seconds: { type: "number", description: "Seconds. 1800=30min, 3600=1h, 7200=2h." } }, required: ["duration_seconds"] },
  },
  {
    name: "sleep_enable",
    description: "Immediately re-enable normal sleep. Kills any pending auto-restore timers.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "sleep_status",
    description: "Check current disablesleep state and any running background restore timers.",
    inputSchema: { type: "object", properties: {} },
  },
];

function exec(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let o = "", e = "";
    c.stdout.on("data", (d: Buffer) => (o += d.toString()));
    c.stderr.on("data", (d: Buffer) => (e += d.toString()));
    c.on("close", (code) => resolve({ stdout: o.trim(), stderr: e.trim(), code: code ?? 0 }));
  });
}

async function sleepDisable(secs: number): Promise<string> {
  const r = await exec("sudo", ["/usr/bin/pmset", "-a", "disablesleep", "1"]);
  if (r.code !== 0) return `Error: ${r.stderr}`;
  spawn("sh", ["-c", `sleep ${secs} && sudo /usr/bin/pmset -a disablesleep 0`], { detached: true, stdio: "ignore" }).unref();
  return secs >= 60
    ? `✅ Sleep disabled for ${Math.round(secs/60)} min. Auto-restore in ${secs}s.`
    : `✅ Sleep disabled for ${secs}s.`;
}

async function sleepEnable(): Promise<string> {
  await exec("pkill", ["-f", "sudo /usr/bin/pmset -a disablesleep 0"]);
  const r = await exec("sudo", ["/usr/bin/pmset", "-a", "disablesleep", "0"]);
  return r.code === 0 ? "✅ Sleep re-enabled." : `Error: ${r.stderr}`;
}

async function sleepStatus(): Promise<string> {
  const pm = await exec("pmset", ["-g", "custom"]);
  const dl = pm.stdout.split("\n").find((l) => l.includes("disablesleep"));
  const ps = await exec("bash", ["-c", "ps aux | grep -E 'sudo.*pmset.*disablesleep' | grep -v grep || true"]);
  const parts: string[] = [];
  if (dl) parts.push(`disablesleep: ${dl.trim().split(/\s+/).pop() === "1" ? "ON (stay awake)" : "OFF (normal)"}`);
  parts.push(ps.stdout ? `Timers:\n${ps.stdout}` : "No timers.");
  return parts.join("\n");
}

async function handle(req: { id: number|string; method: string; params?: Record<string,unknown> }): Promise<object|null> {
  const { id, method, params } = req;
  switch (method) {
    case "initialize":
      return { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "sleep-control", version: "1.0.0" } };
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const p = params as { name: string; arguments?: Record<string,unknown> };
      const args = p.arguments ?? {};
      try {
        let text: string;
        switch (p.name) {
          case "sleep_disable": text = await sleepDisable(args.duration_seconds as number); break;
          case "sleep_enable": text = await sleepEnable(); break;
          case "sleep_status": text = await sleepStatus(); break;
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
  process.stderr.write("[sleep-control] started\n");
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
