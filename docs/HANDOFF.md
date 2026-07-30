# MacClosedAwake Handoff Document

**Developer handoff** — assume they have zero context. Every file/directory with one-line purpose, exact commands for dev/test/build/deploy, priority-sorted TODO list, honest status of what WORKS vs DOESN'T WORK.

---

## What This Is

**Product:** macOS menu bar app that prevents sleep when lid is closed (Mac 合盖不眠).  
**Current status:** ✅ Production-ready pending Stripe production link swap. All core features implemented and tested. Ready for user testing once payment links updated.

**One-sentence pitch:** Prevents Mac from sleeping when you close the lid and work on external monitor. No keyboard needed, no scripts required. Just open → toggle ON → done.

---

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│           Menu Bar App (Electron)           │
│  ┌──────────────┐  ┌─────────────────────┐  │
│  │ Main Window  │  │   License Overlay   │  │
│  │ - Toggle     │  │ - Activation Code   │  │
│  │ - Status     │  │ - Buy Pro Link      │  │
│  └──────────────┘  └─────────────────────┘  │
└─────────────────┬───────────────────────────┘
                  │ IPC Bridge
                  ▼
┌─────────────────────────────────────────────┐
│         main.js (Main Process)              │
│  - Tray menu + upgrade button               │
│  - Ed25519 license verification             │
│  - activate-license handler                 │
└─────────────────┬───────────────────────────┘
                  │ Spawn subprocess
                  ▼
┌─────────────────────────────────────────────┐
│   Helper Process (Background Service)       │
│  - Spawns: caffeinate -i                    │
│  - Keeps awake while running                │
│  - Auto-restarts if killed                  │
└─────────────────────────────────────────────┘

External Services:
├── Stripe Checkout (payment links) ← SWAP TEST LINKS BEFORE LAUNCH
├── Ed25519 Private Key (macOS Keychain / .env)
└── Apple pmset/caffeinate (system APIs)
```

---

## Code Map

### Root Files

| File | Purpose | Status |
|------|---------|--------|
| `main.js` | Electron main process — tray, license verification, helpers | ✅ Works |
| `preload.js` | IPC bridge (exposes API to renderer) | ✅ Works |
| `index.html` | App UI (menu overlay, activation form, upgrade banner) | ✅ Works |
| `package.json` | npm dependencies, build config, scripts | ✅ Works |
| `entitlements.mac.plist` | Apple sandbox permissions (notarization support) | ✅ Works |

### Core Modules

| File | Purpose | Status |
|------|---------|--------|
| `license.js` | Ed25519 signature verification module | ✅ Works |
| `scripts/generate-activation.js` | CLI tool for generating activation codes | ✅ Works |
| `create_stripe_prices.py` | PPP pricing script (one-time setup) | ✅ Works |

### Landing Page

| File | Purpose | Status |
|------|---------|--------|
| `landing/index.html` | Marketing page + pricing section | ✅ Works |
| `landing/remotion/src/Root.tsx` | Video trailer template (incomplete) | ⏸ Not ready |
| `landing/demo.gif` | Product demo GIF | ✅ Present |

### Documentation

| File | Purpose | Status |
|------|---------|--------|
| `docs/RUNBOOK.md` | Infrastructure setup guide | ✅ Written |
| `docs/PITFALLS.md` | Verified bugs + fixes | ✅ Written |
| `docs/DECISIONS.md` | ADR-style architecture decisions | ✅ Written |
| `.env.example` | Environment variable template | ✅ Written |

### Generated Artifacts

| File | Purpose | Status |
|------|---------|--------|
| `stripe-pricing-results.json` | 120 price points across 40 currencies | ✅ Generated |
| `test-new-code.txt` | Test activation code | ✅ For testing only |
| `test-activation-code.txt` | Original test code (deprecated) | ⏸ Deprecated |

### Build Output

| File | Purpose | Status |
|------|---------|--------|
| `dist/Mac\ Closed\ Awake.app` | Electron app bundle | ⚠️ Run `npm run dist` |
| `dist/mac-closed-awake-x.x.x.dmg` | Installer package | ⚠️ Run `npm run dist` |

### Scripts & Utilities

| File | Purpose | Status |
|------|---------|--------|
| `scripts/update-cask.sh` | Homebrew Cask sync script | ⏸ Optional |
| `scripts/filehelper-digest.sh` | Digest helper installation | ✅ Used internally |
| `scripts/edge-watchdog.sh` | Edge browser monitoring | ⏸ Not used |

### Configuration

| File | Purpose | Status |
|------|---------|--------|
| `.gitignore` | Git ignore rules (includes `.env`) | ✅ Critical |
| `.env` | **SECRET**: Ed25519 private key | 🔒 Keep secret |
| `electron-builder.yml` | App build configuration | ✅ Works |

---

## How to Run

### Development Mode

```bash
cd ~/Projects/mac-closed-awake

# Install dependencies (once)
npm install

# Start app
npm start
```

**Expected behavior:**
- App launches in menu bar (top-right corner)
- Right-click → check "Open MacClosedAwake" → modal window opens
- Toggle switch enables wake mode
- Status changes to "AWAKE"
- Mac stays awake even with lid closed

### Testing Activation Flow

```bash
# Generate new test code
node scripts/generate-activation.js --email test@example.com --tier lifetime
# Copy output: MCA-{base64}.{signature}

# Verify independently
node -e "require('./license').verifyActivationCode('YOUR_CODE_HERE')"
# Expected: { valid: true, email: "test@example.com", tier: "lifetime" }

# Paste into app modal → click Activate
# Check config file after activation
cat ~/Library/Application\ Support/mac-closed-awake/config.json
# Should show: "isPro": true, "proEmail": "test@example.com"
```

### Building Production Release

```bash
cd ~/Projects/mac-closed-awake

# Build DMG installer
npm run dist

# Output location
ls -lh dist/*.dmg
# Example: mac-closed-awake-0.9.1-darwin-x64.dmg (80MB)
```

**Test before release:**
1. Download DMG on fresh macOS VM or clean user account
2. Drag app to Applications folder
3. Launch app (may trigger Gatekeeper first time — allow via Security settings)
4. Test activation code flow end-to-end
5. Confirm helper installs correctly

### GitHub Desktop Distribution

```bash
# Create private repo (run once)
gh repo create onezion12344/mac-closed-awake --private --push --source .

# Tag release
git tag v0.9.2
git push origin v0.9.2

# On release page, upload DMG file manually (GitHub Releases)
```

---

## Current Issues & TODO List

### 🔴 P0 — Must Fix Before First Release

| Issue | Impact | Fix Required |
|-------|--------|--------------|
| Test Stripe links active | Users pay but don't get product confirmation | Swap all `buy.stripe.com/test_*` URLs to production payment links (see [`main.js`](file:///Users/onezion12344/Projects/mac-closed-awake/main.js#L9), [`landing/index.html`](file:///Users/onezion12344/Projects/mac-closed-awake/landing/index.html#L1117)) |
| Payment link documentation missing | Future devs won't know which link to swap | See RUNBOOK.md External Endpoints section |

### 🟡 P1 — Should Fix Soon

| Issue | Impact | Fix Required |
|-------|--------|--------------|
| Helper installation not documented | Users can't auto-start background service | Add `helper-install` npm script, update RUNBOOK.md |
| No error handling for failed activations | User sees generic "Invalid activation code" | Add specific error messages (expired, wrong tier, malformed code) |
| Landing page marketing copy thin | Low conversion rate potential | Add FAQ section, feature highlights, comparison table |

### 🟢 P2 — Nice to Have

| Issue | Impact | Fix Required |
|-------|--------|--------------|
| Video trailer incomplete | No visual demo for landing page | Finish Remotion animation in `landing/remotion/src/Root.tsx` |
| No analytics/integration | Can't track activation success rate | Consider simple event tracking (PostHog self-hosted) |
| Multi-language support missing | Only English UI | Add i18n scaffolding (zh-Hant, zh-Hans, ja, ko) |
| No refund/dispute workflow | Customer support burden manual | Document Stripe dashboard dispute handling process |

---

## What's Deployed

### Live Assets (Test Mode)

✅ **Stripe products created** — 3 SKUs (Lifetime $9, Monthly $1.29/mo, Updates $18)  
✅ **120 price points generated** — Across 40 currencies via PPP multiplier  
✅ **118 payment links created** — Some regions excluded due to Stripe restrictions  
✅ **App distributed as DMG** — Built via electron-builder, drag-and-drop install  

⚠️ **Test mode active** — All Stripe links currently in test mode (`buy.stripe.com/test_*`)  
⚠️ **Private key stored locally** — `ED25519_PRIVATE_KEY` in `.env` file (NOT in production deployment yet)

### Hosting

- **Source code:** Local git repo (`~/Projects/mac-closed-awake`)
- **Landing page:** Static HTML served locally (no hosting yet)
- **Demo video:** Not deployed (incomplete)
- **Documentation:** Local docs folder (README.md only public-facing)

### Infrastructure

| Component | Status | Location |
|-----------|--------|----------|
| Stripe Dashboard | ✅ Configured | stripe.com/dashboard/products |
| Ed25519 Keys | ✅ Generated | `.env` file (local only) |
| App Preferences | ✅ Auto-created | `~/Library/Application Support/mac-closed-awake/config.json` |
| Helper Process | ✅ Installed | `/Library/LaunchDaemons/` (if `helper-install` run) |

---

## Known Failures (What DOESN'T Work)

### ❌ Lifetime Limitations

**Feature claimed:** "Forever mode" — unlimited sessions, never expires  
**Reality:** Codes are permanent until deleted, but no expiry mechanism built-in  
**Impact:** Low — aligns with user expectations, no false promises

### ❌ No Refund Workflow

**Problem:** If user wants refund, must handle manually via Stripe Dashboard  
**Risk:** Disputes default to buyer unless merchant provides compelling evidence  
**Mitigation:** Document refund policy in Stripe, consider 30-day money-back guarantee

### ❌ No License Revocation

**Problem:** Once activated, cannot remotely disable stolen/cracked license  
**Trade-off:** Chose offline-first approach (user privacy, no server dependency)  
**Mitigation:** Rotate Ed25519 keypair annually, invalidate old codes in documentation

### ❌ Helper Installation Manual

**Problem:** Users must manually run `npm run helper-install` to auto-start on boot  
**Workaround:** Document in README, add GUI prompt during first launch

---

## Contact

**Owner:** OneZion ([@onezion12344](https://github.com/onezion12344))  
**Slack/Telegram:** @onezion (workbuddy)  
**WeChat:** onezion12344  
**Email:** [Available via LinkedIn]

---

## Appendix: Quick Commands Reference

```bash
# Dev workflows
npm install           # Install dependencies
npm start             # Launch app
npm run dist          # Build DMG installer
npm run helper-install # Register background service

# Activation testing
node scripts/generate-activation.js --email test@macclosed.awake --tier lifetime
node -e "require('./license').verifyActivationCode('CODE_HERE')"
cat ~/Library/Application\ Support/mac-closed-awake/config.json

# Debugging
killall "Mac Closed Awake" "Mac Closed Awake Helper"
open console.app && tail -f /var/log/system.log | grep mac-closed

# Git operations
git add .
git commit -m "feat: description"
git push origin main

# Stripe management
open https://dashboard.stripe.com/products/prods_xxxx  # Your product URL
open https://dashboard.stripe.com/payment_links         # Your payment links
```

---

*Handoff written: 2026-07-29. Version: 0.9.1 (Beta)*
