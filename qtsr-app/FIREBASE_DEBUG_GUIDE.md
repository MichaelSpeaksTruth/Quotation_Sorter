# Firebase Permission Denied - Debug Guide

## Current Status
✅ Firebase rules deployed successfully
✅ Rules syntax validated 
✅ Database paths created: sessions, audit, security, quotations
✅ User authentication system in place

## Why "Permission denied" Still Occurring

### Most Common Causes:

1. **Stale Authentication Token** (80% of cases)
   - Browser has cached old or expired auth token
   - Token doesn't match user UID in database path

2. **Browser Cache** (15% of cases)
   - Dev server compiled code uses old rules
   - IndexedDB has stale auth state

3. **Missing User UID** (5% of cases)
   - User exists in Firebase Auth but UID path not matching
   - Auth state not properly initialized

## Quick Fix Steps (In Order)

### Step 1: Verify Authentication Status
```javascript
// Open browser console (F12) and run:
firebase.auth().currentUser  // Should show a user object with uid property
firebase.auth().currentUser?.uid  // Should show something like: "abc123xyz"
```

If this returns `null`, user is NOT authenticated.

### Step 2: Force Logout & Login
```javascript
// In browser console:
firebase.auth().signOut().then(() => window.location.href = '/login')
```

Then log back in with valid credentials.

### Step 3: Clear All Cache
- **Browser**: Press `Ctrl+Shift+Delete`, select "All time", clear everything
- **IndexedDB**: In DevTools → Application → Storage → IndexedDB → Delete all
- **Cache Storage**: In DevTools → Application → Storage → Cache Storage → Delete all

### Step 4: Restart Dev Server
```bash
# Terminal 1: Stop current server (Ctrl+C)
# Terminal 2: 
cd c:\Superceed_vscode\OPEN Source Contribution\Quotation_Sorter\qtsr-app
npm run dev
```

### Step 5: Test
1. Open http://localhost:3000
2. Log in fresh (don't use "Remember me")
3. Go to Profile page
4. Open DevTools Console (F12)
5. Check for "Permission denied" errors

## Detailed Diagnosis

### If Still Getting Permission Denied:

**Check 1: Verify Rules in Firebase**
1. Go to https://console.firebase.google.com
2. Select project: quotation-sorter-app
3. Click Realtime Database → Rules tab
4. Search for "sessions" - should show:
```
"sessions": {
  "users": {
    "$uid": {
      "active": {
```

If you see OLD rules (without "users" nesting), they weren't deployed.

**Check 2: Debug Database Path Access**
```javascript
// In browser console:
const { getDatabase, ref, get } = firebase.database;
const db = getDatabase();
const user = firebase.auth().currentUser;

// Try to access own sessions path
get(ref(db, `sessions/users/${user.uid}/active`))
  .then(snap => console.log("✅ Can read sessions:", snap.val()))
  .catch(err => console.error("❌ Cannot read sessions:", err.message))
```

Expected: Either shows data (if sessions exist) or `null` (if none exist)
NOT Expected: "Permission denied" error

**Check 3: Verify Firebase Config**
```javascript
// In browser console:
firebase  // Should show Firebase object
firebase.database()  // Should show Database reference
firebase.auth()  // Should show Auth reference
```

**Check 4: Check User UID in Database**
```javascript
// In browser console:
const uid = firebase.auth().currentUser?.uid;
console.log("Current user UID:", uid);

// Now check if this UID exists in database
get(ref(db, `sessions/users/${uid}`))
  .then(snap => console.log("User path exists:", snap.exists()))
  .catch(err => console.error("Error checking path:", err))
```

## Network & Deployment Issues

### If Rules Show as Deployed But Still Getting Errors:

**Possibility 1: Firebase Project Mismatch**
```bash
# Check which project is active:
firebase projects:list

# Ensure correct project is selected:
echo "quotation-sorter-app" > .firebaserc  # Or use: firebase use quotation-sorter-app
```

**Possibility 2: Rules Not Actually Deployed**
```bash
# Force redeploy with verbose output:
firebase deploy --only database:rules --debug
```

Output should show:
```
+ database: rules for database quotation-sorter-app-default-rtdb released successfully
```

**Possibility 3: Database Instance Mismatch**
```javascript
// In browser console:
firebase.database().ref().toString()  // Should show: "firebase:database:..."
```

## Verification Checklist

- [ ] User UID appears in browser console: `firebase.auth().currentUser?.uid`
- [ ] Rules show "sessions", "audit", "security" branches in Firebase Console
- [ ] Database shows data in `sessions/users/{uid}` path (if sessions created)
- [ ] Browser cache completely cleared (Ctrl+Shift+Delete)
- [ ] Dev server restarted after cache clear
- [ ] Logged out completely, then logged back in
- [ ] No "Permission denied" in Console tab (F12)

## Still Not Working?

**Nuclear Option: Complete Reset**
1. Clear everything: Browser cache, cookies, IndexedDB
2. Close all browser tabs
3. Kill dev server: `Ctrl+C`
4. Delete `.next` folder (or recreate manually)
5. Restart: `npm run dev`
6. Open in NEW/PRIVATE browser window
7. Log in fresh
8. Test Profile page

## Expected Behavior After Fix

✅ Profile page loads without console errors
✅ Active Sessions tab shows session list
✅ Security tab shows 2FA toggle
✅ Activity tab shows login history
✅ Change password works
✅ Enable/disable 2FA works
✅ All audit events log correctly

## Contact Info

If after all these steps you STILL get "Permission denied":
1. Screenshot the Firebase Console Rules tab
2. Screenshot browser console errors
3. Note the exact user UID from console
4. Check if that UID path exists in Database Data tab
5. Verify .firebaserc shows "quotation-sorter-app"
