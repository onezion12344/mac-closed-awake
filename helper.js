#!/usr/bin/env node
// MacClosedAwake privileged helper — runs via launchd as the current user.
// Replaces the previous bash/socat implementation to avoid file-descriptor leaks
// and fork storms that made the helper unresponsive after a while.
const net = require('net')
const { exec } = require('child_process')
const fs = require('fs')

const SOCKET = '/tmp/com.mca.helper.sock'
const LOG_FILE = '/tmp/mca-helper.log'
const ERR_FILE = '/tmp/mca-helper.err'

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}
`
  try { fs.appendFileSync(LOG_FILE, line) } catch {}
}

function logError(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}
`
  try { fs.appendFileSync(ERR_FILE, line) } catch {}
}

function pmset(args) {
  return new Promise((resolve, reject) => {
    exec(`sudo -n pmset ${args}`, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message))
      } else {
        resolve(stdout.trim())
      }
    })
  })
}

async function handle(cmd) {
  switch (cmd) {
    case 'DISABLE':
      await pmset('-a disablesleep 1')
      return 'OK'
    case 'ENABLE':
      await pmset('-a disablesleep 0')
      return 'OK'
    case 'STATUS': {
      const out = await pmset('-g')
      const match = out.match(/SleepDisabled\s+(\d)/)
      return match ? match[1] : '0'
    }
    case 'LOWPOWER_ON':
      await pmset('-a lowpowermode 1')
      return 'OK'
    case 'LOWPOWER_OFF':
      await pmset('-a lowpowermode 0')
      return 'OK'
    case 'LOWPOWER_STATUS': {
      const out = await pmset('-g')
      const match = out.match(/lowpowermode\s+(\d)/)
      return match ? match[1] : '0'
    }
    case 'LID_CLOSE':
      return 'OK'
    case 'SLEEPNOW':
      await pmset('sleepnow')
      return 'OK'
    default:
      return 'ERR'
  }
}

// Remove stale socket from a previous crash.
try { fs.unlinkSync(SOCKET) } catch {}

const server = net.createServer({ allowHalfOpen: true }, (socket) => {
  let buffer = ''
  socket.setTimeout(30000)

  socket.on('data', (data) => {
    buffer += data.toString()
  })

  socket.on('end', async () => {
    const cmd = buffer.trim()
    log('command', cmd)
    try {
      const response = await handle(cmd)
      socket.write(response)
    } catch (e) {
      logError('command failed:', cmd, e.message)
      socket.write(`ERR: ${e.message}`)
    }
    socket.end()
  })

  socket.on('timeout', () => {
    log('socket timeout')
    socket.end()
  })

  socket.on('error', (err) => {
    logError('socket error:', err.message)
  })
})

server.on('error', (err) => {
  logError('server error:', err.message)
  process.exit(1)
})

server.listen(SOCKET, () => {
  log('Helper listening on', SOCKET)
})

process.on('SIGTERM', () => {
  log('Received SIGTERM, shutting down')
  server.close(() => {
    process.exit(0)
  })
})
