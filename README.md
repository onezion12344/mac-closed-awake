# MacClosedAwake

Your Mac stays awake. Lid closed or not. No sleep, ever.

## Why?

You're vibe coding with Claude Code, Cursor, or Copilot. A 2-hour build is running. You close your lid to go grab coffee. **Everything dies.**

Not anymore.

## Features

- ⚡ **Lid-close safe** — stays awake even when MacBook lid is closed
- ⏱️ **Timed** — 30min / 1h / 2h / 4h / 8h / 12h presets
- ♾️ **Forever mode** — stays on until you manually stop
- 🔄 **Auto-restore** — sleep re-enabled automatically when timer ends
- 🪄 **Menu bar app** — lives in tray, stays out of your way
- 🔐 **No password prompts** — install helper once, done forever

## Perfect for

- **Vibe coding sessions** — Claude Code, Cursor, Copilot running overnight
- **Long builds** — Xcode, Gradle, CMake compiling while you sleep
- **Deployments** — Vercel, Railway, Cloudflare deploys mid-lid-close
- **Training runs** — Local LLM fine-tuning, model training
- **Downloads** — Large files transferring, can't afford sleep interruption

## How it works

```
pmset -a disablesleep 1   # prevent sleep (via privileged helper)
pmset -a disablesleep 0   # restore normal
```

A small privileged helper runs as root via launchd, listening on a Unix socket. The app communicates over the socket — no password prompts after first install.

## Install

### Homebrew (recommended)

```bash
brew tap onezion12344/mac-closed-awake
brew install --cask mac-closed-awake
```

### DMG

Download the latest `.dmg` from [Releases](https://github.com/onezion12344/mac-closed-awake/releases).

### Build from source

```bash
git clone https://github.com/onezion12344/mac-closed-awake.git
cd mac-closed-awake
npm install
npm start
```

## Build

```bash
npm run build   # macOS .dmg + .app
```

## System Requirements

- macOS 14+
- Apple Silicon or Intel
- Admin password (required once to install helper)

## License

MIT
