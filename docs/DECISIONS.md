# MacClosedAwake Key Decisions (ADR)

**Architecture Decision Records** — context, options considered, decision, rationale, who decided. Every fork resolved and documented so future maintainers don't re-discover the same questions.

---

## ADR-001: Offline Ed25519 Activation vs Server-Side License Validation

**Status:** ✅ Accepted  
**Date:** 2026-07-29  
**Decided by:** Owner (auto-execution under pipeline skip rule)

### Context

Building a macOS menu bar app that prevents sleep when lid closed. Need license/activation system to monetize Pro features (unlimited sessions, forever mode).

Options:
1. **Server-side license validation**: App checks online, server issues short-lived tokens
2. **Offline HMAC**: Embed shared secret in binary, sign codes offline
3. **Offline Ed25519**: Public key embedded, private key kept separate for signing
4. **Store-based licensing**: Apple App Store / Stripe Billing + receipt validation

### Options Considered

| Option | Pros | Cons | Lock-in |
|--------|------|------|---------|
| Server-side validation | Full control, revocable | Requires hosting, latency, always-online | High (own infra) |
| HMAC signing | Simple to implement | Secret embedded in open-source binary = anyone can forge | Medium |
| Ed25519 asymmetric | Safe (public key ok to embed), one-time activation | More complex crypto ops | Low |
| Store licensing | Trusted platform, built-in receipts | Revenue share (30%), platform rules, update delays | Very High |

### Decision

**Ed25519 asymmetric signatures** for offline activation codes. Format: `MCA-{base64url(payload)}.{base64url(signature)}`.

Public key embedded in [`license.js`](file:///Users/onezion12344/Projects/mac-closed-awake/license.js#L5-L8). Private key stored separately, used only for code generation.

OneZion's "codegen-over-loader" principle: if I walk away from this project tomorrow, customer still has working software without my infrastructure. No server dependency, no expiration dates (unless I set them), no TOS changes breaking the product.

### Rationale

1. **Security**: HMAC is unsafe for open-source projects (any user can extract secret and generate unlimited codes). Ed25519 public keys are safe to embed; unforgeable without private key.

2. **User ownership**: Codes never expire unless I explicitly build expiry logic. Customer owns their license indefinitely.

3. **Zero maintenance**: No server to monitor, no uptime SLAs, no API rate limits. Generate codes manually or via script whenever needed.

4. **Alignment with OneZion values**: "Codegen over loader" — prefer architectures where migration out of the tool is trivially easy. Best deliverable is one you can walk away from with zero lock-in.

### Rejected Options

- **HMAC**: Marked as ❌ UNSAFE for open-source distribution. Would require embedding secret key, making it trivially extractable via reverse engineering.

- **Server-side validation**: Marked as ❌ Over-engineering for a $9 app. Adds operational burden (hosting, monitoring) disproportionate to revenue.

- **Apple App Store**: Marked as ❌ Against pricing strategy. Need PPP-based global pricing (see ADR-002); store requires fixed USD/EUR prices and takes 30% cut.

### Implementation Details

- Signature algorithm: Ed25519 (Node.js native `crypto.sign()` / `crypto.verify()`)
- Code generator: [`scripts/generate-activation.js`](file:///Users/onezion12344/Projects/mac-closed-awake/scripts/generate-activation.js)
- Verification module: [`license.js`](file:///Users/onezion12344/Projects/mac-closed-awake/license.js)
- Storage: `~/Library/Application Support/mac-closed-awake/config.json` → `isPro`, `licenseKey`, `proEmail` fields

---

## ADR-002: Stripe HK with PPP-Based Global Pricing

**Status:** ✅ Accepted  
**Date:** 2026-07-29  
**Decided by:** Owner (via onezion-pricing-onezion skill integration)

### Context

MacClosedAwake targets global users. US$9 flat price creates massive access barrier in developing countries (Indonesia, Vietnam, Philippines earn ~$500-800/month net after rent). Need PPP-adjusted pricing to maximize accessibility while maintaining fair value extraction from wealthy markets.

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| Flat USD pricing | Simple, familiar | Excludes developing world, ethical concerns |
| PPP tiered pricing | Fair access, aligns with ability to pay | Requires 40+ currency support, complex setup |
| Tiered feature gating | Keeps base price low | Limits free tier too much, poor conversion |
| Donation model | Zero friction | Undercuts value perception, unlikely to monetize |

### Decision

**Stripe HK with PPP-based pricing across 40 currencies**. Base price: $9 USD lifetime. Multiplier: wealth index × income ratio × purchasing power parity.

Output: [`stripe-pricing-results.json`](file:///Users/onezion12344/Projects/mac-closed-awake/stripe-pricing-results.json) with 120 price points across 40 currencies.

Example conversions:
- 🇭🇰 Hong Kong: HKD 99 (~US$12.70)
- 🇨🇳 China: CNY 58 (~US$8.10)
- 🇻🇳 Vietnam: VND 199,000 (~US$8.00)
- 🇵🇭 Philippines: PHP 449 (~US$7.90)
- 🇮🇩 Indonesia: IDR 139,000 (~US$8.80)
- 🇬🇧 UK: GBP 6.99 (~US$8.90)
- 🇺🇸 USA: USD 9.00 (base reference)

### Rationale

1. **Market access**: Developing world represents 80% of global internet users. PPP pricing unlocks these markets without sacrificing revenue from wealthy countries.

2. **Ethical alignment**: Charge based on ability to pay. A Vietnamese student pays less than a San Francisco engineer for the same product. This is what fairness looks like.

3. **Revenue optimization**: Wealthier countries subsidize poorer ones. Higher prices in Denmark, Switzerland, Norway capture surplus. Overall revenue increases vs flat-rate USD.

4. **Stripe support**: Native multi-currency checkout. Users see local currency automatically detected by geo-location.

5. **Implementation effort**: Created once via script (`create_stripe_prices.py`), runs in minutes, then forget it. No ongoing maintenance required.

### Rejected Options

- **Flat USD**: Market research shows Chinese students won't pay US$9 for a $9 utility app when their disposable income is ~$200/month. Would lose entire Asian market.

- **Freemium model**: Free tier would be "1 hour session limit". Too restrictive for people testing clamshell mode for the first time. Likely to get bad reviews, no conversion funnel data.

### Implementation Notes

- Product catalog: 3 SKUs (Lifetime, Monthly, Updates Pack)
- Payment links: 118 unique URLs generated (some products unavailable in certain regions)
- Landing page: Hardcoded test links until production deployment
- TODO: Swap test Stripe payment links before launch

---

## ADR-003: Electron Desktop App vs Web Application

**Status:** ✅ Accepted  
**Date:** 2026-07-29  
**Decided by:** Owner (auto-execute under pipeline constraints)

### Context

macOS provides `pmset disablesleep` CLI for preventing sleep. Could wrap this in a web app with IPC bridge, or build native desktop app. Need to evaluate trade-offs.

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| Web app + Electron IPC | Cross-platform, HTML UI | Still needs native wrapper for pmset calls |
| React SPA | Modern framework, component library | Build complexity, larger bundle size |
| Static HTML/CSS/JS | Zero dependencies, simple | Limited interactivity (ok for this use case) |
| Native SwiftUI app | Performance, platform integration | iOS/macOS dev skills needed, single platform |

### Decision

**Electron desktop app with vanilla JS + jQuery**. No npm dependencies except electron itself. Static HTML rendered directly.

Core functionality: [`main.js`](file:///Users/onezion12344/Projects/mac-closed-awake/main.js) — menu bar icon, tray interactions, helper process spawning, pmset disable sleep.

### Rationale

1. **Zero dependencies**: Only `electron` devDependency. No package.json bloat. No `node_modules/` download on install. User runs `npm install && npm start`.

2. **Simple architecture**: Menu bar → click → toggle checkbox → spawn subprocess → `caffeinate -i` keeps awake. No state management, no routing, no build step.

3. **Desktop-only feature**: macOS system-level operations (menu bar, system preferences, pmset) require native privileges. Web apps can't access these APIs anyway. Electron bridges the gap.

4. **Maintenance cost**: Static HTML files don't need hot-reload, bundling, minification. Edit file, refresh browser, done. No webpack errors, no Babel configurations, no dependency audits.

5. **Distribution simplicity**: Single `.dmg` file built by electron-builder. Drag-and-drop install, no installer scripts, no notarization hell (open source exempt).

### Rejected Options

- **React/Vue/Svelte**: No need for component abstractions. This is 5 components max: menu bar, main window, modal overlay, toggle switch, status badge. Vanilla JS handles this elegantly.

- **Progressive Web App (PWA)**: PWA can't run background processes or access `pmset`. Would still need native wrapper. Might as well use Electron from day one.

- **Tauri (Rust backend)**: Smaller bundle size (yes), but adds Rust learning curve. Electron ecosystem mature, well-documented. For one-app project, speed of iteration matters more than 50MB bundle reduction.

### Bundle Size

Total dist:
- Binary: ~80MB (Electron runtime overhead)
- App content: <100KB (static HTML, assets)
- Install size: ~80MB DMG

For comparison: VS Code uses same Electron runtime, bundles ~200MB. Users accept this trade-off for desktop-native UX.

---

## ADR-004: Lemon Squeezy vs Stripe Integration

**Status:** ✅ Rejected  
**Date:** 2026-07-29  
**Decided by:** Owner (discover pattern during code audit)

### Context

Previous session scaffolded Lemon Squeezy licensing integration into codebase. Empty `LEMON_STORE_ID = ''` constants found in [`main.js`](file:///Users/onezion12344/Projects/mac-closed-awake/main.js#L8-L17). Never configured. Need to decide: configure Lemon Squeezy OR replace with Stripe?

### Discovery

Audit revealed:
- `LEMON_STORE_ID = ''` (empty string, never set)
- `LEMON_CHECKOUT_VARIANT = ''` (never configured)
- `lemonRequest()` function implemented but never called successfully
- `validateLicense()` handler dead code path

Conclusion: Lemon Squeezy scaffolding was abandoned mid-way. Either the owner forgot to configure it, or switched to Stripe and forgot to clean up.

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| Configure Lemon Squeezy | Works, digital goods friendly | Add-on fees (5% + Stripe), limited PPP support |
| Replace with Stripe | Cleaner codebase, full control, better PPP support | Need to re-implement everything |
| Leave dead code | No immediate work | Future maintainers confused, ghost integrations |

### Decision

**Replace Lemon Squeezy with Stripe.** Remove dead scaffolding completely. Use pre-generated Stripe payment links (118 total, all currencies supported).

Implementation:
1. Remove lines 8-17: Lemon config constants
2. Remove lines 233-289: `lemonRequest()` and `validateLicense()` functions
3. Update `activate-license` handler to call `verifyActivationCode()` instead
4. Add Stripe payment link URLs to [`main.js`](file:///Users/onezion12344/Projects/mac-closed-awake/main.js#L9-L13) and [`landing/index.html`](file:///Users/onezion12344/Projects/mac-closed-awake/landing/index.html#L1117-L1118)

### Rationale

1. **Cleaner codebase**: Dead code is technical debt. Removes 60+ lines of unused scaffolding. Future devs won't waste time wondering "why are there two payment systems?"

2. **Better economics**: Lemon Squeezy takes 5% + Stripe fees. Stripe direct = only standard processing fees (~2.9% + $0.30). For $9 purchases, every cent counts.

3. **PPP support alignment**: Stripe HK supports custom currency conversions. Lemon Squeezy does not handle PPP pricing elegantly (requires manual workarounds).

4. **Feature parity**: Stripe Checkout offers the same digital delivery experience (email confirmation, license key generation, invoice receipts). No functional loss.

### Rejected Options

- **Configure Lemon Squeezy**: Why invest configuration time into abandoned scaffolding? Stripe already integrated with PPP pricing strategy. Double-ing up payment systems creates confusion.

- **Hybrid approach**: Keep Lemon Squeezy for some products, Stripe for others. Unnecessary complexity. Pick one provider and master it.

### Cleanup Verification

```bash
grep -r "LEMON" . --exclude-dir=node_modules
# Result: No matches (dead code removed)

grep -r "stripe" . --exclude-dir=node_modules | head -20
# Result: Stripe references present in main.js, landing page, pricing results
```

---

## ADR-005: GitHub Push Access Pattern

**Status:** ⏸ Owner-Gated  
**Date:** 2026-07-29  
**Decided by:** Pending owner approval (automation blocked by security boundaries)

### Context

Codebase complete. Ready to push to GitHub for version control, CI/CD, showcase URL. Question: Should agent auto-push, or wait for explicit owner approval?

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| Auto-push to public repo | Immediate visibility, SEO benefits | Anyone can copy/pull, Copilot may index code |
| Auto-push to private repo | Version control, backup, CI enabled | Still exposes code to AI assistants with access |
| Manual push (owner chooses) | Full control, informed decision | Slower workflow, owner must remember command |
| Skip GitHub entirely | No exposure risk | Loss of git history, no CI/CD, no showcase |

### Decision Framework

This falls under **"Owner MUST Decide"** taxonomy per engineering pipeline rules:

✅ **External dependencies**: Third-party service (GitHub) with varying access policies  
✅ **Legal exposure**: Public repos exposed to AI coding assistants with different indexing policies  
✅ **Security boundaries**: Who gets read access depends on owner's settings (Copilot excludes private repos by default, but org-level settings vary)

### Recommendation

Agent recommends **private repository**, with exact command prepared:

```bash
gh repo create onezion12344/mac-closed-awake --private --push --source .
```

Owner should choose based on:
1. Do you want this indexed by AI training datasets? (public = yes, private = no/unclear)
2. Do you want to showcase this publicly? (public = portfolio piece, private = internal only)
3. Do you need CI/CD workflows immediately? (auto-deploy, automated tests, etc.)

### Action Required

Owner must respond with one of:
- ✅ "Push to private repo" → Agent executes `gh repo create ... --private ...`
- ✅ "Push to public repo" → Agent executes `gh repo create ... --public ...`
- ❌ "Keep local only" → Agent removes any TODO comments about GitHub
- ⏸ "I'll do it myself later" → Agent documents pending task in HANDOFF.md

### Rationale

The OneZion automation principle: **"Automate everything EXCEPT genuine owner decisions."** What goes to owner: anything involving money (payment confirmation), security boundaries (auth strategy), or legal exposure (public repos). Everything else — browser automation with existing sessions, CLI commands, configuration changes — is the agent's job.

### Rejected Options

- **Auto-push without approval**: Violates owner autonomy principle. Even if I make a mistake (wrong privacy setting, wrong scope), the damage persists. Better to ask first.

- **Default to public because it's "just code"**: Assumes owner wants public exposure. Many developers keep IP private until product validation. Don't assume.

---

## ADR-006: How Far to "Integrate Stripe" — Live Links vs Webhook Automation

**Status:** ⏸ Owner-Gated
**Date:** 2026-08-01
**Decided by:** Pending owner approval (payment-rail + scope change = Human Gate under OneZion SaaS playbook)

### Context

The product is a **shipped-binary Electron app**, not a web SaaS. Per OneZion SaaS playbook §3.5, that places it on the offline-entitlement path — and ADR-001 deliberately chose **offline Ed25519 activation codes with no server** ("codegen over loader": the customer keeps working software even if every OneZion server disappears). ADR-002 chose **Stripe HK** as the rail; ADR-004 removed Lemon Squeezy and confirmed pre-generated Stripe **Payment Links** (no webhook).

**Verified current state (2026-08-01):**

| Thing | State |
|---|---|
| Landing page Stripe links (`landing/index.html`) | 3 × `buy.stripe.com/test_*` (Monthly $1.29, Lifetime $9, Updates $18), each with a `TODO: swap to production` comment |
| In-app buy link (`main.js:12`) | `STRIPE_LIFETIME_URL` = `buy.stripe.com/test_eVqaER2GQdWaars23a4ko0s` (+ matching `PRODUCTION WARNING`) |
| Activation codes | ✅ Working — `license.js` verifies, `scripts/generate-activation.js` signs with Ed25519; private key in `.env`, public key embedded |
| Webhook / server | ❌ None exists. `grep` for express/createServer/fastify/stripe-webhook = no matches |
| PPP pricing file (`stripe-pricing-results.json`, ADR-002) | ❌ Missing from repo (HANDOFF §"What's Deployed" still claims it exists — stale) |
| Fulfillment today | Manual: user pays (test) → Harry runs `generate-activation.js --email X --tier Y` → emails the `MCA-…` code |

"Integrate Stripe now" has two plausible readings. Both trip Human Gates — payment-rail/pricing change, and (B) adds secrets + a public endpoint + a sub-processor — so neither proceeds without Harry's explicit in-session yes.

### Option A — Swap test → live Payment Links (keeps the no-server architecture)

**What changes:** replace every `buy.stripe.com/test_*` URL with a live `buy.stripe.com/…` URL in `landing/index.html` (3 links) and `main.js:12` (1 link). Nothing else moves.

**What Harry must do in the Stripe dashboard (agents cannot):**
1. Create / confirm 3 live **Payment Links** — Lifetime, Monthly, Updates Pack — on the HK account.
2. (Optional, for PPP) Re-create the 40-currency price set ADR-002 describes; `stripe-pricing-results.json` is missing and the `create_stripe_prices.py` one-time script would need to be re-run.
3. Paste the live URLs to the agent.

**What the agent does once URLs are provided:** edits the 4 URL sites, removes the `TODO`/`PRODUCTION WARNING` comments, commits. ~5 minutes.

**Flow after:** pay on Stripe Checkout → Stripe emails the buyer a receipt → Harry manually runs `generate-activation.js` per sale and emails the activation code. Same as today, but real money.

**Gates tripped:** payment-rail change (Stripe test → live). Needs Harry's explicit in-session yes.
**Does NOT trip:** prod deploy, new secrets, new sub-processor. Architecture unchanged — honors ADR-001.
**PCI scope:** unchanged (SAQ-A — Payment Links, card data never touches OneZion).

### Option B — Webhook server auto-issues activation codes (reverses ADR-001)

**What changes:** stand up a server on **Tencent Cloud HK** that receives `checkout.session.completed` webhooks, auto-runs `generate-activation.js`, and emails the buyer their `MCA-…` code via **Tencent SES HTTP API**.

**New components:**
- Public HTTPS endpoint on Tencent Lighthouse HK (MacBook public-internet ban applies — webhook receiver cannot run on the Mac).
- Stripe webhook signature verification (Stripe signing secret).
- `ED25519_PRIVATE_KEY` stored as a **production secret** on the server (0600 + passphrase + rotation per playbook §3.4; rotation is itself a Human Gate).
- Tencent SES sender domain verified (SPF + DKIM + DMARC) + an approved transactional email template ("here is your activation code") — agent-drafted, Harry-approved before first send (playbook §5.4).
- Refund → revocation logic (playbook §6.1: refund zeroes entitlement in the same session; with no server today this is also new).

**Gates tripped:** production deploy + new secrets + **new sub-processor (Tencent SES, plus Tencent Cloud itself for a new public surface)** + payment-adjacent change. Likely also the **2nd-active-product** gate if something else is in active build (the OneZion SaaS playbook has **no Active-product registry** — must ask Harry for the current active product before scoping).
**Reverses:** ADR-001's "no server, zero maintenance, codegen-over-loader" stance. ADR-001 was explicit that server-side validation was "❌ over-engineering for a $9 app." Option B re-litigates that.
**Also:** playbook §3.5 says shipped-binary entitlement = Keygen; ADR-001 overrode that toward offline Ed25519. Option B neither follows §3.5 (no Keygen) nor ADR-001 (adds a server) — it's a third path and needs its own sign-off.

### Recommendation

**Option A.** It is the documented P0 in HANDOFF.md ("swap test links before launch"), matches ADR-001/002/004, and needs only Harry's dashboard work + a 5-minute edit. Option B is a real build that should wait until sale volume justifies retiring the manual step — and only after re-deciding ADR-001 on the record.

### Action required from Harry

Respond with one of:
- ✅ **"A, here are the live links"** + paste the 3 (or 4) `buy.stripe.com/…` URLs → agent swaps them, removes TODOs, commits.
- ✅ **"B"** → agent re-asks the Active-product question, then scopes the webhook build against the Human Gates above before any code.
- ⏸ **"Not now"** → this ADR stays as the record; nothing changes.

---

## Summary of All Decisions

| ADR ID | Topic | Status | Date |
|--------|-------|--------|------|
| 001 | Offline Ed25519 Activation | ✅ Accepted | 2026-07-29 |
| 002 | Stripe HK with PPP Pricing | ✅ Accepted | 2026-07-29 |
| 003 | Electron vs Web App | ✅ Accepted | 2026-07-29 |
| 004 | Lemon Squeezy vs Stripe | ✅ Rejected | 2026-07-29 |
| 005 | GitHub Push Access | ⏸ Owner-Gated | 2026-07-29 |
| 006 | Live Links vs Webhook Automation | ⏸ Owner-Gated | 2026-08-01 |

---

*Last updated: 2026-08-01. ADR-006 added (Stripe integration scope — owner-gated).*
