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

## Versioning & Releases

**Every user-visible fix/feature bumps the version.** Users see "an update" whenever an issue is fixed, so there must be a new release each time.

- Patch version (`x.y.<z>`): a bug fix → e.g. `1.2.0` → `1.2.1`
- Minor (`x.<y>.0`): new feature/behavior → e.g. `1.1.0` → `1.2.0`
- Files to bump together: `package.json` `"version"` (Electron reads this via `app.getVersion()` — the footer version display is dynamic now)
- Release flow:
  ```bash
  npm version <major|minor|patch>   # bumps package.json + tags vX.Y.Z + commits
  git push origin master --tags     # CI builds & uploads release assets
  ```
  Or manually: edit `package.json` version → commit → `git tag vX.Y.Z` → `git push origin master --tags`
- CI (`.github/workflows/build.yml`) auto-builds the .dmg/.zip and creates a GitHub Release on every `v*` tag. After pushing the tag, verify `gh run list` succeeded and the release exists.
- The locally installed app at `/Applications` is separate — after a version bump, rebuild + reinstall locally to stay in sync (`npm run dist` → mount DMG → `ditto` to `/Applications`).

**Release checklist when finishing a fix:**
1. Bump version (patch for fixes)
2. Commit the fix + version bump
3. Tag `vX.Y.Z` and push tag (triggers CI release)
4. Rebuild + reinstall locally so the running copy matches
