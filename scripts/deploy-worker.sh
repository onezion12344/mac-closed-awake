#!/bin/bash
# Deploy the MacClosedAwake license Worker to Cloudflare.
#
# One-time setup (run interactively once):
#   1. cd worker && npx wrangler login          # browser auth
#   2. stripe login                              # Stripe CLI auth (get sk_live_*)
#   3. Create a real (live) Payment Link in the Stripe dashboard.
#
# Then run:  bash scripts/deploy-worker.sh
set -euo pipefail

cd "$(dirname "$0")/../worker"

echo "==> 1/3 Setting secrets on mca-license worker"
# Prompts for each secret. Use a heredoc to feed values non-interactively if desired.
for secret in MCA_PRIVATE_KEY STRIPE_SECRET_KEY ADMIN_TOKEN; do
  if ! npx wrangler secret list | grep -q "$secret"; then
    echo "--- Setting secret: $secret"
    npx wrangler secret put "$secret"
  else
    echo "--- Secret $secret already set, skipping (use 'wrangler secret put $secret' to rotate)"
  fi
done

echo "==> 2/3 Deploying worker"
npx wrangler deploy

echo "==> 3/3 Smoke test"
sleep 2
curl -s https://mca-license.onezion.workers.dev/health
echo
echo "✅ Done. Verify:"
echo "   curl 'https://mca-license.onezion.workers.dev/verify-license?key=MCA-...'"
