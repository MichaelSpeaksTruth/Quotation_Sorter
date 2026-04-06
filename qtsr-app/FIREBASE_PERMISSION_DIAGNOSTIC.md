# Firebase Permission Denied - Advanced Debugging Guide

## Status: Permission Issues - Diagnostic Mode Active

I've enhanced all database operations with **detailed console logging** to help identify exactly where the permission issue is occurring. Follow this guide to diagnose the problem.

---

## Step 1: Restart Dev Server with New Logging

1. **Restart the dev server** (npm run dev)
2. **Open Browser DevTools** (F12 or right-click → Inspect)
3. **Go to Console tab**
4. **Hard refresh the page** (Ctrl+Shift+R or Cmd+Shift+R)

---

## Step 2: Look for These Log Patterns

After the page loads, you should see logs like:

```
[SESSION] Reading active sessions from: sessions/users/ABC123/active
[SESSION] Active sessions read successful, exists: true
[SESSION] Raw active sessions data: {...}
[SESSION] Returning 2 active sessions
```

### If you DO see these logs → Sessions are working ✅

### If you see PERMISSION_DENIED error → Look for which operation failed

---

## Step 3: Identify the Failing Operation

Look at the console logs in order. The **first [SESSION]** or **[SECURITY]** error message shows the problem.

### Scenario A: Permission denied on getActiveSessions
```
[SESSION] Reading active sessions from: sessions/users/ABC123/active
PERMISSION_DENIED: Permission denied
[SESSION] Error code: PERMISSION_DENIED
```
**Problem:** Can't read from `sessions/users/{uid}/active`  
**Solution:** Check Firebase rules for this path

### Scenario B: Permission denied on getPastSessions
```
[SESSION] Reading from: sessions/users/ABC123/past
PERMISSION_DENIED: Permission denied
[SESSION] Error code: PERMISSION_DENIED
```
**Problem:** Can't read from `sessions/users/{uid}/past`  
**Solution:** Check Firebase rules for this path

### Scenario C: Permission denied on getLoginHistory
```
[SESSION] Reading from: audit/users/ABC123/events
PERMISSION_DENIED: Permission denied
```
**Problem:** Can't read from `audit/users/{uid}/events`  
**Solution:** Check Firebase rules for this path

### Scenario D: Permission denied on getSecuritySettings
```
[SECURITY] Reading settings from: security/users/ABC123/settings
PERMISSION_DENIED: Permission denied
```
**Problem:** Can't read from `security/users/{uid}/settings`  
**Solution:** Check Firebase rules for this path

---

## Step 4: Check Firebase Rules

Go to: https://console.firebase.google.com/project/quotation-sorter-app/database/rules

Verify these paths have proper rules:

### ✅ Should Exist (READ)
- `sessions/users/$uid/active` - **needs `.read` rule**
- `sessions/users/$uid/past` - **needs `.read` rule**
- `audit/users/$uid/events` - **needs `.read` rule**
- `security/users/$uid/settings` - **needs `.read` rule**

### Check the Exact Structure

```json
"sessions": {
  "users": {
    "$uid": {
      "active": {
        ".read": "$uid === auth.uid && auth.uid !== null",  ← MUST EXIST
        ".write": "$uid === auth.uid && auth.uid !== null",
        "$sessionId": {
          ".read": "$uid === auth.uid && auth.uid !== null",  ← MUST EXIST
          ".write": "$uid === auth.uid && auth.uid !== null"
        }
      },
      "past": {
        ".read": "$uid === auth.uid && auth.uid !== null",    ← MUST EXIST
        ".write": "$uid === auth.uid && auth.uid !== null",
        ".indexOn": ["endedAt"],
        "$sessionId": {
          ".read": "$uid === auth.uid && auth.uid !== null",  ← MUST EXIST
          ".write": "$uid === auth.uid && auth.uid !== null"
        }
      }
    }
  }
}
```

**🔴 If any of these `.read` rules are MISSING → That's the problem!**

---

## Step 5: Verify Authentication

Check that you're actually authenticated:

1. **Open Console**
2. **Type:** `firebase.auth().currentUser`
3. **Press Enter**
4. Should show user object with `uid`, `email`, etc.

### If it shows `null` → You're not authenticated!

Solution: Go back to login page and sign in properly.

### If it shows user object → You ARE authenticated

Then the issue is the Firebase rules.

---

## Step 6: Check Firebase Console Health

1. Go to https://console.firebase.google.com/project/quotation-sorter-app
2. Check **Database** section
3. Look for any warnings or errors
4. Check **Rules** tab for syntax errors
5. Usually they show as red `✗` if invalid

### If rules show errors → Fix them

---

## Step 7: Nuclear Option - Reset and Redeploy

If nothing works, try a complete reset:

```bash
# 1. Stop dev server (Ctrl+C)
# 2. Delete build cache
rm -rf .next

# 3. Redeploy Firebase rules fresh
firebase deploy --only database

# 4. Start dev server again
npm run dev
```

---

## Common Issues and Solutions

### Issue: PERMISSION_DENIED on ALL operations

**Possible Causes:**
1. User not authenticated + Check you're logged in
2. Firebase rules syntax error → Check Firebase console
3. User UID doesn't match → Log auth user to see uid
4. Database rules completely broken → Restore from backup

**Solution:**
- Verify `auth.uid !== null` in all rules
- Make sure rules have `.read: true` or proper condition
- Check that you're logged in to the app

### Issue: Database paths don't exist

Check that the exact paths in code match the rules:
- Code uses: `sessions/users/{uid}/active`
- Rules must have: `"sessions": { "users": { "$uid": { "active": ...`

If paths don't match → Update rules to match code!

### Issue: IndexOn warning

If you see warning about missing index on `endedAt`:
- Rules have `.indexOn: ["endedAt"]` ✓
- May need to deploy fresh index
- Can usually ignore warning temporarily

---

## Console Output Examples

### ✅ GOOD - Everything Works
```
[SESSION] Reading active sessions from: sessions/users/userId123/active
[SESSION] Active sessions read successful, exists: true
[SESSION] Raw active sessions data: {sessionId1: {...}, sessionId2: {...}}
[SESSION] Returning 2 active sessions

[SESSION] Fetching past sessions for user userId123...
[SESSION] Reading from: sessions/users/userId123/past
[SESSION] Basic read successful, exists: false
[SESSION] No past sessions found (node doesn't exist)
[SESSION] Returning 0 past sessions

[SESSION] Fetching login history for user userId123...
[SESSION] Reading from: audit/users/userId123/events
[SESSION] Audit read successful, exists: true
[SESSION] Raw audit data retrieved: {...}
[SESSION] Returning 5 audit events

[SECURITY] Reading settings from: security/users/userId123/settings
[SECURITY] Settings loaded successfully {...}

[HEARTBEAT] Session sessionId1 heartbeat sent
```

### ❌ BAD - Permission Denied on activeessions
```
[SESSION] Reading active sessions from: sessions/users/userId123/active
PERMISSION_DENIED: Permission denied
    at <unknown> (firebase...database_dist_index_esm...js:10233:31)
[SESSION] Error code: PERMISSION_DENIED
[SESSION] Error message: Permission denied
Error fetching active sessions

[PROFILE] Error loading profile data: Error: Permission denied
```

---

## Commands to Try

### View Current Rules
```bash
firebase database:get / --project quotation-sorter-app
```

### Redeploy Rules
```bash
firebase deploy --only database --project quotation-sorter-app
```

### Check Database Structure
Go to Firebase Console → Realtime Database → Data tab

Look for these paths:
```
├── sessions
│   └── users
│       └── {userId}
│           ├── active
│           │   └── {sessionId}
│           └── past
│               └── {sessionId}
├── audit
│   └── users
│       └── {userId}
│           └── events
│               └── {eventId}
└── security
    └── users
        └── {userId}
            └── settings
```

If any paths are missing → Create them manually as test data

---

## Next Steps

1. **Restart dev server** with new logging
2. **Take a screenshot** of the console errors
3. **Check which operation fails** (active, past, audit, or security)
4. **Verify that path has rules** in Firebase console
5. **If rules exist but still fail** → Rules might have wrong conditions
6. **If rules missing** → Add them from [FIREBASE_RULES_CONFLICT_FIX.md](FIREBASE_RULES_CONFLICT_FIX.md)

---

## Most Likely Issue

Based on the permission errors, the problem is probably:

**Missing or incorrect `.read` permission** on one of these paths:
- `sessions/users/$uid/active`
- `sessions/users/$uid/past`  
- `audit/users/$uid/events`
- `security/users/$uid/settings`

**Action:**
1. Go to Firebase Console
2. Check each path in Rules tab
3. Ensure each has: `".read": "$uid === auth.uid && auth.uid !== null"`
4. Deploy if missing
5. Restart dev server

---

## Support

After following these steps:
1. Check console for exact error location
2. Note which operation fails
3. Verify that path has rules
4. If still stuck, check `.env.local` has correct Firebase config
5. Try signing out and back in
6. Clear browser cache if needed

The detailed logging should tell you EXACTLY what's wrong! 🔍
