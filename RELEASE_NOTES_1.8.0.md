# MacClosedAwake v1.8.0

**合上盖子，保持唤醒。** 这版加了一个内存面板：谁在吃内存，一眼看到，还能当场冻住它。

## 新增 / 改动

- ❄️ **内存与冻结（Memory & frozen apps）** — 主界面新增入口，列出每个应用**真实占用的内存**（和「活动监视器」同一个口径：physical footprint），按占用从高到低排。每行一个 **Pause** 按钮：用 `SIGSTOP` 把应用整个冻住，CPU 立刻归零；点 **Resume** 又回到冻结前的状态继续跑，不丢数据。
- 🧊 **按 bundle 归组** — Notion 的 11 个辅助进程在列表里只算一行，冻结时一起冻。只冻一半恰恰是把应用卡死的做法。
- 🚫 **该保护的都保护住了** — 系统进程（WindowServer、Dock、Finder、launchd 等）和 `/System/Library`、`/usr` 下的守护进程根本不进列表；本应用自己的进程链也进不了列表 —— 不会出现「把自己冻住、没人能解冻」。
- 🔒 **绝不留后患** — 退出应用时自动解冻全部；崩溃重启后开机第一件事也是解冻。按「核弹」重启/关机前同样先解冻，否则被冻住的应用收不到正常退出信号，会被直接强杀、连保存提示都没有。
- 🧹 **Purge disk cache** — 需要管理员密码时只弹一次授权，不会往 sudoers 里写永久免密规则。
- 📊 **内存压力条** — 显示的是 macOS 自己的压力指标（Apple 的判读标准只有一句：绿色正常、黄色有压力、红色吃紧），而不是「剩余可用字节」。RAM 显示快满本来就是正常的。

## 一句实话

**冻结 ≠ 释放内存。** `SIGSTOP` 让 CPU 立刻归零，但内存还在它手里 —— 只是页面变「冷」了，之后由 macOS 的压缩器/交换区按自己的节奏处理。macOS 没有任何 API 能把某个指定进程的内存强制收回来。真想拿回内存，就退出那个应用。面板里把这句话写在了最上面，不藏着。

（`purge` 同理：它自己的手册原文是「It does not affect anonymous memory that has been allocated through malloc, vm_allocate, etc.」—— 它清的是磁盘缓冲缓存，不是应用的内存。）

## English

**Close the lid. Stay awake.** This release adds a memory panel: see exactly which app is eating RAM, and freeze it on the spot.

- ❄️ **Memory & frozen apps** — every app's **real** memory footprint (the same quantity Activity Monitor shows — `phys_footprint`, not `ps` RSS), sorted high to low. Each row has a **Pause** button: `SIGSTOP` freezes the app, CPU drops to 0 immediately; **Resume** (`SIGCONT`) picks up exactly where it stopped.
- 🧊 **Grouped by bundle** — Notion's 11 helper processes are one row and freeze together; freezing only half of an app's processes is what wedges it.
- 🚫 **Protected by construction** — OS daemons and this app's own process ancestry never reach the list, so you cannot freeze the thing you'd unfreeze with.
- 🔒 **Never left frozen** — everything thaws on quit, on crash-recovery at startup, and before Nuclear (a stopped process can't receive the graceful quit signal, so it would otherwise be hard-killed with no chance to save).
- 🧹 **Purge disk cache** — one admin prompt on demand; no permanent passwordless sudoers rule is written.
- 📊 **Pressure, not free bytes** — the gauge uses macOS's own memory-pressure reading (Apple's rule: green is good, yellow is pressure, red is real pressure). "RAM almost full" is normal on macOS.

**The honest part:** freezing does **not** return RAM. The app keeps holding it; the pages just go cold, and the compressor/swap deal with them later on the OS's schedule. No macOS API evicts a chosen process from memory. To truly reclaim it, quit the app — the panel says so at the top.

## Under the hood

`top` reports the right number but costs 0.8 s idle and **11.5 s** when the machine is loaded — unusable for a live panel. `ps -o rss` is fast but reports ~3× too little (762 MB vs 2164 MB on the same process). So v1.8.0 ships a 50-line libproc probe (`footprint_probe.c`, `proc_pid_rusage` → `ri_phys_footprint`) that is compiled into the app's own data folder on first run and reads every process in **~350 ms**. Nothing prebuilt is shipped, so there is nothing extra to sign; machines without a compiler fall back to `top` automatically.

**Full changelog:** https://github.com/onezion12344/mac-closed-awake/compare/v1.7.0...v1.8.0
