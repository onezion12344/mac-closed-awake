# MacClosedAwake v1.1.0 Release Notes (Final)

## 🐛 Bug Fixes

### Fixed: App Won't Quit Properly
**Problem**: Closing window or quitting left orphaned processes in memory
- Multiple Electron renderer processes stuck
- Background `caffeinate` process never terminated  
- Power monitor script running indefinitely
- No cleanup when stopping timer

**Solution**: Added proper shutdown handlers
- `before-quit` hook stops all background processes before exit
- Tray menu "Quit" option now cleans up properly with 500ms delay
- Automatically re-enables sleep via helper daemon
- Timer intervals cleared on quit
- Socket files cleaned up

### Fixed: Lid-Close Sleep Reactivation (v1.1.0 Core Fix)
**Problem**: After activating, first lid-close worked but subsequent closures would cause Mac to sleep anyway

**Solution**: Multi-layer protection
1. **Caffeinate assertion** - Active process prevents idle sleep
2. **Power monitor** - Polls pmset every 5 seconds
3. **Auto-recovery** - Re-applies both mechanisms when override detected

---

## 🎨 Visual Updates

### New Icon
- Switched from generic placeholder to **yellow sheep mascot** (`icon.icns`)
- Matches brand identity shown in landing page and README
- Professional tray icon appearance

---

## 🔧 Technical Improvements

### Code Changes in `main.js`
1. **Lines 15-20**: Added state variables (`caffeineProcess`, `powerMonitor`, `lidCloseCount`)
2. **Lines 39-87**: Added caffeine/power monitor functions
3. **Lines 89-164**: Enhanced helper socket with LID_CLOSE handling
4. **Lines 251-317**: Continuous power monitoring logic
5. **Lines 348-364**: Cleanup on stop handler
6. **Lines 398-410**: Safe quit with timeout-based cleanup
7. **Lines 486-500**: App lifecycle hooks for graceful shutdown

### Files Changed
- ✅ `main.js` - Core app logic
- ✅ `icon.icns` - Yellow sheep mascot (from v1.0.0 build)
- ✅ `scripts/kill-and-restart.sh` - Emergency cleanup script

---

## 📦 Build Info

```
Version: 1.1.0
Build Date: 2026-07-31 22:45 UTC
Platform: macOS ARM64 (Apple Silicon)
Size: ~149 MB DMG
Icon: Yellow Sheep Mascot (icon.icns)
```

---

## 🧪 Testing Checklist

### Before Release
- [x] Kill all orphaned processes manually
- [x] Verify quit handler works
- [x] Test tray icon displays correctly
- [x] Check stripe payment link accessible
- [x] Helper daemon installs successfully
- [x] Socket communication works

### User Testing Required
1. **Normal quit**: Click tray → Quit → processes terminate
2. **Force quit**: Cmd+Q → verify no zombie processes
3. **Timer activation**: Start timer → close lid → wake stays active
4. **Multiple cycles**: Close/open/close lid 3x → should stay awake
5. **Stop mid-timer**: Stop button → sleep re-enables immediately
6. **Forever mode**: Activate → quit → sleep enabled on exit

---

## 🚀 Installation

### Homebrew (recommended)
```bash
brew tap onezion12344/mac-closed-awake
brew upgrade --cask mac-closed-awake
```

### Manual Install
Download `MacClosedAwake-1.1.0-arm64.dmg` from GitHub releases
Drag `MacClosedAwake.app` to `/Applications`

---

## 📊 Version History

### v1.1.0 (2026-07-31)
- ✅ Fix: Proper quit/shutdown handlers
- ✅ Fix: Lid-close sleep reactivation bug
- ✅ Fix: Orphaned process cleanup
- 🎨 Update: Yellow sheep mascot icon
- 🛡️  Enhancement: Defense-in-depth sleep prevention

### v1.0.0 (2026-07-18)
- Initial release with basic pmset integration
- ⚠️ Known bug: lid-close reactivation failure on 2nd+ closure

---

## 🔗 Links

- [GitHub Repository](https://github.com/onezion12344/mac-closed-awake)
- [Latest Release](https://github.com/onezion12344/mac-closed-awake/releases/tag/v1.1.0)
- [Decision Records](docs/DECISIONS.md)
- [Test Script](scripts/test.sh)
- [Kill & Restart Script](scripts/kill-and-restart.sh)
