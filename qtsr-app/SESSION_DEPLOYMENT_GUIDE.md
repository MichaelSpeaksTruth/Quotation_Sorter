# Session Tracking System - Deployment & Testing Guide

## 🚀 What Was Implemented

A complete session tracking system that:
- ✅ Tracks all active sessions across web and mobile
- ✅ Sends heartbeat every 2 minutes to keep sessions alive
- ✅ Records precise IP address and geolocation for each session
- ✅ Moves ended sessions to "past sessions" with duration
- ✅ Tracks location changes during session lifetime
- ✅ Shows last 5 logins in profile
- ✅ Displays comprehensive session information (device, IP, location, duration)

## 📋 Files Modified & Created

### New Files Created
1. **`lib/useSessionHeartbeat.ts`** - React hook for 2-minute heartbeat
2. **`SESSION_TRACKING_SYSTEM.md`** - Complete technical documentation
3. **`SESSION_TRACKING_QUICK_REFERENCE.md`** - Developer quick reference
4. **`SESSION_DEPLOYMENT_GUIDE.md`** - This file

### Files Modified
1. **`lib/sessionService.ts`**
   - Added `PastSessionData` interface
   - Enhanced `updateSessionActivity()` for location tracking
   - Added `moveSessionToPast()` function
   - Added `getPastSessions()` function
   - Added `subscribeToPastSessions()` function
   - Enhanced `logoutSession()` and `logoutAllSessions()`
   - Added utility functions: `formatDuration()`, `formatTimestamp()`, `getRelativeTime()`

2. **`app/login/page.tsx`**
   - Updated all auth handlers (Google/Email signup/signin)
   - Collects real device info and geolocation
   - Stores session ID in localStorage
   - Logs audit events with real data

3. **`app/profile/page.tsx`**
   - Added past sessions state and display
   - Integrated `useSessionHeartbeat` hook
   - Shows active sessions with current badge
   - Shows past sessions with duration and location tracking
   - Displays last 5 logins instead of all
   - Enhanced session details display
   - Clear localStorage on sign out

4. **`firebase-rtdb-rules.json`**
   - Added `sessions/users/{uid}/past` path
   - Added index on `endedAt` for efficient queries
   - Added validation for past session fields

5. **`lib/securityService.ts`**
   - Updated imports to use `getIPAddressAndLocation`

## 🏗️ Architecture Overview

```
Login/Signup
    ↓
Create Session (with device & location)
    ↓
Store in Active Sessions + localStorage
    ↓
Start Heartbeat (every 2 minutes)
    ↓
Update lastActiveAt + track locations
    ↓
    └─→ Logout/End Session
        ↓
        Move to Past Sessions (calculate duration)
        ↓
        Log audit event
        ↓
        Remove from Active Sessions
```

## 📊 Database Structure

### Before (Simple)
```
sessions/users/{uid}/active/{sessionId}/
  - Basic session fields
  - No past session tracking
  - No duration calculations
```

### After (Enhanced)
```
sessions/users/{uid}/
  active/{sessionId}/        ← Current sessions
    - Device, Browser, OS, IP, Location
    - createdAt, lastActiveAt
    - locations array
  
  past/{sessionId}/          ← Historical sessions
    - All active fields
    - endedAt timestamp
    - duration (milliseconds)
    - complete locations array
    - indexed on endedAt for queries
```

## 🔧 Configuration Required

### 1. Deploy Firebase Rules
```bash
firebase deploy --only database
```

The following rules path must be deployed:
- `sessions/users/{uid}/past` with index on `endedAt`

### 2. No Environment Variables Needed
The system uses existing `.env.local` configuration:
- `NEXT_PUBLIC_FIREBASE_DATABASE_URL` (already present)
- Geolocation APIs (public, no keys needed)

### 3. Browser Storage
The system uses localStorage for:
- Key: `currentSessionId`
- Set on: Login
- Cleared on: Logout
- Purpose: Heartbeat tracking

## 🧪 Testing Workflow

### Phase 1: Local Testing

#### Test 1: Web Session Creation
```
1. npm run dev
2. Go to http://localhost:3000/login
3. Sign up with email test@example.com
4. Go to Profile → Activity tab
5. Verify:
   ✓ 1 active session shown
   ✓ Device shows correct OS (Windows/Mac/Linux)
   ✓ Browser shows correct browser (Chrome/Safari/etc)
   ✓ IP shows a real address (not "0.0.0.0")
   ✓ Location shows City, Country
   ✓ Duration shows (e.g., "5m 23s")
   ✓ CURRENT badge present
```

#### Test 2: Multi-Device (Tabs)
```
1. Open Profile in Tab A
2. Open new tab, login again (Tab B)
3. In Tab A:
   ✓ 2 active sessions shown
   ✓ One marked CURRENT
   ✓ One has LOGOUT button
4. In Tab B:
   ✓ 2 active sessions shown
   ✓ This one marked CURRENT
   ✓ Other one has LOGOUT button
```

#### Test 3: Logout Single Session
```
1. In Tab A with 2 sessions
2. Click LOGOUT on the other session
3. Verify:
   ✓ Session removed within 2-5 seconds
   ✓ Past sessions count increases
4. Go to Past Sessions tab:
   ✓ Closed session now visible
   ✓ Shows duration (e.g., "3m 45s")
   ✓ Shows IP and Location
```

#### Test 4: Heartbeat
```
1. Open browser console (F12)
2. Filter for "[HEARTBEAT]" messages
3. Wait 2 minutes
4. Verify:
   ✓ Message appears like: "[HEARTBEAT] Session {id} heartbeat sent"
   ✓ lastActiveAt updates in Firebase
   ✓ Page doesn't navigate/refresh
```

#### Test 5: Login History
```
1. Profile → Activity tab
2. Scroll to "LAST 5 LOGINS" section
3. Verify:
   ✓ Shows max 5 logins (not all)
   ✓ Newest first
   ✓ Each shows Status (Success/Failed)
   ✓ Shows Device, IP, Location for each
   ✓ Shows precise timestamp
```

#### Test 6: Past Sessions
```
1. Logout current session (Sign Out button)
2. Wait for page to redirect
3. Sign back in
4. Go to Profile → Activity tab
5. Scroll to "PAST SESSIONS" section
6. Verify:
   ✓ Previous session listed
   ✓ Shows duration of that session
   ✓ Shows IP and Location
   ✓ Shows start timestamp
   ✓ Shows end timestamp
```

### Phase 2: Mobile Testing

#### Test 7: iOS Session
```
1. On iPhone, go to app URL
2. Sign in with same account
3. On web Profile:
   ✓ iPhone session appears immediately
   ✓ Device shows "iOS Device" or "iOS - Safari"
   ✓ IP from iPhone's network
   ✓ Location auto-detected (if enabled)
```

#### Test 8: Android Session
```
1. On Android, go to app URL
2. Sign in with different account (test-android@example.com)
3. Create second profile account on Android
4. On web, go to first account's Profile:
   ✓ Desktop session visible
   ✓ Android session visible
   ✓ Device shows "Android Device" or "Android - Chrome"
   ✓ Each has correct IP/Location
```

#### Test 9: Cross-Platform Session Termination
```
1. From web, LOGOUT the mobile session
2. On mobile:
   ✓ Session ends gracefully
   ✓ May show error or redirect to login
3. On web:
   ✓ Past Sessions now shows mobile session
   ✓ Duration calculated correctly
```

### Phase 3: Edge Cases

#### Test 10: No Internet (Geolocation Fails)
```
1. In DevTools, throttle network to OFFLINE
2. Sign up with offline (will fail)
3. Turn network back on, ensure location still loads
4. Wait for heartbeat
5. Verify:
   ✓ Falls back to "Unknown Location"
   ✓ Session still works
   ✓ No hard errors in console
```

#### Test 11: Rapid Multiple Logins
```
1. Login account A
2. While heartbeat running, logout all
3. Immediately login account B
4. Verify:
   ✓ Sessions cleanly transition
   ✓ sessionId changes in localStorage
   ✓ Heartbeat continues on new session
```

#### Test 12: Long Session Duration
```
1. Create session
2. Don't interact for 10 minutes
3. Check Past Sessions:
   ✓ Manually close session (LOGOUT)
   ✓ Duration shows ~10 minutes
   ✓ lastActiveAt is from ~10 min ago
```

## 🚀 Deployment Checklist

### Pre-Deployment
- [ ] All tests pass locally
- [ ] No console errors in browser
- [ ] Firebase rules reviewed and tested
- [ ] Environment variables verified (`.env.local`)
- [ ] Mobile testing completed on both iOS and Android
- [ ] Multiple session testing verified

### Deployment Steps
1. **Deploy Firebase Rules**
   ```bash
   firebase deploy --only database
   # Verify: Check Firebase Console → Database → Rules
   ```

2. **Deploy App**
   ```bash
   npm run build
   npm start
   # OR
   npm run deploy  # If using hosting
   ```

3. **Smoke Tests (Post-Deploy)**
   - [ ] Web login creates session
   - [ ] Heartbeat runs (check logs)
   - [ ] Mobile login appears in web profile
   - [ ] Manual logout creates past session
   - [ ] Last 5 logins show

### Production Monitoring
- [ ] Monitor Firebase read/write quotas
- [ ] Check geolocation API usage
- [ ] Monitor session heartbeat frequency
- [ ] Track database size growth
- [ ] Monitor past sessions accumulation

## 📈 Expected Metrics

### Database Usage

**Per User Session:**
- Write: ~500 bytes (session data)
- Read: ~100 bytes per heartbeat (every 2 min)
- Estimated: 720 reads/day per active user

**Per User Monthly:**
- ~30-50 past sessions created
- ~1000 audit events created
- ~400 KB storage per active user

### API Calls
- Geolocation: 1x on login + 1x per heartbeat
- Expected: ~1,440 calls/day per active user on 2-min heartbeat
- Cost: ~$0.001/day per user (using free tier)

## 🆘 Troubleshooting

### Issue: Sessions not appearing on mobile
**Solution:**
1. Verify mobile is using same Firebase project
2. Check Firebase authentication works on mobile
3. Check timezone differences don't hide sessions
4. Try hard refresh on web (Ctrl+Shift+R)

### Issue: Heartbeat not working
**Solution:**
1. Check console for "[HEARTBEAT]" messages
2. Verify `useSessionHeartbeat` hook is mounted
3. Check localStorage has currentSessionId
4. Verify Firebase rules allow writes

### Issue: Geolocation fails
**Solution:**
1. Check network connectivity
2. Verify public IP APIs are accessible
3. Check browser security settings
4. Check for VPN/Proxy blocking
5. Falls back to "Unknown" automatically

### Issue: Past sessions not moving
**Solution:**
1. Check Firebase rules include past path
2. Verify rules have correct validation
3. Check `moveSessionToPast()` is being called
4. Check Firebase for any write errors

## 📚 Related Documentation

- **Complete Technical Docs:** `SESSION_TRACKING_SYSTEM.md`
- **Developer API Reference:** `SESSION_TRACKING_QUICK_REFERENCE.md`
- **Profile Fixes Overview:** `PROFILE_FIXES_COMPLETE.md`
- **Testing Guide (Manual):** `TEST_PROFILE_FIXES.sh`

## 🎯 Success Criteria

System is successfully deployed when:
- ✅ Web sessions track and display correctly
- ✅ Mobile sessions appear in web profile within 2 minutes
- ✅ Heartbeat updates session every 2 minutes
- ✅ Session durations calculate correctly
- ✅ Past sessions track location changes
- ✅ Last 5 logins display with all details
- ✅ All device types detect correctly (iOS, Android, Windows, Mac)
- ✅ IP and location track accurately
- ✅ No console errors
- ✅ Firebase quotas within limits

## 📞 Support

If issues arise:
1. Check browser console logs (F12)
2. Check Firebase console for database state
3. Review `SESSION_TRACKING_QUICK_REFERENCE.md` for API usage
4. Test individual components in isolation
5. Check Firebase rules are deployed correctly

---

**Last Updated:** March 23, 2026
**System Version:** 2.0 (Complete Session Lifecycle)
**Status:** Ready for Testing
