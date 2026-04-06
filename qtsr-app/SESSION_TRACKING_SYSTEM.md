# Session Tracking System - Complete Implementation

## Overview
This document describes the enhanced session tracking system that monitors active sessions across devices, tracks session lifecycle, and maintains detailed login history.

## Key Features

### 1. **Active Session Tracking**
- ✅ Real-time tracking of all active user sessions
- ✅ Device detection (OS, Browser, Device type)
- ✅ IP address and geolocation tracking
- ✅ Session creation and last activity timestamps
- ✅ Support for multiple simultaneous sessions

### 2. **Session Heartbeat (Every 2 Minutes)**
- ✅ Automatic session activity updates via `useSessionHeartbeat` hook
- ✅ Location tracking with change detection
- ✅ Stored in Firebase under `sessions/users/{uid}/active/{sessionId}`
- ✅ Updates `lastActiveAt` timestamp every 2 minutes

### 3. **Session Lifecycle Management**
- ✅ Active sessions stored with start time and date
- ✅ Sessions moved to "past sessions" when ended
- ✅ Duration calculation (milliseconds stored, formatted for display)
- ✅ Location history tracking during session lifetime
- ✅ Stored in Firebase under `sessions/users/{uid}/past/{sessionId}`

### 4. **Login History**
- ✅ Last 5 logins displayed in profile
- ✅ Shows device, IP, and location for each login
- ✅ Audit event logging with status and timestamps
- ✅ Stored in Firebase under `audit/users/{uid}/events`

## Database Structure

### Active Sessions Path
```
sessions/
  users/
    {uid}/
      active/
        {sessionId}/
          id: string
          userId: string
          device: string (e.g., "Windows Device", "iOS Device")
          browser: string (e.g., "Chrome", "Safari")
          os: string (e.g., "Windows", "iOS", "Android")
          ipAddress: string (e.g., "103.145.23.45")
          location: string (e.g., "Mumbai, India")
          locations: string[] (tracks all locations visited)
          createdAt: number (timestamp in ms)
          lastActiveAt: number (timestamp in ms)
```

### Past Sessions Path
```
sessions/
  users/
    {uid}/
      past/
        {sessionId}/
          [All fields from Active Sessions plus:]
          endedAt: number (timestamp when session ended)
          duration: number (in milliseconds)
          locations: string[] (all locations visited during session)
```

### Audit Events Path
```
audit/
  users/
    {uid}/
      events/
        {eventId}/
          id: string
          userId: string
          type: "LOGIN" | "LOGOUT" | "SESSION_LOGOUT" | "PASSWORD_CHANGE" | "2FA_ENABLED" | "2FA_DISABLED"
          ipAddress: string
          device: string (e.g., "Windows - Chrome")
          location: string (e.g., "Mumbai, India")
          timestamp: number
          status: "success" | "failed"
          details?: string
```

## Firebase Security Rules

Updated rules allow:
- Users to read/write only their own session data
- Indexing on `endedAt` for efficient past session queries
- Validation of required fields for session records

```json
"sessions": {
  "users": {
    "$uid": {
      "active": { ... },
      "past": {
        ".indexOn": ["endedAt"],
        ...
      }
    }
  }
}
```

## Implementation Details

### 1. Session Creation (Login)
When a user logs in:
1. Device info is collected (OS, Browser, Device type)
2. IP address and location are fetched from geolocation API
3. Session is created with `createdAt` timestamp
4. Session ID is stored in localStorage for heartbeat tracking
5. Audit event is logged

```typescript
// In login handlers
const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
await createSession(user, sessionId);
localStorage.setItem("currentSessionId", sessionId);
```

### 2. Session Heartbeat Hook
The `useSessionHeartbeat` hook runs every 2 minutes to:
- Fetch fresh IP and location
- Detect location changes
- Update `lastActiveAt` timestamp
- Track location array if location changed

```typescript
// In profile page
useSessionHeartbeat({
  userId: user?.uid,
  sessionId: currentSessionId,
  enabled: !!user,
});
```

**Interval Configuration:**
- Default: 2 minutes (120000 ms)
- Can be customized by importing constant

### 3. Session Termination
When a user logs out or session ends:
1. Session is moved to "past sessions"
2. Duration is calculated (endedAt - createdAt)
3. Location array is finalized
4. Audit event with "SESSION_LOGOUT" is logged
5. Session is removed from active sessions

```typescript
await moveSessionToPast(userId, sessionId);
// Updates past sessions DB
// Logs audit event
// Removes from active sessions
```

### 4. Profile Page Display

**Active Sessions Tab Shows:**
- Device & Browser information
- IP address (with copy-friendly font)
- Current location
- Session duration (formatted: "1h 23m")
- Last activity time
- Location history (if changed during session)
- "CURRENT" badge for active session
- "LOGOUT" button for other devices
- "LOGOUT ALL DEVICES" button

**Past Sessions Display:**
- Device & Browser
- Session duration (formatted)
- IP address
- Location/Locations visited
- Session end time

**Login History Shows:**
- Last 5 logins
- Status (Success/Failed)
- Device used
- IP address
- Location
- Precise timestamp

## Usage Examples

### Show Last 5 Logins
```typescript
const auditHistory = await getLoginHistory(userId, 5);
// Returns AuditEvent[] sorted by timestamp (newest first)
```

### Get All Past Sessions
```typescript
const pastSessions = await getPastSessions(userId, 10);
// Returns PastSessionData[] with duration and location tracking
```

### Update Session Activity
```typescript
await updateSessionActivity(userId, sessionId, newLocation);
// Updates lastActiveAt and tracks location if changed
```

### Format Duration
```typescript
formatDuration(3661000); // Returns "1h 1m"
formatDuration(125000); // Returns "2m 5s"
```

## Device Detection

The system detects:

**Operating Systems:**
- Windows, macOS, Linux, UNIX, Android, iOS

**Browsers:**
- Firefox, Chrome, Safari, Edge

**Device Types:**
- Desktop, Mobile, Tablet

## Geolocation Service

**Primary Service:** `ipapi.co`
- Free tier: 30k requests/month
- Returns: IP address, City, Country name

**Fallback Service:** `ip-api.com`
- Used if primary fails
- Returns: IP address, City, Country

**Cache Strategy:**
- 1-minute cache duration
- `skipCache: true` forces fresh fetch (used in operations)

**Timeout:**
- 5 seconds per API call
- Falls back to "Unknown" if timeout

## File Structure

```
lib/
  sessionService.ts       # Core session management
  useSessionHeartbeat.ts  # React hook for heartbeat
  firebase.ts
  securityService.ts
app/
  login/
    page.tsx             # Updated: Stores session IDs
  profile/
    page.tsx             # Updated: Uses heartbeat, shows sessions
  ...
firebase-rtdb-rules.json # Updated: Past sessions rules
```

## Testing Checklist

### Web to Web (Multi-Tab)
- [ ] Open app in 2 browser tabs
- [ ] Go to profile in each tab
- [ ] Verify 2 active sessions shown
- [ ] Verify one marked as "CURRENT" in each tab
- [ ] Verify different IPs if using VPN/proxy
- [ ] Logout from one tab
- [ ] Verify session moved to past sessions

### Mobile to Web
- [ ] Access app on mobile (iPhone, Android)
- [ ] Go to Profile on web
- [ ] Verify mobile session appears in active sessions
- [ ] Check device detection (iOS/Android correct)
- [ ] Verify IP and location from mobile geolocation
- [ ] Logout mobile session
- [ ] Verify moved to past sessions with duration

### Session Duration
- [ ] Keep session active for 5+ minutes
- [ ] Duration should show as "5m" or similar
- [ ] Logout after duration shows correctly
- [ ] Multiple sessions with different durations show correctly

### Location Tracking
- [ ] Note location on login
- [ ] If possible, change location (use VPN)
- [ ] Check if locations array updates
- [ ] Verify past session shows all locations visited

### Heartbeat Activity
- [ ] Open browser console (F12)
- [ ] Look for "[HEARTBEAT]" messages every 2 minutes
- [ ] Messages should show: "Session {id} heartbeat sent"
- [ ] Activity updates should not cause page refresh

### Login History
- [ ] Last 5 logins are shown (not all)
- [ ] Each shows: device, IP, location, timestamp
- [ ] Sorted by most recent first
- [ ] Timestamps are accurate and precise

## Performance Considerations

### Database Reads
- Active sessions: Single read per profile load
- Past sessions: Limited to last 10 (indexed on `endedAt`)
- Login history: Limited to last 5-10 (indexed on `timestamp`)

### Database Writes
- Heartbeat: Every 2 minutes per active session
- Login: 1 write + 1 audit event
- Logout: 1 write to past + 1 removal from active + audit event

### Optimization
- Use of `limitToLast()` with indexes for efficient queries
- Heartbeat check prevents excessive updates
- localStorage for session ID avoids repeated fetches
- Geolocation caching (1 minute) reduces API calls

## Troubleshooting

### Sessions Not Showing
1. Check browser console for errors
2. Verify Firebase credentials in `.env.local`
3. Verify Firebase rules are deployed
4. Check localStorage has currentSessionId: `localStorage.getItem("currentSessionId")`

### Session Duration Not Updating
1. Verify heartbeat hook is enabled
2. Check browser console for "[HEARTBEAT]" messages
3. Verify Firebase connection
4. Check `lastActiveAt` in Firebase console

### Location Not Tracking
1. Check geolocation API calls in Network tab
2. Verify IP APIs are accessible
3. Check for CORS issues
4. Fallback should show "Unknown Location"

### Past Sessions Empty
1. Manually logout a session to test
2. Verify past sessions path exists in Firebase
3. Check rules allow read access to past sessions

## Future Enhancements

- [ ] Session fingerprinting for suspicious activity detection
- [ ] Automatic logout after inactivity period
- [ ] Device trust/recognition system
- [ ] Browser notification for new sessions
- [ ] Session geofencing (location-based access control)
- [ ] Export activity report
- [ ] Two-factor authentication prompt on new device
- [ ] Session notes/labels ("Home", "Work", etc.)

## Migration Notes

For existing applications, no data migration needed. The system coexists with existing authentication and adds new tracking layers.

## Support & Documentation

For more details, see:
- `PROFILE_FIXES_COMPLETE.md` - Session and profile fixes overview
- `TEST_PROFILE_FIXES.sh` - Manual testing guide
- Profile page code comments for implementation details
