# MacClosedAwake

<p align="center">
  <img src="icon.svg" width="128" height="128" alt="MacClosedAwake icon">
</p>

<h3 align="center">Close the lid. Stay awake.</h3>

<p align="center">The yellow sheep keeps your Mac running — lid closed, no external display, no sleep.</p>

<p align="center">
  <img src="landing/demo.gif" alt="MacClosedAwake Demo" width="400">
</p>

## Why?

You're vibe coding with Claude Code, Cursor, or Copilot. A 2-hour build is running. You close your lid to go grab coffee. **Everything dies.**

Not anymore.

## Features

- ⚡ **Lid-close safe** — stays awake even when MacBook lid is closed
- 🧊 **Low Power Mode + awake, together** — long headless runs stay cool (LPM no longer conflicts with keep-awake)
- ⏱️ **Timed** — 30min / 1h / 2h / 4h / 8h / 12h presets
- ♾️ **Forever mode** — stays on until you manually stop
- 🔋 **Battery protection (≤2%)** — auto-restores sleep before the battery dies, so shutdown is clean (no errors)
- 😴 **Force sleep at ≤2%** — sleeps instantly at critical battery; next boot needs no "charge to 1%" dance — plug in (even 5V1A) and power on
- 🪟 **Resizable window** — drag it to any size; contents scroll instead of getting clipped
- ☢️ **NUCLEAR (Shut Down / Restart)** — macOS doesn't auto-kill hung apps on reboot like Windows does. Nuclear gracefully quits every app, force-quits stragglers, then shuts down or reboots. 🎉 **Easter egg hidden next to it** — enable the "Countdown show" toggle and confirm: fullscreen 5→0 alarm + ticks before the machine goes dark.
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
