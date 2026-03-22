# Firebase RTDB Rules Deployment Guide

## ⚠️ CRITICAL: Rules Must Be Deployed for Session, Security, and Audit Features

### Steps to Deploy Rules:

1. **Open Firebase Console**
   - Go to https://console.firebase.google.com
   - Select your project: `quotation-sorter-app`

2. **Navigate to Realtime Database Rules**
   - Click **Realtime Database** from the left menu
   - Click the **Rules** tab (next to Data)

3. **Copy and Paste Updated Rules**
   - Open this file in your editor: `/firebase-rtdb-rules.json`
   - Copy ALL the content
   - Paste it into the Firebase Console Rules editor (replace everything)

4. **Publish Rules**
   - Click the **Publish** button (top right)
   - Wait for confirmation: "Rules published successfully"

### What Changed:

**Session Management Rules** ✅
- Path: `sessions/users/{uid}/active/{sessionId}`
- Allows authenticated users to create and manage their own sessions
- Required for: Session tracking, device detection, logout functionality

**Audit Trail Rules** ✅
- Path: `audit/users/{uid}/events/{eventId}`
- Allows authenticated users to log their security events
- Required for: Login history, security event tracking, password change audit

**Security Settings Rules** ✅
- Path: `security/users/{uid}/settings`
- Allows authenticated users to manage their 2FA and security settings
- Required for: 2FA enable/disable, backup codes, security event tracking

**Existing Quotations Rules** ✅
- Path: `quotations/{uid}/{sessionId}/{quoteId}`
- Unchanged functionality for quotation analysis

### Verification: After Publishing Rules

1. **Test Session Creation:**
   - Go to Profile page
   - Verify active sessions appear without "Permission denied" errors

2. **Test 2FA:**
   - Go to Profile > Security tab
   - Try enabling 2FA
   - Verify backup codes display

3. **Test Audit Trail:**
   - Go to Profile > Activity tab
   - Verify login history appears
   - Try changing password and verify audit event logs

4. **Browser Console:**
   - Open F12 Developer Tools
   - Check for any "Permission denied" errors
   - All database operations should succeed

### If You Still Get Permission Denied (401/403):

1. Check that you're logged in with a valid Firebase account
2. Verify the auth token isn't expired (try logging out/in)
3. Ensure the rules were published successfully (check Firebase console status)
4. Check user UID matches in database paths vs auth.uid in rules
5. If issue persists, screenshot the error and check Firebase logs

### Rules File Location:

`/firebase-rtdb-rules.json` in your project root

### Database Schema Created by Rules:

```
sessions/
  users/
    {uid}/
      active/
        {sessionId}/
          id, userId, device, browser, os, ipAddress, location, createdAt, lastActiveAt

audit/
  users/
    {uid}/
      events/
        {eventId}/
          id, userId, type, ipAddress, device, location, timestamp, status, details

security/
  users/
    {uid}/
      settings/
        userId, twoFactorEnabled, twoFactorMethod, backupCodes, lastPasswordChange
      events/
        {eventId}/
          security event records
```
