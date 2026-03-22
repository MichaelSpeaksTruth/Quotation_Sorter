@echo off
REM Deploy Firebase Realtime Database Rules

echo.
echo 🔧 Deploying Firebase Realtime Database Rules...
echo.
echo Prerequisites:
echo ✓ Firebase CLI installed: npm install -g firebase-tools
echo ✓ Logged in to Firebase: firebase login
echo.

REM Check if firebase CLI is installed
firebase --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Firebase CLI not found. Install it first:
    echo    npm install -g firebase-tools
    pause
    exit /b 1
)

REM Check if .firebaserc exists
if not exist ".firebaserc" (
    echo ❌ .firebaserc not found. Run:
    echo    firebase init
    pause
    exit /b 1
)

REM Deploy rules
echo 📤 Deploying rules from firebase-rtdb-rules.json...
echo.
firebase deploy --only database:rules

if %errorlevel% equ 0 (
    echo.
    echo ✅ Rules deployed successfully!
    echo.
    echo Next steps:
    echo 1. Go to your Profile page in the app
    echo 2. Check if 'Permission denied' errors are gone
    echo 3. Verify active sessions appear
    echo 4. Test 2FA enable/disable
) else (
    echo.
    echo ❌ Deployment failed. Check the error above.
    echo Make sure you're logged in: firebase login
)

pause
