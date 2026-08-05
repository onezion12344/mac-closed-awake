export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
    }

    // POST /generate-license { sessionId, email }
    if (url.pathname === '/generate-license' && request.method === 'POST') {
      try {
        const body = await request.json()
        const { sessionId, email } = body

        if (!sessionId || !email) {
          return new Response(JSON.stringify({ error: 'Missing sessionId or email' }), {
            status: 400, headers: corsHeaders,
          })
        }

        // TODO: Verify Stripe session is paid
        // const stripe = new Stripe(env.STRIPE_SECRET_KEY)
        // const session = await stripe.checkout.sessions.retrieve(sessionId)
        // if (session.payment_status !== 'paid') {
        //   return new Response(JSON.stringify({ error: 'Payment not confirmed' }), { status: 402, headers: corsHeaders })
        // }

        const privateKey = env.MCA_PRIVATE_KEY
        if (!privateKey) {
          return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
            status: 500, headers: corsHeaders,
          })
        }

        const payload = JSON.stringify({ email, tier: 'lifetime', ts: Date.now() })
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
        const licenseKey = 'MCA-' + payloadB64 + '.' + signatureB64

        return new Response(JSON.stringify({
          licenseKey,
          email,
          tier: 'lifetime',
        }), { headers: corsHeaders })

      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500, headers: corsHeaders,
        })
      }
    }

    // GET /verify-license?key=<key>
    if (url.pathname === '/verify-license' && request.method === 'GET') {
      try {
        const key = url.searchParams.get('key')
        if (!key) {
          return new Response(JSON.stringify({ valid: false }), { headers: corsHeaders })
        }

        const body = key.slice(4) // strip "MCA-"
        const dotIndex = body.indexOf('.')
        if (dotIndex === -1) {
          return new Response(JSON.stringify({ valid: false }), { headers: corsHeaders })
        }

        const payloadB64 = body.slice(0, dotIndex)
        const signatureB64 = body.slice(dotIndex + 1)

        // Decode base64url
        const b64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/')
        const binary = atob(b64)
        const payload = JSON.parse(binary)

        return new Response(JSON.stringify({
          valid: true,
          email: payload.email,
          tier: payload.tier,
          ts: payload.ts,
        }), { headers: corsHeaders })

      } catch (err) {
        return new Response(JSON.stringify({ valid: false, error: err.message }), {
          headers: corsHeaders,
        })
      }
    }

    // GET /success?session_id=<cs_test_...>
    if (url.pathname === '/success' && request.method === 'GET') {
      const sessionId = url.searchParams.get('session_id')
      if (!sessionId) {
        return new Response('Missing session_id', { status: 400 })
      }

      const html = successPageHtml(sessionId)
      return new Response(html, { headers: { 'Content-Type': 'text/html' } })
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404, headers: corsHeaders,
    })
  },
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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
    '    var email = params.get("email") || "";\n' +
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
    '      body: JSON.stringify({ sessionId: sessionId, email: email })\n' +
    '    })\n' +
    '    .then(function(r) { return r.json(); })\n' +
    '    .then(function(data) {\n' +
    '      if (data.licenseKey) {\n' +
    '        var keyDiv = document.createElement("div");\n' +
    '        keyDiv.className = "key-box";\n' +
    '        keyDiv.textContent = data.licenseKey;\n' +
    '        var btn = document.createElement("button");\n' +
    '        btn.className = "btn";\n' +
    '        btn.textContent = "Copy Key";\n' +
    '        btn.onclick = function() {\n' +
    '          navigator.clipboard.writeText(data.licenseKey);\n' +
    '          btn.textContent = "Copied!";\n' +
    '        };\n' +
    '        keyArea.innerHTML = "";\n' +
    '        keyArea.appendChild(keyDiv);\n' +
    '        keyArea.appendChild(btn);\n' +
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
