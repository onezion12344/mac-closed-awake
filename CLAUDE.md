# Sleep Control

One-click Mac sleep prevention — Electron app + MCP server + Claude Code skill.

## Architecture

```
sleep-control/
├── main.js          # Electron main process
├── preload.js       # Secure bridge (contextBridge)
├── index.html       # Web control panel
├── mcp/server.ts    # MCP stdio server (Bun)
├── skill/SKILL.md   # Claude Code skill — auto-configures MCP
└── .github/workflows/build.yml  # CI build macOS .dmg
```

Three interfaces, one backend:

| Interface | Entry | For |
|-----------|-------|-----|
| **Electron app** | Click GUI buttons | End users — menu bar, timed presets |
| **MCP server** | `bun run mcp/server.ts` | AI agents — `sleep_disable/…` tools |
| **Skill** | `/sleep-control` | Claude Code — natural language → MCP calls |

All three call `sudo pmset -a disablesleep 1/0` via `osascript` admin prompt.

## MCP Registration

```bash
claude mcp add sleep-control --transport stdio -- /opt/homebrew/bin/bun run ~/Projects/sleep-control-app/mcp/server.ts
```

## Dev

```bash
npm install
npm start        # Launch Electron app
```

## Build

```bash
npm run build    # → dist/Sleep Control-1.0.0.dmg
```

GitHub Actions auto-builds on `v*` tags.
