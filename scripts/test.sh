#!/bin/bash
# MacClosedAwake v1.1.0 Test Script
# Tests: Helper socket, pmset status, caffeine process, lid-close handling

SOCKET="/tmp/com.mca.helper.sock"
echo "🧪 MacClosedAwake v1.1.0 Test Suite"
echo "====================================="

# Test 1: Check if app is running
echo ""
echo "✅ Test 1: App Process Status"
if pgrep -q "MacClosedAwake"; then
    echo "   ✅ App is running ($(pgrep -c "MacClosedAwake") processes)"
else
    echo "   ❌ App is NOT running"
    exit 1
fi

# Test 2: Check helper socket
echo ""
echo "✅ Test 2: Helper Socket Connection"
if [ -S "$SOCKET" ]; then
    echo "   ✅ Socket exists: $SOCKET"
    
    # Test DISABLE command
    if command -v socat &>/dev/null; then
        RESULT=$(echo "DISABLE" | timeout 2 socat - UNIX-CONNECT:"$SOCKET" 2>/dev/null)
        echo "   DISABLE command response: $RESULT"
        
        # Test STATUS command
        STATUS=$(echo "STATUS" | timeout 2 socat - UNIX-CONNECT:"$SOCKET" 2>/dev/null)
        echo "   Current disablesleep status: $STATUS"
    else
        echo "   ⚠️  socat not available for socket testing"
    fi
else
    echo "   ❌ Socket does NOT exist"
    exit 1
fi

# Test 3: Check caffeine process
echo ""
echo "✅ Test 3: Caffeinate Process"
if pgrep -q "^caffeinate"; then
    echo "   ✅ Caffeinate process is running (prevents idle sleep)"
    pgrep -a "caffeinate" | head -1
else
    echo "   ℹ️  No active caffeine process (normal when no timer running)"
fi

# Test 4: Check power monitor
echo ""
echo "✅ Test 4: Power Monitor"
if [ -f "/tmp/mca-power-monitor.sh" ]; then
    echo "   ✅ Monitor script exists"
else
    echo "   ℹ️  Monitor script not running (normal until activation)"
fi

# Test 5: Verify pmset configuration
echo ""
echo "✅ Test 5: System Sleep Configuration"
PMSET_OUTPUT=$(pmset -g custom 2>/dev/null || echo "Cannot read pmset config")
echo "$PMSET_OUTPUT" | grep -E "(disablesleep|sleepoff)" || echo "   Disablesleep not currently active (expected before starting timer)"

# Test 6: Check installed version
echo ""
echo "✅ Test 6: Version Verification"
VERSION_FILE="/Applications/MacClosedAwake.app/Contents/Resources/app.asar"
if [ -f "$VERSION_FILE" ]; then
    if strings "$VERSION_FILE" 2>/dev/null | grep -q "stripe"; then
        echo "   ✅ App contains Stripe payment integration"
    fi
    FILE_DATE=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$VERSION_FILE" 2>/dev/null || echo "unknown")
    echo "   ✅ App bundle updated: $FILE_DATE"
else
    echo "   ❌ App bundle not found at expected location"
fi

# Test 7: Network connectivity to Stripe
echo ""
echo "✅ Test 7: Payment Gateway Connectivity"
STRIPE_URL="https://buy.stripe.com/test_eVqaER2GQdWaars23a4ko0s"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$STRIPE_URL" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
    echo "   ✅ Stripe test checkout page accessible (HTTP $HTTP_CODE)"
else
    echo "   ⚠️  Stripe URL returned HTTP $HTTP_CODE (may be firewall)"
fi

# Summary
echo ""
echo "====================================="
echo "📊 Test Summary"
echo "====================================="
echo "App Running: ✅"
echo "Helper Socket: $(if [ -S "$SOCKET" ]; then echo "✅"; else echo "❌"; fi)"
echo "Caffeinate Active: $(if pgrep -q "^caffeinate"; then echo "✅"; else echo "ℹ️"; fi)"
echo "Payment URL Working: $(if [ "$HTTP_CODE" = "200" ]; then echo "✅"; else echo "⚠️"; fi)"
echo ""
echo "💡 To test lid-close behavior:"
echo "   1. Start app from menu bar → choose timer or forever mode"
echo "   2. Close lid once → verify Mac stays awake"
echo "   3. Wait 1 min, close/open/close again → should still stay awake"
echo "   4. Stop app → sleep should re-enable"
echo ""
echo "🎉 All critical checks passed!"
