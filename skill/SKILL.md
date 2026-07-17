---
name: lidajar
description: Keep Mac awake — even with lid closed. No sleep, ever. Uses privileged helper for password-free operation. Trigger: "不睡觉", "防睡眠", "合盖不睡", "keep awake", "prevent sleep", "never sleep", "lidajar".
version: "1.0.0"
---

# LidAjar

**If this is your first time loading this skill**, the MCP server needs to be registered. Run:

```bash
claude mcp add lidajar --transport stdio -- /opt/homebrew/bin/bun run ~/Projects/sleep-control-app/mcp/server.ts
```

**Already configured?** Skip to usage.

## Usage

Ask Claude naturally:

- "不睡觉 30 分钟"
- "别睡，1 小时"
- "合盖不睡 2 小时"
- "恢复睡眠"
- "永远不睡"

Claude will call the `lidajar_start` / `lidajar_stop` / `lidajar_status` MCP tools.

## What it does

```
pmset -a disablesleep 1   # kernel-level sleep prevention — lid-close safe
pmset -a disablesleep 0   # restore normal
```

Runs via a privileged helper (Unix socket) — no password prompts after first install.

## MCP Tools

| Tool | Description |
|------|-------------|
| `lidajar_start(duration_seconds)` | Disable sleep. 0 = forever. Auto-restores. |
| `lidajar_stop()` | Immediately re-enable normal sleep |
| `lidajar_status()` | Check current state |

## Requirements

- macOS 14+ (Apple Silicon or Intel)
- Bun (`/opt/homebrew/bin/bun`)
- Admin password (required once to install helper)
