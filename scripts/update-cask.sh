#!/bin/bash
# Update Homebrew cask formula with new version + SHA256
# Usage: ./scripts/update-cask.sh 1.0.0 <sha256>

set -e

VERSION="$1"
SHA256="$2"

if [ -z "$VERSION" ] || [ -z "$SHA256" ]; then
  echo "Usage: $0 <version> <sha256>"
  echo "Example: $0 1.0.0 abc123..."
  exit 1
fi

CASK_FILE="cask/mac-closed-awake.rb"

# Update version
sed -i '' "s/version \".*\"/version \"$VERSION\"/" "$CASK_FILE"

# Update sha256
sed -i '' "s/sha256 \".*\"/sha256 \"$SHA256\"/" "$CASK_FILE"

echo "✅ Updated cask to v$VERSION (sha256: $SHA256)"
echo ""
echo "Next steps:"
echo "1. Fork homebrew-cask (if not already)"
echo "2. Copy $CASK_FILE to your tap"
echo "3. Submit PR or use your own tap"
echo ""
echo "Or use your own tap:"
echo "  brew tap onezion12344/mac-closed-awake"
echo "  brew install --cask mac-closed-awake"
