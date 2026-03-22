#!/bin/bash
# Deploy Firebase Realtime Database Rules

echo "🔧 Deploying Firebase Realtime Database Rules..."
echo ""
echo "Prerequisites:"
echo "✓ Firebase CLI installed: npm install -g firebase-tools"
echo "✓ Logged in to Firebase: firebase login"
echo ""

# Check if firebase CLI is installed
if ! command -v firebase &> /dev/null; then
    echo "❌ Firebase CLI not found. Install it first:"
    echo "   npm install -g firebase-tools"
    exit 1
fi

# Check if .firebaserc exists (project configured)
if [ ! -f ".firebaserc" ]; then
    echo "❌ .firebaserc not found. Run:"
    echo "   firebase init"
    exit 1
fi

# Deploy rules
echo "📤 Deploying rules from firebase-rtdb-rules.json..."
firebase deploy --only database:rules

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Rules deployed successfully!"
    echo ""
    echo "Next steps:"
    echo "1. Go to your Profile page in the app"
    echo "2. Check if 'Permission denied' errors are gone"
    echo "3. Verify active sessions appear"
    echo "4. Test 2FA enable/disable"
else
    echo ""
    echo "❌ Deployment failed. Check the error above."
    echo "Make sure you're logged in: firebase login"
fi
