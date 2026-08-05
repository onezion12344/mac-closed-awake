## v1.1.0 - Robust Lid-Close Prevention (2026-07-31)

### 🐛 Bug Fix

**Fixed critical lid-close sleep reactivation bug:**
After activating MacClosedAwake, closing the lid once worked fine, but subsequent lid closures would cause macOS to ignore the `disablesleep` setting and go to sleep anyway.

### 🔧 What Changed

1. **Added `caffeinate` process monitoring** 
   - Started a background `caffeinate -u -i` process that creates an active assertion to keep the Mac awake
   - Works in tandem with `pmset` for defense-in-depth

2. **Added continuous power state monitor**
   - Bash script polls `pmset` status every 5 seconds
   - Detects when system tries to override sleep disable
   - Re-applies both `caffeinate` and `pmset` commands automatically

3. **Enhanced helper daemon**
   - Added `LID_CLOSE` command handler via Unix socket
   - Immediate response to power management events

4. **Better cleanup on stop**
   - Both caffeine process and power monitor properly terminated
   - No orphaned processes running after app stops

### 📦 Installation

```bash
# Update Homebrew cask
brew tap onezion12344/mac-closed-awake
brew upgrade --cask mac-closed-awake

# Or install fresh
brew install --cask mac-closed-awake
```

### 🏗️ Build Artifacts

- `dist/MacClosedAwake-1.1.0-arm64.dmg` (153MB)
- SHA256: `21ec375ad2a570c31602305a4c1afdf99e6894231e95f337c775c8ebf1bc5e67`
- Platform: macOS ARM64 (Apple Silicon)

### 📝 Technical Details

**Why both `caffeinate` AND `pmset`?**
- `caffeinate` = Active assertion (prevents idle sleep)
- `pmset` = System configuration (sets default behavior)
- Together they provide redundancy against macOS override attempts

**Root Cause**: macOS can override passive `pmset` settings when detecting hardware events like lid closure. The new monitor detects this and immediately re-enforces both mechanisms.

---

*For more details, see:* [docs/DECISIONS.md](file:///Users/onezion12344/Projects/mac-closed-awake/docs/DECISIONS.md) | [GitHub commit](https://github.com/onezion12344/mac-closed-awake/commit/5c380d5)
