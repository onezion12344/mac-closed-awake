#!/usr/bin/env node
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

// ── CLI arg helpers ──────────────────────────────────────────────────────────
function hasFlag(flag) {
  return process.argv.includes(flag)
}

function getArg(flag) {
  const idx = process.argv.indexOf(flag)
  return idx !== -1 ? process.argv[idx + 1] : undefined
}

// ── Simple .env file loader (supports multi-line values) ─────────────────────
function loadDotenv() {
  const envPath = path.join(__dirname, '..', '.env')
  if (!fs.existsSync(envPath)) return
  const content = fs.readFileSync(envPath, 'utf8')
  const lines = content.split('\n')
  let currentKey = null
  let currentValue = []
  
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    
    // Detect new key=value start or continuation
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) {
      if (currentKey !== null && !trimmed.startsWith('"') && !trimmed.endsWith('"')) {
        // This is a continuation line
        currentValue.push(trimmed)
      }
      continue
    }
    
    // Save previous key-value pair
    if (currentKey !== null) {
      const fullValue = currentValue.length > 0 ? currentValue.join('\n') : trimmed.slice(eqIdx + 1).trim().replace(/^['"]|[']"$/g, '')
      if (!process.env[currentKey]) process.env[currentKey] = fullValue
    }
    
    // Start new key-value pair
    currentKey = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim()
    currentValue = []
    
    // Handle inline start of multi-line or single-line value
    if (!val.startsWith('|') && !val.startsWith('"') && !val.startsWith("'")) {
      // Single-line value
      if (!process.env[currentKey]) process.env[currentKey] = val
      currentKey = null
    } else if (val.startsWith('|')) {
      // YAML-style multi-line (lines start with spaces)
      currentKey = currentKey
    } else {
      // Quoted string
      const innerVal = val.replace(/^['"]|['"]$/g, '')
      if (innerVal.includes('\\n')) {
        if (!process.env[currentKey]) process.env[currentKey] = innerVal.replace(/\\n/g, '\n')
      } else {
        if (!process.env[currentKey]) process.env[currentKey] = innerVal
      }
      currentKey = null
    }
  }
  
  // Don't forget the last pair
  if (currentKey !== null) {
    const finalVal = currentValue.length > 0 ? currentValue.join('\n') : ''
    if (!process.env[currentKey]) process.env[currentKey] = finalVal
  }
}

// ── --init: generate a fresh Ed25519 keypair ─────────────────────────────────
if (hasFlag('--init')) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')

  const pubPem = publicKey.export({ type: 'spki', format: 'pem' })
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' })

  console.log('\n── Ed25519 Public Key (paste into license.js) ──')
  console.log(pubPem)
  console.log('── Ed25519 Private Key (store in ED25519_PRIVATE_KEY env var) ──')
  console.log(privPem)
  console.log('Store the private key securely. Never commit it to the repo.\n')
  process.exit(0)
}

// ── Code generation mode ─────────────────────────────────────────────────────
const email = getArg('--email')
const tier = getArg('--tier')

if (!email || !tier) {
  console.error('Usage: generate-activation.js --email <email> --tier <lifetime|monthly|updates>')
  console.error('       generate-activation.js --init   (generate new keypair)')
  process.exit(1)
}

const VALID_TIERS = ['lifetime', 'monthly', 'updates']
if (!VALID_TIERS.includes(tier)) {
  console.error(`Invalid tier "${tier}". Must be one of: ${VALID_TIERS.join(', ')}`)
  process.exit(1)
}

loadDotenv()

const privKeyPem = process.env.ED25519_PRIVATE_KEY
if (!privKeyPem) {
  console.error('ED25519_PRIVATE_KEY environment variable is not set.')
  console.error('Run with --init first, then export the private key.')
  process.exit(1)
}

const privateKey = crypto.createPrivateKey(privKeyPem)

const payload = JSON.stringify({ email, tier, ts: Date.now() })
const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url')

const signature = crypto.sign(null, Buffer.from(payloadB64, 'utf8'), privateKey)
const signatureB64 = signature.toString('base64url')

const code = `MCA-${payloadB64}.${signatureB64}`
console.log(code)
