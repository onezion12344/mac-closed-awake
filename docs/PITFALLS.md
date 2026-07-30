# MacClosedAwake Pitfalls Verified

**Earned facts from development** — root cause + fix + verification method. These are what you learn when things go wrong and how to prevent recurrence.

---

## Ed25519 Key Loading (Node.js v22)

**Problem:** `crypto.createPrivateKey()` throws `ERR_OSSL_UNSUPPORTED: error:1E08010C:DECODER routines::unsupported`

**Root Cause:** Node.js v22's `.env` loader doesn't support multi-line PEM keys by default. When loading a PEM key that spans multiple lines (-----BEGIN PRIVATE KEY-----\nMC4CAQ...), the simple line-by-line parser splits the key at newlines, breaking the cryptographic operation.

**Fix:** Extended `.env` loader in [`scripts/generate-activation.js`](file:///Users/onezion12344/Projects/mac-closed-awake/scripts/generate-activation.js#L17-L85) to detect YAML-style multi-line values (key followed by indented continuation lines).

```javascript
// Load .env with multi-line support
if (val.startsWith('|')) {
  // YAML-style multi-line (lines start with spaces)
  // Accumulate continuation lines until no more indented content
  while (nextLine.startsWith(' ')) {
    currentValue.push(nextLine.trim())
    nextLine = getNextLine()
  }
  fullValue = currentValue.join('\n')
}
```

**Verification:** After fix, tested with actual Ed25519 private key:
```bash
ED25519_PRIVATE_KEY="$(cat .env)" node scripts/generate-activation.js --email test@example.com --tier lifetime
# Output: MCA-{valid_base64url_signature}
```

**Lesson logged:** Never trust a ".env loader" without verifying multi-line support for PEM keys. Memory is not a source — verify before deploying.

---

## Lemon Squeezy Dead Code

**Problem:** Found unused licensing scaffolding in [`main.js`](file:///Users/onezion12344/Projects/mac-closed-awake/main.js#L8-L17) and [`index.html`](file:///Users/onezion12344/Projects/mac-closed-awake/index.html#L418-L438) — empty store ID / variant ID strings, never-configured integration.

**Root Cause:** Previous session scaffolded Lemon Squeezy integration but it was abandoned before configuration. Left as "dead weight" in codebase, creating confusion about which payment system to use.

**Fix:** Removed entire Lemon Squeezy code paths:
- Lines 8-17: Config constants (empty strings)
- Lines 233-289: `lemonRequest()` function, `validateLicense()` handler
- Updated `activate-license` handler to use `verifyActivationCode()` instead

**Verification:** 
- `grep -r "LEMON" main.js index.html` → No matches
- Syntax check passes: `node -c main.js && node -c license.js`

**Lesson logged:** Always audit for dead code when integrating new systems. Leave-no-trace cleanup prevents future maintainers from re-discovering "ghost integrations."

---

## Stripe Test Mode Links

**Problem:** All Stripe payment links left in test mode (`buy.stripe.com/test_*`) after initial setup.

**Root Cause:** Pipeline skipped Phase 4 fact-check of plan claims. Assumed Stripe links were "just placeholders" rather than concrete implementation requirements.

**Fix:** Added explicit TODO comments in both [`main.js`](file:///Users/onezion12344/Projects/mac-closed-awake/main.js#L9-L13) and [`landing/index.html`](file:///Users/onezion12344/Projects/mac-closed-awake/landing/index.html#L1117-L1118):
```javascript
// ⚠️ PRODUCTION WARNING: These are TEST Stripe links.
// Before shipping: replace buy.stripe.com/test_* with production links
const STRIPE_LIFETIME_URL = 'https://buy.stripe.com/test_eVqaER2GQdWaars23a4ko0s'
```

**Verification:** Ego-browser automated test confirmed all 3 links accessible and functional in test mode.

**Lesson logged:** Plan fact-check phase catches these early. Never assume something "doesn't matter" — even placeholders need explicit marking.

---

## Activation Code Format

**Problem:** Uncertainty about activation code signature algorithm (HMAC vs Ed25519 vs RSA).

**Root Cause:** No domain research on offline license validation best practices. Considered HMAC but didn't benchmark alternatives or verify security implications.

**Resolution:** Benchmark decision process:
- **HMAC**: Requires embedding secret key in open-source binary → anyone can generate codes (NOT SAFE)
- **Ed25519**: Public key embedded (safe), private key kept separate → signatures verifiable, unforgeable ✅
- **RSA**: Overkill, larger signatures, slower verification

**Decision:** Ed25519 asymmetricsignatures. Rationale: OneZion's principle "codegen-over-loader" — if I walk away from this project tomorrow, customer still has working software without my private key.

**Verification:**
```bash
# Generate new keypair (prints public + private)
node scripts/generate-activation.js --init

# Sign payload with private key
node scripts/generate-activation.js --email buyer@email.com --tier lifetime
# Output: MCA-{payload}.{signature}

# Verify signature using embedded public key in license.js
node -e "require('./license').verifyActivationCode(code)"
# Returns: { valid: true, email: "...", tier: "..." }
```

**Lesson logged:** Security decisions deserve benchmarking against competitors and OSS solutions. Don't assume "impossible" without trying alternatives.

---

## Model Selection Costs

**Problem:** Using most capable model for every task (mechanical string manipulation, syntax checks, etc.) unnecessarily.

**Root Cause:** Omission defaults to most expensive model. Didn't realize cheaper tiers work fine for well-defined tasks.

**Fix:** Specify model explicitly in subagent dispatch:
- Mechanical tasks (file edits, config updates) → cheapest tier
- Integration tasks (IPC bridges, crypto modules) → mid-tier  
- Architecture review → most capable model

**Verification:** Ledger durability ensures cheap models complete tasks correctly. After compaction, trust ledger over memory.

**Lesson logged:** Always specify model per role. Omission silently defaults to most expensive. This adds up quickly across long pipelines.

---

## GitHub Push Decision

**Problem:** Whether to auto-push codebase to GitHub.

**Root Cause:** Copilot and AI coding assistants have varying access patterns depending on owner settings (some exclude private repos, others don't). Auto-pushing could expose code to unintended audiences.

**Resolution:** Made an "owner MUST decide" gate item. Present exact command ready to execute, user chooses.

**Command prepared:**
```bash
gh repo create onezion12344/mac-closed-awake --private --push --source .
```

**Lesson logged:** Automate everything EXCEPT genuine owner decisions. What goes to owner: anything involving money (payment confirmation), security boundaries (auth strategy), or legal exposure (public repos). Everything else — browser automation with existing sessions, CLI commands, configuration changes — is the agent's job.

---

## Multi-Line .env Loader Pattern

**Problem:** `.env` files with PEM keys span multiple lines. Standard parsers treat each line as independent.

**Root Cause:** Node.js `.env` package treats keys with `=` as single-line values only. Doesn't support YAML-style block scalars (`|`).

**Fix:** Custom parser in [`generate-activation.js`](file:///Users/onezion12344/Projects/mac-closed-awake/scripts/generate-activation.js#L17-L85):
```javascript
for (const line of lines) {
  const eqIdx = line.indexOf('=')
  if (eqIdx === -1) {
    // Continuation line (no new key=value pair)
    if (currentKey !== null) currentValue.push(line.trim())
    continue
  }
  // Handle completion of multi-line value
  ...
}
```

**Lesson logged:** Tools report, you verify. Every factual claim mapped to source (in this case: actual Node.js behavior via testing, not docs). Memory is not a source.

---

## Summary of Verified Pitfalls

| Issue | Status | Fix Applied |
|-------|--------|-------------|
| Ed25519 multi-line loading | ✅ Fixed | Extended .env loader |
| Lemon Squeezy dead code | ✅ Fixed | Complete removal |
| Test Stripe links | ⏸ Pending | TODO comments added, must swap before launch |
| Activation code format | ✅ Resolved | Ed25519 selected & implemented |
| GitHub push decision | ⏸ Owner-gated | Command prepared, waiting for approval |

---

*Last updated: 2026-07-29. Written during Phase 6 delivery.*
