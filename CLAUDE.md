# Sleep Control

One-click Mac sleep prevention — Electron app + MCP server + Claude Code skill.

## Architecture

```
sleep-control/
├── main.js          # Electron main process
├── memory.js        # per-app footprint + SIGSTOP/SIGCONT freeze
├── footprint_probe.c# libproc probe, compiled at first run into userData
├── preload.js       # Secure bridge (contextBridge)
├── index.html       # Web control panel
├── mcp/server.ts    # MCP stdio server (Bun)
├── skill/SKILL.md   # Claude Code skill — auto-configures MCP
└── .github/workflows/build.yml  # CI build macOS .dmg
```

## Memory panel (v1.8.0)

Measured, not assumed — these numbers came from running the code:

| Source | Reports | Cost on this machine |
|--------|---------|----------------------|
| `ps -o rss` | resident set only — **3× low** (762 MB vs 2164 MB for one pid) | ~100 ms |
| `top -o mem` | `phys_footprint` (correct) | **0.8 s idle → 11.5 s loaded** |
| `footprint_probe.c` | `phys_footprint` via `proc_pid_rusage` | **~350 ms flat** |

So: `ps` for path/cpu/state, the native probe for memory, merged by pid. The
probe is compiled into `userData` on first use (no binary in the repo → nothing
to sign); if no compiler exists it degrades to `top`.

Key invariants for this panel:

- **Freeze ≠ free RAM.** `SIGSTOP` zeroes CPU immediately; the pages only go
  cold and the compressor/swap reclaim them later. There is no macOS API to
  push one process out of memory. The UI says this out loud.
- **`purge` is not a memory tool.** Its own manpage: "It does not affect
  anonymous memory that has been allocated through malloc, vm_allocate, etc."
  It empties the disk buffer cache only.
- **Frozen state is read from the kernel** (`ps` state `T` / probe status `SSTOP`),
  never from our own bookkeeping.
- **Grouped by outermost `.app`** — partially freezing an app's helpers wedges it.
- **Self-protection**: own pid + every ancestor, plus `NEVER` (WindowServer,
  Dock, Finder, launchd, …) are refused. Verified: freezing `Finder` returns
  `ok=false`.
- **Always thaw on quit** (`doCleanup`) and **before Nuclear** — a stopped
  process cannot receive the graceful SIGTERM, so Nuclear would skip to
  force-kill and silently lose the app's unsaved-work prompt.
- **Crash recovery**: `frozen.json` is replayed at startup, so a previous run
  that died cannot leave someone's app frozen.
- `kill -9` still works on a stopped process (verified: state `TN` → gone),
  so a frozen app is never unkillable.

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
