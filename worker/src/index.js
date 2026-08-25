/**
 * MacClosedAwake — license fulfillment Worker.
 *
 * Routes:
 *   GET  /health                  → { ok: true }
 *   GET  /verify-license?key=…    → public key verification (no secret needed)
 *   POST /generate-license        → { sessionId } after Stripe Checkout success
 *   POST /admin/mint              → { email, tier } with ADMIN_TOKEN (manual keys)
 *   GET  /success?session_id=…    → HTML page that POSTs /generate-license
 *
 * Secrets (wrangler secret put):
 *   MCA_PRIVATE_KEY   — Ed25519 private key (PKCS8 PEM, one line)
 *   STRIPE_SECRET_KEY — Stripe secret key used to confirm the Checkout session
 *   ADMIN_TOKEN       — shared secret for /admin/mint
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Content-Type': 'application/json',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
    }

    // GET /verify-license?key=…  — signature check only (public key embedded)
    if (url.pathname === '/verify-license' && request.method === 'GET') {
      try {
        const key = url.searchParams.get('key')
        if (!key) return new Response(JSON.stringify({ valid: false }), { headers: corsHeaders })
        const parsed = parseKey(key)
        if (!parsed) return new Response(JSON.stringify({ valid: false }), { headers: corsHeaders })
        return new Response(JSON.stringify({ valid: true, email: parsed.email, tier: parsed.tier, ts: parsed.ts }), { headers: corsHeaders })
      } catch (err) {
        return new Response(JSON.stringify({ valid: false, error: err.message }), { headers: corsHeaders })
      }
    }

    // POST /generate-license — called from the success page after Stripe Checkout.
    // Verifies the session is actually paid, then mints the key.
    if (url.pathname === '/generate-license' && request.method === 'POST') {
      try {
        const body = await request.json()
        const { sessionId } = body
        if (!sessionId) {
          return new Response(JSON.stringify({ error: 'Missing sessionId' }), { status: 400, headers: corsHeaders })
        }

        // Confirm with Stripe that this session was really paid.
        const session = await stripeRetrieve(env, sessionId)
        if (!session || session.payment_status !== 'paid') {
          return new Response(JSON.stringify({ error: 'Payment not confirmed' }), { status: 402, headers: corsHeaders })
        }

        // Email comes from the customer object, not a query param the user can fake.
        const email = (session.customer_details && session.customer_details.email) || ''
        if (!email) {
          return new Response(JSON.stringify({ error: 'No email on Stripe session' }), { status: 400, headers: corsHeaders })
        }

        // How many codes did they buy? A normal Lifetime link has quantity 1;
        // the "friend 2-pack" link sets quantity 2 and mints two keys.
        const lineItems = (session.line_items && session.line_items.data) || []
        const quantity = lineItems.reduce((sum, li) => sum + (li.quantity || 1), 0) || 1
        const count = Math.min(quantity, 10) // sanity cap

        const licenseKeys = []
        for (let i = 0; i < count; i++) {
          licenseKeys.push(await mintKey(env, { email, tier: 'lifetime', seq: i }))
        }

        return new Response(
          JSON.stringify({ licenseKeys, email, tier: 'lifetime', count }),
          { headers: corsHeaders }
        )
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders })
      }
    }

    // POST /admin/mint — manual key issuance (owner only). Send:
    //   { "email": "you@x.com", "tier": "lifetime" }
    // with header  Authorization: Bearer <ADMIN_TOKEN>
    if (url.pathname === '/admin/mint' && request.method === 'POST') {
      const auth = request.headers.get('Authorization') || ''
      if (auth !== `Bearer ${env.ADMIN_TOKEN}`) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
      }
      try {
        const body = await request.json()
        const { email, tier = 'lifetime' } = body
        if (!email || !email.includes('@')) {
          return new Response(JSON.stringify({ error: 'Invalid email' }), { status: 400, headers: corsHeaders })
        }
        const licenseKey = await mintKey(env, { email, tier })
        return new Response(JSON.stringify({ licenseKey, email, tier }), { headers: corsHeaders })
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders })
      }
    }

    // GET /success?session_id=… — payment-success landing page
    if (url.pathname === '/success' && request.method === 'GET') {
      const sessionId = url.searchParams.get('session_id')
      if (!sessionId) return new Response('Missing session_id', { status: 400 })
      return new Response(successPageHtml(sessionId), { headers: { 'Content-Type': 'text/html' } })
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: corsHeaders })
  },
}

// ─── Stripe ──────────────────────────────────────────────────────────────────

async function stripeRetrieve(env, sessionId) {
  const res = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}` +
      `?expand[]=line_items`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Stripe API ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

// ─── Key minting ─────────────────────────────────────────────────────────────

// seq keeps two keys minted in the same millisecond distinct — the "2-pack"
// friend deal must hand out two different codes.
async function mintKey(env, { email, tier, seq }) {
  const privateKey = env.MCA_PRIVATE_KEY
  if (!privateKey) throw new Error('Server misconfigured (missing MCA_PRIVATE_KEY)')

  const payload = JSON.stringify({ email, tier, ts: Date.now(), seq: seq || 0 })
  const payloadB64 = btoa(payload)
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

  const privateKeyCrypto = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKey),
    { name: 'Ed25519' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign(
    'Ed25519',
    privateKeyCrypto,
    new TextEncoder().encode(payloadB64)
  )

  const signatureB64 = arrayBufferToBase64Url(signature)
  return 'MCA-' + payloadB64 + '.' + signatureB64
}

// ─── Key parsing (shared by /verify-license) ─────────────────────────────────

function parseKey(key) {
  if (!key.startsWith('MCA-')) return null
  const body = key.slice(4)
  const dotIndex = body.indexOf('.')
  if (dotIndex === -1) return null
  const payloadB64 = body.slice(0, dotIndex)
  const signatureB64 = body.slice(dotIndex + 1)
  if (!payloadB64 || !signatureB64) return null

  const b64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(b64)
  const payload = JSON.parse(binary)
  return { email: payload.email, tier: payload.tier, ts: payload.ts }
}

// ─── Crypto helpers ──────────────────────────────────────────────────────────

function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function arrayBufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

// ─── Success page ────────────────────────────────────────────────────────────

function successPageHtml(sessionId) {
  return '<!DOCTYPE html>\n' +
    '<html lang="en">\n' +
    '<head>\n' +
    '<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    '<title>MacClosedAwake - Activate</title>\n' +
    '<style>\n' +
    '  body { font-family: -apple-system, "SF Pro", "PingFang SC", sans-serif; background: #0d1b2a; color: #f5eeda; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }\n' +
    '  .card { background: #162236; border: 1px solid #1e3050; border-radius: 18px; padding: 40px; max-width: 420px; width: 90%; text-align: center; }\n' +
    '  h1 { font-size: 20px; margin-bottom: 8px; }\n' +
    '  .emoji { font-size: 40px; margin-bottom: 12px; }\n' +
    '  p { color: #8a9ab0; font-size: 13px; line-height: 1.6; margin-bottom: 20px; }\n' +
    '  .key-box { background: #0d1b2a; border: 1px solid #1e3050; border-radius: 10px; padding: 14px; font-family: "SF Mono", monospace; font-size: 13px; word-break: break-all; color: #3a8a8a; margin-bottom: 16px; user-select: all; }\n' +
    '  .btn { display: inline-block; padding: 12px 24px; border-radius: 10px; border: none; background: linear-gradient(135deg, #f0c04a, #e8935a); color: #0d1b2a; font-weight: 600; font-size: 14px; cursor: pointer; }\n' +
    '  .btn:hover { opacity: 0.9; }\n' +
    '  .spinner { display: inline-block; width: 20px; height: 20px; border: 2px solid #1e3050; border-top-color: #3a8a8a; border-radius: 50%; animation: spin 0.8s linear infinite; vertical-align: middle; margin-right: 8px; }\n' +
    '  @keyframes spin { to { transform: rotate(360deg); } }\n' +
    '</style>\n' +
    '</head>\n' +
    '<body>\n' +
    '<div class="card">\n' +
    '  <div class="emoji">&#x2714;</div>\n' +
    '  <h1>Payment Confirmed!</h1>\n' +
    '  <p>Your license key will appear below. Copy it into MacClosedAwake to activate Pro.</p>\n' +
    '  <div id="keyArea"><div class="spinner"></div> Generating your license key...</div>\n' +
    '  <div id="error" style="color:#e8935a;font-size:12px;margin-top:12px;display:none"></div>\n' +
    '</div>\n' +
    '<script>\n' +
    '  (function() {\n' +
    '    var params = new URLSearchParams(location.search);\n' +
    '    var sessionId = params.get("session_id");\n' +
    '    var keyArea = document.getElementById("keyArea");\n' +
    '    var errEl = document.getElementById("error");\n' +
    '\n' +
    '    if (!sessionId) {\n' +
    '      keyArea.innerHTML = "<p style=color:#e8935a>Missing payment session. Contact support.</p>";\n' +
    '      return;\n' +
    '    }\n' +
    '\n' +
    '    fetch("/generate-license", {\n' +
    '      method: "POST",\n' +
    '      headers: { "Content-Type": "application/json" },\n' +
    '      body: JSON.stringify({ sessionId: sessionId })\n' +
    '    })\n' +
    '    .then(function(r) { return r.json(); })\n' +
    '    .then(function(data) {\n' +
    '      var keys = data.licenseKeys || (data.licenseKey ? [data.licenseKey] : []);\n' +
    '      if (keys.length) {\n' +
    '        keyArea.innerHTML = "";\n' +
    '        keys.forEach(function(key, i) {\n' +
    '          if (keys.length > 1) {\n' +
    '            var who = document.createElement("p");\n' +
    '            who.textContent = (i === 0 ? "Yours" : "For your friend") + " — code " + (i + 1) + " of " + keys.length;\n' +
    '            who.style.cssText = "color:#8a9ab0;font-size:12px;margin:8px 0 4px;";\n' +
    '            keyArea.appendChild(who);\n' +
    '          }\n' +
    '          var keyDiv = document.createElement("div");\n' +
    '          keyDiv.className = "key-box";\n' +
    '          keyDiv.textContent = key;\n' +
    '          var btn = document.createElement("button");\n' +
    '          btn.className = "btn";\n' +
    '          btn.textContent = "Copy";\n' +
    '          btn.onclick = function() {\n' +
    '            navigator.clipboard.writeText(key);\n' +
    '            btn.textContent = "Copied!";\n' +
    '          };\n' +
    '          var row = document.createElement("div");\n' +
    '          row.appendChild(keyDiv);\n' +
    '          row.appendChild(btn);\n' +
    '          keyArea.appendChild(row);\n' +
    '        });\n' +
    '      } else {\n' +
    '        errEl.style.display = "block";\n' +
    '        errEl.textContent = data.error || "Failed to generate key";\n' +
    '      }\n' +
    '    })\n' +
    '    .catch(function(e) {\n' +
    '      errEl.style.display = "block";\n' +
    '      errEl.textContent = "Network error: " + e.message;\n' +
    '    });\n' +
    '  })();\n' +
    '</script>\n' +
    '</body>\n' +
    '</html>'
}
