# MacClosedAwake v1.6.1

**合上盖子，保持唤醒。** 黄羊让你合盖不眠 —— 不仅核心功能稳定多了，还做了很多 Mac 上很实用的功能，还把付费功能也加上了。有彩蛋的，可以去试一下，注意调小音量。[旺柴]

> 🎉 **彩蛋提示**: 核弹按钮旁边有个 「🎉 Countdown show」开关，打开后按下关机/重启，会有全屏红色倒数 5→0 + 滴答音效，倒数结束准时黑屏。先调小音量再试。

## 现在支持

- **允许不眠和低电量模式同时运行** — 长时间跑任务也能很凉快（LPM 不再和保持唤醒冲突）
- **电量低于 2% 自动恢复正常的休眠功能** — 没电休眠时不会出错，干净关机
- **电量低于 2% 自动进入休眠** — 下次开机不需要等待充到 1%，插电按按钮就能开机，就算只是 5V1A
- **窗口支持 Resize** — 自由拖拽调整大小，内容放不下就滚动，不会遮蔽按钮
- **核弹 [☢️]** — Mac 不像 Windows，关机/重启不会自动杀掉卡死的 App，每次都要手动点半天。核弹会逐个正常退出所有应用、退不掉的强杀，然后关机或重启。彩蛋就在它旁边。

## 为什么不是「又一个咖啡因」

之前有朋友说这是咖啡因能做到的。如果你真的找到一个基于咖啡因的软件能做到这一点，欢迎交流 —— 因为我试过的所有咖啡因都做不到。这个不是基于咖啡因去做的。

---

## What's new (English)

**Close the lid. Stay awake.** The yellow sheep keeps your Mac running with the lid shut — and now with a lot more than just "stay awake."

- 🧊 **Low Power Mode + keep-awake together** — long headless runs stay cool
- 🔋 **Battery protection (≤2%)** — auto-restores sleep before the battery dies, so shutdown is clean (no hibernate errors)
- 😴 **Force sleep at ≤2%** — next boot needs no "charge to 1%" wait; plug in (even 5V1A) and power on
- 🪟 **Resizable window** — drag to any size; content scrolls instead of getting clipped
- ☢️ **NUCLEAR (Shut Down / Restart)** — macOS won't auto-kill hung apps on reboot like Windows. Nuclear gracefully quits every app, force-quits stragglers, then shuts down or reboots.
- 🎉 **Easter egg** — enable "Countdown show" next to the nuclear buttons, confirm, and get a fullscreen 5→0 alarm with ticks before the machine goes dark. Turn your volume down first.

**Not just another caffeinate wrapper** — if you can find a caffeinate-based tool that truly survives lid-close on battery and does all of the above, we'd love to hear about it. This one isn't built on caffeinate.

**Full changelog:** https://github.com/onezion12344/mac-closed-awake/compare/v1.6.0...v1.6.1