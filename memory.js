// memory.js — per-app memory report + process freeze (SIGSTOP / SIGCONT).
//
// Three facts measured on this machine shaped this design:
//
// 1. `ps -o rss` is NOT the number Activity Monitor shows. RSS leaves out the
//    compressed pages a process still owns: the same pid read 704 MB resident
//    vs 2242 MB physical footprint. We take footprint from libproc
//    (footprint_probe.c) — the quantity macOS itself uses for memory pressure.
//
// 2. `top` is unusable for a live panel: 0.8 s on a quiet machine, 11.5 s when
//    loaded. The native probe is a flat ~0.4 s for all pids.
//
// 3. Freezing with SIGSTOP drops CPU to 0 immediately but does NOT release
//    RAM — the pages only go cold, and the compressor/swap reclaim them later
//    on the OS's schedule. There is no macOS API to push one process out of
//    memory. The UI says so rather than pretending.
const { execFile, execSync, spawn } = require('child_process')
const { promisify } = require('util')
const path = require('path')
const fs = require('fs')
const os = require('os')

const execFileAsync = promisify(execFile)

// Never listed, never touchable: the operating system itself. Listing it would
// be noise the user cannot act on, and freezing it hangs the machine.
const HIDDEN_PREFIXES = ['/System/Library', '/usr/', '/bin/', '/sbin', '/Library/Apple', '/private/']

// Belt-and-braces names, on top of the path filter.
const NEVER = new Set(['kernel_task', 'launchd', 'WindowServer', 'loginwindow', 'Dock',
  'Finder', 'SystemUIServer', 'ControlCenter', 'Spotlight', 'MacClosedAwake', 'Electron'])

let cachedTotalRAMMB = null
function totalRAMMB() {
  if (cachedTotalRAMMB === null) cachedTotalRAMMB = Math.round(os.totalmem() / 1048576)
  return cachedTotalRAMMB
}

// ── Native probe: compile once into app support, reuse after ──
// The output format is versioned into the filename. A stale binary left by an
// older build would otherwise be reused and silently produce a field count the
// parser rejects — an empty list that looks like "no apps are running".
const PROBE_FMT = 2
const PROBE_SRC = 'footprint_probe.c'
let probePath = null        // resolved usable binary
let probeBuilding = null    // in-flight compile, so we only build once
let probeBroken = false

function probeBinPath() {
  return path.join(appDataDir(), `fp${PROBE_FMT}`)
}

// main.js calls init(app.getPath('userData')) so this is right whether the app
// runs packaged (…/MacClosedAwake) or from source (…/mac-closed-awake).
let DATA_DIR = null
function init(dir) {
  if (dir) DATA_DIR = dir
}
function appDataDir() {
  return DATA_DIR || path.join(os.homedir(), 'Library', 'Application Support', 'mac-closed-awake')
}

function ensureProbe() {
  if (probePath) return Promise.resolve(probePath)
  if (probeBroken) return Promise.resolve(null)
  if (probeBuilding) return probeBuilding

  probeBuilding = (async () => {
    const bin = probeBinPath()
    if (fs.existsSync(bin) && fs.statSync(bin).size > 0) {
      probePath = bin
      return bin
    }
    const src = path.join(__dirname, PROBE_SRC)
    if (!fs.existsSync(src)) { probeBroken = true; return null }

    try {
      const code = fs.readFileSync(src, 'utf8')   // asar-safe read of the .c source
      fs.mkdirSync(path.dirname(bin), { recursive: true })
      const tmpC = path.join(os.tmpdir(), 'mca-footprint-probe.c')
      fs.writeFileSync(tmpC, code)
      // arm64 macOS requires every executable to carry at least an ad-hoc
      // signature; the linker adds one, and we re-add it defensively.
      execSync(`cc -O2 -o ${JSON.stringify(bin)} ${JSON.stringify(tmpC)}`, { stdio: 'ignore', timeout: 60000 })
      try { execSync(`codesign --force --sign - ${JSON.stringify(bin)} 2>/dev/null`, { stdio: 'ignore' }) } catch {}
      if (!fs.existsSync(bin)) { probeBroken = true; return null }
      probePath = bin
      return bin
    } catch (e) {
      // No Command Line Tools on this machine — caller falls back to `top`.
      console.error('[MCA] footprint probe build failed:', e.message)
      probeBroken = true
      return null
    } finally {
      probeBuilding = null
    }
  })()
  return probeBuilding
}

// pid -> { footprintMB, rssMB, stopped, path }
async function footprintMap() {
  const bin = await ensureProbe()
  if (!bin) return slowFootprintMap()
  try {
    const { stdout } = await execFileAsync(bin, [], { maxBuffer: 32 * 1024 * 1024, timeout: 15000 })
    const map = new Map()
    for (const line of stdout.split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*(.*)$/)
      if (!m) continue
      map.set(parseInt(m[1], 10), {
        memMB: Math.round(parseInt(m[2], 10) / 1048576),
        rssMB: Math.round(parseInt(m[3], 10) / 1048576),
        // SSUSP/SSTOP — the kernel's own answer to "is this frozen",
        // independent of what our paused.json claims.
        stopped: parseInt(m[4], 10) === 4,
        path: m[5] || '',
      })
    }
    // A probe that reads nothing (wrong format, blocked, stripped) must not
    // present as "no apps are using memory" — fall back instead.
    if (map.size < 10) {
      console.error(`[MCA] probe returned only ${map.size} pids, falling back to top`)
      try { fs.unlinkSync(bin) } catch {}
      probePath = null
      return slowFootprintMap()
    }
    return map
  } catch (e) {
    console.error('[MCA] probe run failed, falling back to top:', e.message)
    return slowFootprintMap()
  }
}

// Fallback for machines without a compiler. Slower, but the numbers stay
// Activity-Monitor-correct (top's MEM column is also phys_footprint).
async function slowFootprintMap() {
  try {
    const { stdout } = await execFileAsync('top', ['-l', '1', '-n', '1000', '-stats', 'pid,mem', '-o', 'mem'],
      { maxBuffer: 32 * 1024 * 1024, timeout: 30000 })
    const map = new Map()
    for (const line of stdout.split('\n')) {
      const m = line.trim().match(/^(\d+)\s+([\d.]+[KMGT]?)\s*$/i)
      if (m) map.set(parseInt(m[1], 10), { memMB: Math.round(parseMemToken(m[2])), rssMB: 0, stopped: false, path: '' })
    }
    return map
  } catch {
    return new Map()
  }
}

function parseMemToken(tok) {
  const m = String(tok).trim().match(/^([\d.]+)\s*([KMGT]?)B?$/i)
  if (!m) return 0
  const n = parseFloat(m[1])
  if (!isFinite(n)) return 0
  const mult = { '': 1 / 1048576, K: 1 / 1024, M: 1, G: 1024, T: 1048576 }
  return n * (mult[m[2].toUpperCase()] ?? 1)
}

// Outermost `.app` wins, so Notion's five helpers become one Notion row.
// Partially freezing an app is exactly what wedges it.
function labelFor(comm) {
  if (!comm) return null
  // An unresolvable path means we cannot tell system binary from app, so it
  // stays out of the list. This is not hypothetical: `ps` reports the short
  // scripts spawn as a bare "sleep", and those processes routinely exist in
  // `ps` but not in the probe snapshot taken microseconds apart — a race that
  // would otherwise leak system binaries into a list of freezeable apps.
  if (!comm.startsWith('/')) return null
  for (const p of HIDDEN_PREFIXES) if (comm.startsWith(p)) return null
  if (/\/com\.apple\./.test(comm)) return null

  const bundle = comm.match(/\/([^/]+)\.app\//)
  if (bundle) return NEVER.has(bundle[1]) ? null : { name: bundle[1], kind: 'app' }
  if (comm.startsWith('/usr/')) return null

  const base = comm.split('/').pop()
  if (!base || NEVER.has(base)) return null
  return { name: base, kind: 'bin' }
}

// Our pid and every ancestor: freezing the app you unfreeze with — or the
// shell that launched it — is how you get an unrecoverable desk.
// The ancestry cannot change during a run, so resolve it once: this used to
// cost one synchronous `ps` per ancestor on every refresh.
let selfProtectionCache = null
function selfProtectionSet() {
  if (selfProtectionCache) return selfProtectionCache
  const set = new Set([process.pid])
  let pid = process.pid
  for (let i = 0; i < 24 && pid > 1; i++) {
    let parent = NaN
    try {
      parent = parseInt(execSync(`ps -p ${pid} -o ppid=`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(), 10)
    } catch { break }
    if (!isFinite(parent) || parent <= 1 || set.has(parent)) break
    set.add(parent)
    pid = parent
  }
  selfProtectionCache = set
  return set
}

// ── Snapshot ──
async function collect() {
  const [psR, memMap, hpR, swapR, phys] = await Promise.all([
    execFileAsync('ps', ['-Ao', 'pid=,pcpu=,state=,comm='], { maxBuffer: 32 * 1024 * 1024 }),
    footprintMap(),
    execFileAsync('memory_pressure', ['-Q']).catch(() => ({ stdout: '' })),
    execFileAsync('sysctl', ['-n', 'vm.swapusage']).catch(() => ({ stdout: '' })),
    vmStatMem(),
  ])

  const mine = selfProtectionSet()
  const groups = new Map()

  for (const line of psR.stdout.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+([\d.]+)\s+(\S+)\s+(.*)$/)
    if (!m) continue
    const pid = parseInt(m[1], 10)
    if (pid <= 1 || mine.has(pid)) continue

    // proc_pidpath is authoritative; ps's comm sometimes carries no path at all.
    const label = labelFor(memMap.get(pid)?.path || m[4])
    if (!label) continue

    if (!groups.has(label.name)) {
      groups.set(label.name, { name: label.name, kind: label.kind, pids: [], cpu: 0, memMB: 0, stopped: 0, total: 0 })
    }
    const g = groups.get(label.name)
    g.pids.push(pid)
    g.cpu += parseFloat(m[2]) || 0
    g.memMB += memMap.get(pid)?.memMB || 0
    g.total += 1
    // Trust the kernel state over our own bookkeeping: `ps` shows T for
    // stopped, and it stays right even if something else froze or resumed it.
    if (m[3].startsWith('T') || memMap.get(pid)?.stopped) g.stopped += 1
  }

  const apps = [...groups.values()]
    .map(g => ({
      name: g.name,
      kind: g.kind,
      memMB: Math.round(g.memMB),
      memPct: Math.round((g.memMB / totalRAMMB()) * 1000) / 10,
      cpu: Math.round(g.cpu * 10) / 10,
      procs: g.total,
      pids: g.pids,
      frozen: g.stopped > 0 && g.stopped === g.total,
      partial: g.stopped > 0 && g.stopped < g.total,
    }))
    .sort((a, b) => b.memMB - a.memMB)

  const swap = swapR.stdout.match(/total\s*=\s*([\d.]+)M\s+used\s*=\s*([\d.]+)M/i)
  const free = hpR.stdout.match(/free percentage:\s*([\d.]+)/i)

  return {
    apps,
    system: {
      totalRAMMB: totalRAMMB(),
      pressureFreePct: free ? parseFloat(free[1]) : null,
      swapUsedMB: swap ? Math.round(parseFloat(swap[2])) : null,
      swapTotalMB: swap ? Math.round(parseFloat(swap[1])) : null,
      ...phys,
    },
  }
}

// vm_stat gives used / wired / compressor without top's slow sample. Labels
// verified against macOS 26 output: "Pages wired down:", "Pages occupied by
// compressor:", etc.
async function vmStatMem() {
  let out = ''
  try {
    out = (await execFileAsync('vm_stat', [], { timeout: 10000 })).stdout
  } catch {
    return {}
  }
  const pm = out.match(/page size of (\d+) bytes/)
  const pageSizeMB = (pm ? parseInt(pm[1], 10) : 16384) / 1048576
  const pages = (label) => {
    const m = out.match(new RegExp(`${label}:\\s+(\\d+)`))
    return m ? Math.round(parseInt(m[1], 10) * pageSizeMB) : 0
  }
  const wired = pages('Pages wired down')
  const active = pages('Pages active')
  const compressed = pages('Pages occupied by compressor')
  return {
    wiredMB: wired,
    compressorMB: compressed,
    activeMB: active,
    inactiveMB: pages('Pages inactive'),
    unusedMB: pages('Pages free'),
    usedMB: wired + active + compressed,
  }
}

// ── Freeze record (only for what THIS app froze, so we can auto-thaw) ──
function storePath() { return path.join(appDataDir(), 'frozen.json') }
function loadFrozen() {
  try { return JSON.parse(fs.readFileSync(storePath(), 'utf8')) } catch { return {} }
}
function saveFrozen(map) {
  try {
    fs.mkdirSync(path.dirname(storePath()), { recursive: true })
    fs.writeFileSync(storePath(), JSON.stringify(map, null, 2))
  } catch (e) { console.error('[MCA] frozen.json write failed:', e.message) }
}

function signal(pids, sig) {
  // pids come out of a regex over `ps`, so they are integers by construction;
  // re-checked anyway because this string reaches a shell.
  const list = (pids || []).map(Number).filter(p => Number.isInteger(p) && p > 1)
  if (!list.length) return { ok: false, signalled: 0 }
  try {
    execSync(`kill -${sig} ${list.join(' ')}`, { stdio: 'ignore' })
    return { ok: true, signalled: list.length }
  } catch {
    // One pid that exited mid-batch fails the whole kill; retry individually
    // so a dead helper cannot block the app's remaining processes.
    let n = 0
    for (const p of list) {
      try { execSync(`kill -${sig} ${p}`, { stdio: 'ignore' }); n++ } catch {}
    }
    return { ok: n > 0, signalled: n }
  }
}

function isPauseable(name) {
  return !!name && !NEVER.has(name)
}

async function freeze(name) {
  if (!isPauseable(name)) return { ok: false, error: `${name} is protected` }
  const { apps } = await collect()
  const target = apps.find(a => a.name === name)
  if (!target) return { ok: false, error: `${name} is not running` }
  const r = signal(target.pids, 'STOP')
  if (!r.ok) return { ok: false, error: 'could not signal the app' }
  const map = loadFrozen()
  map[name] = { pids: target.pids, at: Date.now(), memMB: target.memMB }
  saveFrozen(map)
  console.error(`[MCA] froze ${name} (${target.pids.length} procs, ${target.memMB} MB held)`)
  return { ok: true, procs: target.pids.length }
}

async function thaw(name) {
  const map = loadFrozen()
  // Prefer live pids; recorded ones may already have been recycled.
  let pids = map[name]?.pids || []
  try {
    const { apps } = await collect()
    const live = apps.find(a => a.name === name)
    if (live && live.pids.length) pids = live.pids
  } catch {}
  const r = signal(pids, 'CONT')
  delete map[name]
  saveFrozen(map)
  console.error(`[MCA] thawed ${name} (${r.signalled} procs)`)
  return { ok: r.ok, signalled: r.signalled }
}

// Runs on quit and before Nuclear — we must never leave an app frozen.
function thawAll() {
  const map = loadFrozen()
  const names = Object.keys(map)
  if (!names.length) return { ok: true, thawed: 0 }
  for (const name of names) signal(map[name].pids || [], 'CONT')
  saveFrozen({})
  console.error(`[MCA] thawed ${names.length} app(s): ${names.join(', ')}`)
  return { ok: true, thawed: names.length }
}

function frozenNames() { return Object.keys(loadFrozen()) }

// ── System-wide cache purge ──
// `purge` releases clean file-cache pages. That is not the same as taking
// memory back from an app, and it can make things briefly slower while files
// get re-read. Asked for through a one-off admin prompt — deliberately no
// permanent NOPASSWD sudoers rule for it.
async function purgeCaches() {
  try {
    await execFileAsync('/usr/bin/sudo', ['-n', '/usr/sbin/purge'], { timeout: 60000 })
    return { ok: true }
  } catch {}
  try {
    await execFileAsync('/usr/bin/osascript',
      ['-e', 'do shell script "/usr/sbin/purge" with administrator privileges'],
      { timeout: 120000 })
    return { ok: true, prompted: true }
  } catch (e) {
    return { ok: false, cancelled: /-128/.test(String(e.message)), error: String(e.message).slice(0, 160) }
  }
}

module.exports = { init, collect, freeze, thaw, thawAll, frozenNames, purgeCaches, isPauseable, parseMemToken, labelFor, ensureProbe }
