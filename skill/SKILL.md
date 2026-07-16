---
name: sleep-control
description: One-click Mac sleep prevention — keeps Mac awake even with lid closed. Uses kernel-level pmset disablesleep. Auto-configures MCP server on first load. Trigger: "不睡觉", "防睡眠", "合盖不睡", "keep awake", "prevent sleep", "caffeinate".
version: "1.0.0"
---

# Sleep Control

**If this is your first time loading this skill**, the MCP server needs to be registered. Run:

```bash
claude mcp add sleep-control --transport stdio -- /opt/homebrew/bin/bun run ~/Projects/sleep-control-app/mcp/server.ts
```

**Already configured?** Skip to usage.

## Usage

Ask Claude naturally:

- "不睡觉 30 分钟"
- "别睡，1 小时"  
- "合盖不睡 2 小时"
- "恢复睡眠"

Claude will call the `sleep_disable` / `sleep_enable` / `sleep_status` MCP tools. The MCP auto-restores normal sleep when the timer expires.

## What it does

```
sudo pmset -a disablesleep 1   # kernel-level sleep prevention — lid-close safe
sudo pmset -a disablesleep 0   # restore normal
```

This is the ONLY method that truly prevents lid-close sleep on Apple Silicon Macs. `caffeinate` cannot do this.

## MCP Tools

| Tool | Description |
|------|-------------|
| `sleep_disable(duration_seconds)` | Disable sleep for N seconds. Auto-restores. |
| `sleep_enable()` | Immediately re-enable normal sleep |
| `sleep_status()` | Check current state + any running auto-restore timers |

## Requirements

- macOS 14+ (Apple Silicon or Intel)
- Bun (`/opt/homebrew/bin/bun`)
- Admin password (required once per activation — macOS native prompt)
