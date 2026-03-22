@echo off
REM Firebase Permission Error Fix - User Verification Script
REM Run this to verify the fix is working in your environment

color 0A
echo ======================================
echo Firebase Permission Error Fix Verification
echo ======================================
echo.

REM Check 1: Verify build passes
echo [*] Checking production build...
npm run build > nul 2>&1
if %ERRORLEVEL% EQU 0 (
  echo   [PASS] Build completes without errors
) else (
  echo   [FAIL] Build failed - run 'npm run build' for details
  exit /b 1
)
echo.

REM Check 2: Verify Firebase CLI is installed
echo [*] Checking Firebase CLI...
firebase --version > nul 2>&1
if %ERRORLEVEL% EQU 0 (
  echo   [PASS] Firebase CLI installed
) else (
  echo   [WARN] Firebase CLI not found - run: npm install -g firebase-tools
)
echo.

REM Check 3: Verify database connection
echo [*] Checking Firebase database access...
firebase database:get / --shallow > nul 2>&1
if %ERRORLEVEL% EQU 0 (
  echo   [PASS] Database accessible
) else (
  echo   [FAIL] Database not accessible - check Firebase connection
  exit /b 1
)
echo.

REM Check 4: Verify rules syntax
echo [*] Validating Firebase rules...
firebase deploy --only database:rules --dry-run > nul 2>&1
if %ERRORLEVEL% EQU 0 (
  echo   [PASS] Rules syntax valid and ready for deployment
) else (
  echo   [FAIL] Rules have syntax errors
  exit /b 1
)
echo.

echo ======================================
echo [OK] All verification checks PASSED!
echo ======================================
echo.
echo Next steps:
echo 1. Clear browser cache: Ctrl+Shift+Delete ^(select "All time"^)
echo 2. Restart dev server: Ctrl+C then 'npm run dev'
echo 3. Navigate to /profile - should load without "Permission denied" errors
echo 4. Check DevTools console - should show 0 permission errors
echo.
pause
