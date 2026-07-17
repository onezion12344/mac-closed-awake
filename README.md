# LidAjar

Your Mac stays awake. Lid closed or not. No sleep, ever.

## Features

- ⚡ **Lid-close safe** — stays awake even when MacBook lid is closed
- ⏱️ **Timed** — 30min / 1h / 2h / 4h / 8h / 12h presets
- ♾️ **Forever mode** — stays on until you manually stop
- 🔄 **Auto-restore** — sleep re-enabled automatically when timer ends
- 🪄 **Menu bar app** — lives in tray, stays out of your way
- 🔐 **No password prompts** — install helper once, done forever
- 💳 **Pro tier** — unlock unlimited sessions with one-time purchase

## How it works

```
pmset -a disablesleep 1   # prevent sleep (via privileged helper)
pmset -a disablesleep 0   # restore normal
```

A small privileged helper runs as root via launchd, listening on a Unix socket. The app communicates over the socket — no password prompts after first install.

## Install

Download the latest `.dmg` from [Releases](https://github.com/onezion12344/lidajar/releases).

Or build from source:

```bash
git clone https://github.com/onezion12344/lidajar.git
cd lidajar
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
