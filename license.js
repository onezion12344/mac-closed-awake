const crypto = require('crypto')

// Ed25519 Public Key (PEM format) — used to verify activation codes offline
const ED25519_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEARr42v/j7dceTMOv23k5KWi8cxabqAEZqpKMZa1LyG4Y=
-----END PUBLIC KEY-----`

/**
 * Verify an activation code signed by our Ed25519 private key.
 * Expected format: "MCA-{Base64URL(payload)}.{Base64URL(signature)}"
 * Payload is JSON: { email, tier, ts }
 *
 * @param {string} code - The activation code string
 * @returns {{ valid: boolean, email?: string, tier?: string, reason?: string }}
 */
function verifyActivationCode(code) {
  if (!code || typeof code !== 'string') {
    return { valid: false, reason: 'Missing activation code' }
  }

  const trimmed = code.trim()
  if (!trimmed.startsWith('MCA-')) {
    return { valid: false, reason: 'Invalid activation code format' }
  }

  const body = trimmed.slice(4) // strip "MCA-"
  const dotIndex = body.indexOf('.')
  if (dotIndex === -1) {
    return { valid: false, reason: 'Invalid activation code format' }
  }

  const payloadB64 = body.slice(0, dotIndex)
  const signatureB64 = body.slice(dotIndex + 1)

  if (!payloadB64 || !signatureB64) {
    return { valid: false, reason: 'Invalid activation code format' }
  }

  try {
    const publicKey = crypto.createPublicKey(ED25519_PUBLIC_KEY)
    const payloadBytes = Buffer.from(payloadB64, 'utf8') // signed data is the raw b64url string
    const signatureBuffer = Buffer.from(signatureB64, 'base64url')

    const isValid = crypto.verify(null, payloadBytes, publicKey, signatureBuffer)
    if (!isValid) {
      return { valid: false, reason: 'Invalid signature' }
    }

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    const { email, tier } = payload

    if (!email || !tier) {
      return { valid: false, reason: 'Missing email or tier in payload' }
    }

    return { valid: true, email, tier }
  } catch (err) {
    return { valid: false, reason: err.message || 'Verification failed' }
  }
}

module.exports = { verifyActivationCode }
