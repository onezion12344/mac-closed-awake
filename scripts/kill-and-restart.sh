#!/bin/bash
# Kill all MacClosedAwake processes cleanly

echo "🗑️  Killing all MacClosedAwake instances..."

# Stop app processes
pkill -f "MacClosedAwake" 2>/dev/null || true

# Stop helper daemon  
pkill lidar-helper 2>/dev/null || true

# Clean up socket
rm -f /tmp/com.mca.helper.sock

# Clean up monitor script
rm -f /tmp/mca-power-monitor.sh
rm -f /tmp/mca.lidevent*

sleep 2

echo "✅ All MacClosedAwake instances stopped"
echo ""
echo "To restart:"
echo "  open /Applications/MacClosedAwake.app"
echo ""
