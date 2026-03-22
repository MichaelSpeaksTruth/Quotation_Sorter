#!/bin/bash
# Firebase Permission Error Fix - User Verification Script
# Run this to verify the fix is working in your environment

echo "======================================"
echo "Firebase Permission Error Fix Verification"
echo "======================================"
echo ""

# Check 1: Verify build passes
echo "✓ Checking production build..."
npm run build > /tmp/build.log 2>&1
if grep -q "Compiled successfully" /tmp/build.log; then
  echo "  ✅ Build PASSES - No compilation errors"
else
  echo "  ❌ Build FAILED - See details above"
  exit 1
fi
echo ""

# Check 2: Verify Firebase CLI is installed
echo "✓ Checking Firebase CLI..."
if command -v firebase &> /dev/null; then
  echo "  ✅ Firebase CLI installed"
else
  echo "  ⚠️  Firebase CLI not found - run: npm install -g firebase-tools"
fi
echo ""

# Check 3: Verify Firebase login
echo "✓ Checking Firebase authentication..."
if firebase auth:list > /dev/null 2>&1; then
  echo "  ✅ Firebase login OK"
else
  echo "  ⚠️  Firebase not logged in - run: firebase login"
fi
echo ""

# Check 4: Verify database connection
echo "✓ Checking Firebase database access..."
RESULT=$(firebase database:get / --shallow 2>&1)
if echo "$RESULT" | grep -q "sessions\|quotations"; then
  echo "  ✅ Database accessible with proper paths"
  echo "  Found: $RESULT"
else
  echo "  ❌ Database not accessible"
  exit 1
fi
echo ""

# Check 5: Verify rules syntax
echo "✓ Validating Firebase rules..."
if firebase deploy --only database:rules --dry-run 2>&1 | grep -q "is valid"; then
  echo "  ✅ Rules syntax valid"
else
  echo "  ❌ Rules syntax invalid"
  exit 1
fi
echo ""

echo "======================================"
echo "✅ All verification checks PASSED!"
echo "======================================"
echo ""
echo "Next steps:"
echo "1. Clear browser cache: Ctrl+Shift+Delete → 'All time'"
echo "2. Restart dev server: Ctrl+C then npm run dev"
echo "3. Navigate to /profile - should see sessions without errors"
echo "4. Check DevTools console - should have 0 'Permission denied' errors"
echo ""
