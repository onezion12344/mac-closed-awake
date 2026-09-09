# MacClosedAwake v1.7.0

**合上盖子，保持唤醒。** 这版把三个日常最烦人的地方磨平了。

## 新增 / 改动

- ☢️ **核弹不再每次都要密码** — 第一次按下会弹一次系统授权，之后关机/重启再也不问。以前点一次输一次，现在只输一次。
- 🪟 **窗口位置记忆（可开关）** — 勾上「Restore window size & position」，下次打开就回到你上次拖到的位置和大小；不想要就取消勾选。
- 🔋 **2% 不再秒睡** — 电量到 2% 时先弹一条系统通知「一分钟后休眠」，给你时间插充电器；插上了就取消休眠。想恢复旧行为可关掉「Warn before critical sleep」。
- 🌐 **界面全英文** — 低电量模式那块说明文字改成英文，跟随系统状态显示。

## English

**Close the lid. Stay awake.** This release smooths three daily annoyances.

- ☢️ **Nuclear asks for your password once** — the first press shows a single macOS auth prompt; every shut down / restart after that is silent. Set up its own passwordless rule for `/sbin/shutdown` (validated with `visudo` before install).
- 🪟 **Remember window size & position** — a toggle to reopen the window exactly where you left it (or reset to default).
- 🔋 **No more instant sleep at 2%** — hitting 2% now raises a system notification and a 60-second grace window so you can plug in; connect the charger and it stays awake. Turn "Warn before critical sleep" off for the old immediate behavior.
- 🌐 **English UI** — the Low Power Mode description is now in English and mirrors the live system state.

**Full changelog:** https://github.com/onezion12344/mac-closed-awake/compare/v1.6.3...v1.7.0
