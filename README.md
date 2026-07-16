# Sleep Control

One-click Mac sleep prevention. Keeps your Mac awake — even with lid closed.

Built with Electron. Uses `pmset disablesleep` at the kernel level (no caffeinate workarounds).

## Features

- ☕ **Lid-close safe** — runs even when MacBook lid is closed
- ⏱️ **Timed** — 30min / 1h / 2h / 4h / 8h presets
- 🔄 **Auto-restore** — sleep re-enabled automatically when timer ends
- 🪄 **Menu bar app** — lives in tray, stays out of your way
- 🔐 **Privileged** — uses macOS native admin prompt (password never leaves your machine)

## How it works

```
sudo pmset -a disablesleep 1   # prevent sleep
sudo pmset -a disablesleep 0   # restore normal
```

This is the only way to truly prevent lid-close sleep on Apple Silicon Macs.
`caffeinate` alone cannot do this.

## Install

Download the latest `.dmg` from [Releases](https://github.com/onezion12344/sleep-control/releases).

Or build from source:

```bash
git clone https://github.com/onezion12344/sleep-control.git
cd sleep-control
npm install
npm start
```

## Build

```bash
npm run build   # macOS .dmg + .app
```

GitHub Actions auto-builds on every version tag (`v1.0.0`).

## System Requirements

- macOS 14+
- Apple Silicon or Intel
- Admin password (required once per timer activation)
