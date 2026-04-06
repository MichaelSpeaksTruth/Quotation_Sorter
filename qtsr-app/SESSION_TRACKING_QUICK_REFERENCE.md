# Session Tracking System - Quick Reference

## For Users (Profile Page)

### What You'll See

#### Active Sessions Tab 🖥️
Shows all devices currently logged into your account:
- **Device**: OS and Browser (e.g., "iOS - Safari", "Windows - Chrome")
- **IP**: Your public IP address
- **Location**: City and Country
- **Duration**: How long this session has been active
- **Last Active**: When you were last active
- **CURRENT**: Badge on your current device
- **LOGOUT**: Button to logout from other devices

#### Past Sessions Tab 🕐
Shows sessions you've ended:
- **Device**: OS and Browser used
- **Duration**: How long the session lasted
- **IP**: Public IP address used
- **Locations**: All places you accessed from (e.g., "Mumbai, India → Bangalore, India")
- **Ended**: When the session ended

#### Login History 📋
Last 5 times you logged in:
- **Status**: Success or Failed attempt
- **Device**: What device/browser you used
- **IP**: Your IP address at login
- **Location**: Where you logged in from
- **Timestamp**: Exact date and time

## For Developers

### Integration Steps

#### 1. Import Required Functions
```typescript
import {
  SessionData,
  PastSessionData,
  getActiveSessions,
  getPastSessions,
  logoutSession,
  moveSessionToPast,
  getDeviceInfo,
  getIPAddressAndLocation,
  formatDuration,
} from "@/lib/sessionService";

import { useSessionHeartbeat } from "@/lib/useSessionHeartbeat";
```

#### 2. Use Session Heartbeat Hook
```typescript
export function MyComponent() {
  const { user } = useAuth(); // Your auth hook
  const [sessionId, setSessionId] = useState<string>();

  // Keeps session active with heartbeat every 2 minutes
  useSessionHeartbeat({
    userId: user?.uid,
    sessionId: sessionId,
    enabled: !!user,
  });

  // ... rest of component
}
```

#### 3. Create Session on Login
```typescript
// When user logs in
const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
await createSession(user, sessionId);

// Store for heartbeat
localStorage.setItem("currentSessionId", sessionId);
```

#### 4. Display Active Sessions
```typescript
const [sessions, setSessions] = useState<SessionData[]>([]);

useEffect(() => {
  const sessions = await getActiveSessions(userId);
  setSessions(sessions);
}, [userId]);

sessions.map(session => (
  <div key={session.id}>
    <p>{session.os} - {session.browser}</p>
    <p>IP: {session.ipAddress}</p>
    <p>Location: {session.location}</p>
    <p>Duration: {formatDuration(Date.now() - session.createdAt)}</p>
  </div>
))
```

#### 5. Logout Session
```typescript
await logoutSession(userId, sessionId);
// Automatically moves to past sessions and logs audit event
```

### API Reference

#### Session Functions

**getActiveSessions(userId: string): Promise<SessionData[]>**
- Gets all currently active sessions
- Returns array of active sessions for user
- Use case: Display in Activities tab

**getPastSessions(userId: string, limit?: 10): Promise<PastSessionData[]>**
- Gets past/ended sessions
- Returns array sorted by most recent first
- Includes duration and location array
- Use case: Display session history

**updateSessionActivity(userId: string, sessionId: string, newLocation?: string): Promise<void>**
- Updates session's lastActiveAt timestamp
- Tracks location if provided
- Called automatically by heartbeat hook

**moveSessionToPast(userId: string, sessionId: string): Promise<PastSessionData | null>**
- Moves session from active to past
- Calculates duration
- Logs SESSION_LOGOUT audit event
- Use case: Session termination

**logoutSession(userId: string, sessionId: string): Promise<void>**
- Convenience function that calls moveSessionToPast
- Use case: User manually logging out from device

**logoutAllSessions(userId: string): Promise<void>**
- Moves all active sessions to past
- Logs audit events for all
- Use case: "Logout all devices" button

#### Utility Functions

**formatDuration(milliseconds: number): string**
- Converts ms to human readable format
- Examples: "1h 23m", "45s", "2d 3h"
- Use case: Display session duration

**formatTimestamp(timestamp: number): string**
- Formats timestamp to readable date-time
- Returns: "Mar 23, 2026 14:30:45"
- Use case: Display session start/end times

**getRelativeTime(timestamp: number): string**
- Returns relative time (e.g., "2h ago", "Just now")
- Use case: Display "last active" times

**getDeviceInfo(): { device: string, browser: string, os: string }**
- Detects current browser/OS
- Examples: os="Windows", browser="Chrome", device="Desktop"
- Use case: Session creation

**getIPAddressAndLocation(skipCache?: boolean): Promise<{ ip: string, location: string }>**
- Fetches IP and geolocation
- skipCache=true forces fresh fetch
- Fallback to "Unknown" if API fails
- Use case: Session creation and heartbeat

### Database Paths

```typescript
// Active sessions
`sessions/users/${uid}/active/${sessionId}`

// Past sessions
`sessions/users/${uid}/past/${sessionId}`

// Audit events
`audit/users/${uid}/events/${eventId}`
```

### Type Definitions

```typescript
interface SessionData {
  id: string;
  userId: string;
  device: string;        // e.g., "Windows Device"
  browser: string;       // e.g., "Chrome"
  os: string;           // e.g., "Windows"
  ipAddress: string;    // e.g., "192.168.1.1"
  location: string;     // e.g., "Mumbai, India"
  locations?: string[]; // All locations visited
  createdAt: number;    // Timestamp in ms
  lastActiveAt: number; // Timestamp in ms
}

interface PastSessionData extends SessionData {
  endedAt: number;      // Timestamp when ended
  duration: number;     // In milliseconds
  locations: string[];  // All locations visited
}

interface AuditEvent {
  id: string;
  userId: string;
  type: "LOGIN" | "LOGOUT" | "SESSION_LOGOUT" | "PASSWORD_CHANGE" | "2FA_ENABLED" | "2FA_DISABLED";
  ipAddress: string;
  device: string;
  location: string;
  timestamp: number;
  status: "success" | "failed";
  details?: string;
}
```

### React Hook

**useSessionHeartbeat(options: UseSessionHeartbeatOptions): void**

Options:
```typescript
interface UseSessionHeartbeatOptions {
  userId: string | undefined;    // User ID
  sessionId: string | undefined; // Current session ID
  enabled?: boolean;             // Enable/disable heartbeat
}
```

Behavior:
- Sends heartbeat every 2 minutes
- Updates lastActiveAt timestamp
- Tracks location changes
- Logs to console with "[HEARTBEAT]" prefix
- Cleans up on unmount

### Configuration

**Heartbeat Interval:** 2 minutes (120000 ms)
- Located in: `lib/useSessionHeartbeat.ts`
- Modify: `const HEARTBEAT_INTERVAL = 2 * 60 * 1000;`

**Geolocation Cache:** 1 minute
- Located in: `lib/sessionService.ts`
- Modify: `const GEO_CACHE_DURATION = 1 * 60 * 1000;`

**Inactivity Timeout:** 30 minutes (optional hook)
- Located in: `lib/useSessionHeartbeat.ts`
- Hook: `useSessionInactivityChecker()`

## Common Tasks

### Task: Show Current Active Sessions
```typescript
const [sessions, setSessions] = useState<SessionData[]>([]);

useEffect(() => {
  if (!userId) return;
  
  const session = await getActiveSessions(userId);
  setSessions(sessions);
}, [userId]);

return (
  <div>
    {sessions.length} active sessions
    {sessions.map(s => <SessionCard key={s.id} session={s} />)}
  </div>
);
```

### Task: Add Session Logout Button
```typescript
<button
  onClick={async () => {
    await logoutSession(userId, sessionId);
    // Refresh sessions list
    const updated = await getActiveSessions(userId);
    setSessions(updated);
  }}
>
  Logout This Device
</button>
```

### Task: Display Last 5 Logins
```typescript
const [logins, setLogins] = useState<AuditEvent[]>([]);

useEffect(() => {
  const history = await getLoginHistory(userId, 5);
  setLogins(history.filter(e => e.type === "LOGIN"));
}, [userId]);

return logins.map(login => (
  <div key={login.id}>
    {login.device} at {formatTimestamp(login.timestamp)}
    IP: {login.ipAddress}, Location: {login.location}
  </div>
));
```

### Task: Show Session Duration
```typescript
const duration = Date.now() - session.createdAt;
<span>{formatDuration(duration)}</span>
```

## Troubleshooting

### Q: Heartbeat not working?
**A:** 
1. Check console for "[HEARTBEAT]" messages
2. Verify `enabled` prop is true
3. Verify userId and sessionId are provided
4. Check Firebase connection

### Q: Sessions not appearing for mobile?
**A:**
1. Mobile must be logged in to same Firebase project
2. Geolocation should detect iOS/Android OS
3. May take 30 seconds to appear
4. Check Firebase console for actual data

### Q: Wrong device detected?
**A:**
- Device detection is based on User-Agent string
- User-Agent might report differently on some browsers
- Always shows best-guess based on browser headers

### Q: Unknown IP/Location?
**A:**
- Geolocation API may fail (network issue)
- Timeout set to 5 seconds
- Falls back to "Unknown" safely
- Works on next heartbeat

## Support

For issues or questions:
1. Check console logs with "[PROFILE]", "[LOGIN]", "[HEARTBEAT]" prefixes
2. Check Firebase rules are deployed correctly
3. Verify Firebase database URLs in `.env.local`
4. Review full docs in `SESSION_TRACKING_SYSTEM.md`
