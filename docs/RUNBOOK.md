# MacClosedAwake Runbook

**Infrastructure Setup Guide** — how to start/stop/deploy. Services, ports, env vars, secrets locations, external endpoints, DNS/tunnels, one-command bring-up. Target reader: you after amnesia, or the next agent.

---

## Quick Start (Dev Environment)

```bash
cd ~/Projects/mac-closed-awake
npm install
npm start
```

Done. App launches in macOS menu bar.

---

## Core Components

### Electron Desktop App

**Process:** `mac-closed-awake` (Menu Bar)  
**Ports:** N/A (no network server)  
**Dependencies:** None (only `electron` devDependency)

**Main process:** [`main.js`](file:///Users/onezion12344/Projects/mac-closed-awake/main.js)
- Menu bar icon + tray interactions
- Helper process spawning (`caffeinate -i`)
- License verification via Ed25519 signatures

**Renderer process:** [`index.html`](file:///Users/onezion12344/Projects/mac-closed-awake/index.html)
- Vanilla JS + jQuery
- Pro status modal overlay
- Activation code input field

### Helper Process

**Name:** `MacClosedAwake Helper`  
**Binary:** `dist/Mac\ Closed\ Awake\ Helper.app/Contents/MacOS/Mac\ Closed\ Awake\ Helper`  
**Port:** N/A (system service)

**Purpose:** Background daemon that keeps caffeine alive when main app quits. Spawns `caffeinate -i` subprocess to prevent sleep.

**Installation:** Run `npm run helper-install` to register as system service.

---

## Environment Variables

### Runtime Secrets

| Variable | Location | Required | Format |
|----------|----------|----------|--------|
| `ED25519_PRIVATE_KEY` | [`~/.env`](file:///Users/onezion12344/Projects/mac-closed-awake/.env) | ✅ For code generation only | Multi-line PEM format |
| `STRIPE_LIFETIME_URL` | Hardcoded in [`main.js`](file:///Users/onezion12344/Projects/mac-closed-awake/main.js#L9) | ⚠️ Must swap before launch | Stripe payment link URL |
| `STRIPE_MONTHLY_URL` | Hardcoded in [`landing/index.html`](file:///Users/onezion12344/Projects/mac-closed-awake/landing/index.html#L1117) | ⚠️ Must swap before launch | Stripe payment link URL |
| `STRIPE_UPDATES_URL` | Hardcoded in [`landing/index.html`](file:///Users/onezion12344/Projects/mac-closed-awake/landing/index.html#L1139) | ⚠️ Must swap before launch | Stripe payment link URL |

⚠️ **SECURITY WARNING:** Never commit `ED25519_PRIVATE_KEY` or production Stripe URLs to git. Add to `.gitignore`. Use environment variables or keychain for secure storage.

### macOS Keychain Integration

Store private keys in macOS Keychain rather than plaintext `.env`:

```bash
security find-generic-password -s 'ed25519-private-key' -D 'mac-closed-awake' -w
```

Read from keychain in scripts using CLI tools or one-ion-macOS-keychain skill.

---

## Configuration Files

### App Preferences (Auto-Created)

**Path:** `~/Library/Application Support/mac-closed-awake/config.json`

**Format:**
```json
{
  "helperInstalled": true,
  "isPro": false,
  "licenseKey": null,
  "proEmail": ""
}
```

**Lifecycle:**
- First launch: Auto-create if missing
- On activation: Update `isPro=true`, store `licenseKey` and `proEmail`
- On logout: Keep config (state persists across sessions)

### Helper Install Status (System-Level)

**Path:** `/Library/LaunchDaemons/com.macclosed.awake.helper.plist` (if installed)

**Purpose:** Launchd plist that auto-starts helper process on system boot.

**Management commands:**
```bash
# Check status
launchctl list | grep mac-closed

# Load helper
sudo launchctl load /Library/LaunchDaemons/com.macclosed.awake.helper.plist

# Unload helper
sudo launchctl unload /Library/LaunchDaemons/com.macclosed.awake.helper.plist
```

---

## External Endpoints

### Stripe Payment Links

**Primary:** [buy.stripe.com](https://buy.stripe.com)

**Current (test mode):**
- Lifetime ($9): `https://buy.stripe.com/test_eVqaER2GQdWaars23a4ko0s`
- Monthly ($1.29/mo): `https://buy.stripe.com/test_dRmfZbgxG4lAdDEePW4ko1K`
- Updates ($18): `https://buy.stripe.com/test_14A28l95e9FUbvw7nu4ko16`

**Status:** ⏸ Must swap to production URLs before launch (see ADR-004)

**Redirect behavior:** All Buy buttons open Stripe Checkout in new browser tab. User completes payment → receives license email → copy activation code → paste into app.

---

## One-Command Bring-Up

### Development Mode

```bash
#!/bin/bash
# Start dev environment instantly
set -e
cd ~/Projects/mac-closed-awake
echo "📦 Installing dependencies..."
npm install --quiet
echo "🚀 Launching MacClosedAwake..."
npm start
```

Run: `bash scripts/dev-start.sh`

### Production Build

```bash
#!/bin/bash
# Create distributable .dmg installer
set -e
cd ~/Projects/mac-closed-awake
echo "🔨 Building Electron app..."
npm run dist
echo "✅ Done! Installer at dist/mac-closed-awake-*.dmg"
ls -lh dist/*.dmg
```

Run: `bash scripts/build-release.sh`

---

## Service Lifecycle

### Starting the App

**Method 1:** Terminal
```bash
npm start
```

**Method 2:** Finder
- Navigate to `dist/Mac\ Closed\ Awake.app`
- Double-click to launch

**Method 3:** Launchd (auto-start on login)
```bash
cp Scripts/com.macclosed.awake.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.macclosed.awake.plist
```

### Stopping the App

**Graceful shutdown:**
- Quit app from menu bar (Cmd+Q or right-click → Quit)
- Background processes terminate automatically

**Force kill (if stuck):**
```bash
killall "Mac Closed Awesve" "Mac Closed Awake Helper"
```

### Restarting

```bash
# Kill all processes
killall "Mac Closed Awake" "Mac Closed Awake Helper"

# Wait 2 seconds
sleep 2

# Restart fresh
npm start
```

---

## Monitoring & Debugging

### Logs Location

**App logs:** `~/Library/Logs/mac-closed-awake/` (auto-created on first error)

**Helper logs:** `/var/log/system.log` (filter for "mac-closed")

**Console.app:** 
```bash
open console.app && tail -f /var/log/system.log | grep mac-closed
```

### Testing Activation Flow

```bash
# Generate test activation code
node scripts/generate-activation.js --email test@macclosed.awake --tier lifetime

# Verify signature independently
node -e "require('./license').verifyActivationCode('YOUR_CODE_HERE')"
```

**Expected output:** `{ valid: true, email: "...", tier: "lifetime" }`

### Health Checks

**Menu bar icon present?** ✅ Yes = App running correctly  
**Caffeinate subprocess active?**
```bash
ps aux | grep caffeinate
# Should show "caffeinate -i" process
```

**Pro status activated?**
Check `~/Library/Application\ Support/mac-closed-awake/config.json` for `"isPro": true`

---

## Deployment Checklist

### Pre-Launch Requirements

- [ ] Swap test Stripe links to production URLs ([`main.js`](file:///Users/onezion12344/Projects/mac-closed-awake/main.js#L9), [`landing/index.html`](file:///Users/onezion12344/Projects/mac-closed-awake/landing/index.html))
- [ ] Test payment flow end-to-end (buy → receive code → activate in app)
- [ ] Confirm ED25519 private key stored securely (keychain or encrypted vault)
- [ ] Build and test `.dmg` installer on clean macOS VM
- [ ] Prepare support documentation (FAQ, troubleshooting guide)

### Post-Launch

- [ ] Monitor user activation failures (check config.json samples)
- [ ] Track failed license verifications (log in debug mode)
- [ ] Respond to Stripe webhook events (refund handling, dispute resolution)
- [ ] Maintain PPP pricing database (update exchange rates monthly)

---

## Maintenance Schedule

### Weekly
- Check Stripe dashboard for failed payments
- Monitor user reports of activation issues

### Monthly
- Update PPP exchange rates in [`create_stripe_prices.py`](file:///Users/onezion12344/Projects/mac-closed-awake/create_stripe_prices.py)
- Re-run price generation script, update [`stripe-pricing-results.json`](file:///Users/onezion12344/Projects/mac-closed-awake/stripe-pricing-results.json)

### Quarterly
- Audit security: verify Ed25519 private key never leaked to git history
- Review user feedback, prioritize bug fixes vs feature work
- Update dependencies (if any added later)

---

*Last updated: 2026-07-29. Written during Phase 6 delivery.*
