/**
 * Session Management Service
 * Handles user sessions, device tracking, and logout functionality
 */

import {
  ref,
  set,
  get,
  update,
  remove,
  query,
  orderByChild,
  limitToLast,
  onValue,
} from "firebase/database";
import { rtdb } from "./firebase";
import { User } from "firebase/auth";

export interface SessionData {
  id: string;
  userId: string;
  device: string;
  browser: string;
  os: string;
  ipAddress: string;
  location: string;
  createdAt: number;
  lastActiveAt: number;
  isCurrent?: boolean;
}

/**
 * Past Session - Session that has been closed
 * Includes duration and movement timestamp
 */
export interface PastSessionData extends SessionData {
  endedAt: number;
  duration: number; // in milliseconds
  locations: string[]; // All locations visited during session
}

export interface AuditEvent {
  id: string;
  userId: string;
  type: "LOGIN" | "LOGOUT" | "PASSWORD_CHANGE" | "SESSION_LOGOUT";
  ipAddress: string;
  device: string;
  location: string;
  timestamp: number;
  status: "success" | "failed";
  details?: string;
}

// Helper type for event creation (excludes id and userId since they're added by the function)
export type AuditEventInput = Omit<AuditEvent, "id" | "userId">;

// Detect device/browser information
export function getDeviceInfo(): {
  device: string;
  browser: string;
  os: string;
} {
  const ua = navigator.userAgent;

  // Detect OS
  let os = "Unknown OS";
  if (ua.indexOf("Win") > -1) os = "Windows";
  else if (ua.indexOf("Mac") > -1) os = "macOS";
  else if (ua.indexOf("Linux") > -1) os = "Linux";
  else if (ua.indexOf("X11") > -1) os = "UNIX";
  else if (ua.indexOf("Android") > -1) os = "Android";
  else if (ua.indexOf("iPhone") > -1) os = "iOS";

  // Detect Browser
  let browser = "Unknown Browser";
  if (ua.indexOf("Firefox") > -1) browser = "Firefox";
  else if (ua.indexOf("Chrome") > -1) browser = "Chrome";
  else if (ua.indexOf("Safari") > -1) browser = "Safari";
  else if (ua.indexOf("Edge") > -1) browser = "Edge";

  // Detect Device
  let device = "Desktop";
  if (ua.indexOf("Mobile") > -1) device = "Mobile";
  else if (ua.indexOf("Tablet") > -1) device = "Tablet";

  return { device, browser, os };
}

// Get real IP address and location using geolocation API
let cachedGeoData: { ip: string; location: string; timestamp: number } | null = null;
const GEO_CACHE_DURATION = 1 * 60 * 1000; // 1 minute cache only

export async function getIPAddressAndLocation(skipCache: boolean = false): Promise<{
  ip: string;
  location: string;
}> {
  // Return cached data if available and not expired (unless skipCache is true)
  if (!skipCache && cachedGeoData && Date.now() - cachedGeoData.timestamp < GEO_CACHE_DURATION) {
    return { ip: cachedGeoData.ip, location: cachedGeoData.location };
  }

  try {
    // Use ipapi.co - free IP geolocation service with 30k requests/month
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    const response = await fetch("https://ipapi.co/json/", { 
      method: "GET",
      cache: "no-store",
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`Geolocation API returned status ${response.status}`);
      throw new Error("Geolocation API failed");
    }

    const data = await response.json();
    const ip = data.ip || "Unknown";
    const location = `${data.city || "Unknown"}, ${data.country_name || "Unknown"}`;

    // Cache for duration
    cachedGeoData = { ip, location, timestamp: Date.now() };

    console.log(`[GEO] Fetched IP: ${ip}, Location: ${location}`);
    return { ip, location };
  } catch (error) {
    console.warn("[GEO] Failed to fetch geolocation from ipapi.co:", error);
    
    // Try fallback geolocation service
    try {
      const response = await fetch("https://ip-api.com/json/?fields=query,city,country", {
        method: "GET",
        cache: "no-store",
      });
      
      if (response.ok) {
        const data = await response.json();
        const ip = data.query || "Unknown";
        const location = `${data.city || "Unknown"}, ${data.country || "Unknown"}`;
        cachedGeoData = { ip, location, timestamp: Date.now() };
        console.log(`[GEO] Fallback: Fetched IP: ${ip}, Location: ${location}`);
        return { ip, location };
      }
    } catch (fallbackError) {
      console.warn("[GEO] Fallback geolocation also failed:", fallbackError);
    }
    
    // Final fallback to defaults
    return { ip: "Unknown", location: "Unknown Location" };
  }
}

// Create a new session
export async function createSession(
  user: User,
  sessionId: string
): Promise<SessionData> {
  const { device, browser, os } = getDeviceInfo();
  const { ip: ipAddress, location } = await getIPAddressAndLocation();
  const now = Date.now();

  const session: SessionData = {
    id: sessionId,
    userId: user.uid,
    device: `${os} Device`,
    browser: `${browser}`,
    os,
    ipAddress,
    location,
    createdAt: now,
    lastActiveAt: now,
    isCurrent: true,
  };

  const sessionRef = ref(rtdb, `sessions/users/${user.uid}/active/${sessionId}`);
  await set(sessionRef, session);

  return session;
}

// Get all active sessions for a user
export async function getActiveSessions(userId: string): Promise<SessionData[]> {
  try {
    if (!userId) {
      console.warn(`[SESSION] Cannot get active sessions: userId is missing`);
      return [];
    }

    const sessionsRef = ref(rtdb, `sessions/users/${userId}/active`);
    console.log(`[SESSION] Reading active sessions from: sessions/users/${userId}/active`);
    
    const snapshot = await get(sessionsRef);
    console.log(`[SESSION] Active sessions read successful, exists: ${snapshot.exists()}`);

    if (!snapshot.exists()) {
      console.log(`[SESSION] No active sessions found`);
      return [];
    }

    const data = snapshot.val();
    console.log(`[SESSION] Raw active sessions data:`, data);
    
    const sessions = Object.values(data) as SessionData[];
    console.log(`[SESSION] Returning ${sessions.length} active sessions`);
    
    return sessions;
  } catch (error: any) {
    console.error("[SESSION] Error fetching active sessions:", error);
    console.error("[SESSION] Error code:", error?.code);
    console.error("[SESSION] Error message:", error?.message);
    return [];
  }
}

// Update session last active time and location
export async function updateSessionActivity(
  userId: string,
  sessionId: string,
  newLocation?: string
): Promise<void> {
  try {
    if (!userId || !sessionId) {
      console.warn(`[SESSION] Cannot update activity: userId=${userId}, sessionId=${sessionId}`);
      return;
    }

    const sessionRef = ref(
      rtdb,
      `sessions/users/${userId}/active/${sessionId}`
    );
    
    console.log(`[SESSION] Reading session from: sessions/users/${userId}/active/${sessionId}`);
    const snapshot = await get(sessionRef);
    
    if (!snapshot.exists()) {
      console.warn(`[SESSION] Session ${sessionId} not found for update`);
      return;
    }

    const sessionData = snapshot.val();
    const now = Date.now();
    
    // Prepare update with new location if provided
    const updateData: Record<string, any> = {
      lastActiveAt: now,
    };

    // Track location changes
    if (newLocation) {
      const locations = sessionData.locations || [sessionData.location];
      if (!locations.includes(newLocation)) {
        locations.push(newLocation);
      }
      updateData.locations = locations;
      updateData.location = newLocation; // Update current location
    }

    console.log(`[SESSION] Updating session ${sessionId} with data:`, updateData);
    await update(sessionRef, updateData);
    console.log(`[SESSION] Updated activity for session ${sessionId}`);
  } catch (error: any) {
    console.error(`[SESSION] Error updating session activity:`, error);
    console.error(`[SESSION] Error code:`, error?.code);
    console.error(`[SESSION] Error message:`, error?.message);
  }
}

/**
 * Move an active session to past sessions when it ends
 * Calculates duration and stores with end timestamp
 */
export async function moveSessionToPast(
  userId: string,
  sessionId: string
): Promise<PastSessionData | null> {
  try {
    if (!userId || !sessionId) {
      console.warn(`[SESSION] Cannot move session to past: userId=${userId}, sessionId=${sessionId}`);
      return null;
    }

    const sessionRef = ref(rtdb, `sessions/users/${userId}/active/${sessionId}`);
    console.log(`[SESSION] Reading active session: sessions/users/${userId}/active/${sessionId}`);
    
    const snapshot = await get(sessionRef);

    if (!snapshot.exists()) {
      console.warn(`[SESSION] Could not find session to close: ${sessionId}`);
      return null;
    }

    const sessionData = snapshot.val() as SessionData;
    const now = Date.now();
    const duration = now - sessionData.createdAt;

    // Create past session object with duration
    const pastSession: PastSessionData = {
      ...sessionData,
      endedAt: now,
      duration,
      locations: [sessionData.location],
    };

    // Store in past sessions
    const pastSessionRef = ref(
      rtdb,
      `sessions/users/${userId}/past/${sessionId}`
    );
    console.log(`[SESSION] Writing to past sessions: sessions/users/${userId}/past/${sessionId}`);
    console.log(`[SESSION] Past session data:`, pastSession);
    
    await set(pastSessionRef, pastSession);

    // Log the session end
    await logAuditEvent(userId, {
      type: "SESSION_LOGOUT",
      ipAddress: sessionData.ipAddress,
      device: `${sessionData.os} - ${sessionData.browser}`,
      location: sessionData.location,
      timestamp: now,
      status: "success",
      details: `Session ended. Duration: ${formatDuration(duration)}`,
    });

    // Remove from active sessions
    console.log(`[SESSION] Removing from active sessions...`);
    await remove(sessionRef);

    console.log(
      `[SESSION] Moved session ${sessionId} to past sessions. Duration: ${formatDuration(duration)}`
    );

    return pastSession;
  } catch (error: any) {
    console.error(`[SESSION] Error moving session to past:`, error);
    console.error(`[SESSION] Error code:`, error?.code);
    console.error(`[SESSION] Error message:`, error?.message);
    return null;
  }
}

/**
 * Get past sessions (closed sessions) for a user
 */
export async function getPastSessions(
  userId: string,
  limit: number = 10
): Promise<PastSessionData[]> {
  try {
    if (!userId) {
      console.warn("[SESSION] Cannot get past sessions: userId is missing");
      return [];
    }

    console.log(`[SESSION] Fetching past sessions for user ${userId}...`);
    
    // Try to read the past sessions directly first without query
    const pastSessionsRef = ref(rtdb, `sessions/users/${userId}/past`);
    console.log(`[SESSION] Reading from: sessions/users/${userId}/past`);
    
    const basicSnapshot = await get(pastSessionsRef);
    console.log(`[SESSION] Basic read successful, exists: ${basicSnapshot.exists()}`);

    if (!basicSnapshot.exists()) {
      console.log(`[SESSION] No past sessions found (node doesn't exist)`);
      return [];
    }

    const data = basicSnapshot.val();
    console.log(`[SESSION] Raw data retrieved:`, data);
    
    const sessions = Object.values(data) as PastSessionData[];
    
    // Sort by endedAt descending (most recent first)
    const sorted = sessions.sort((a, b) => b.endedAt - a.endedAt);
    console.log(`[SESSION] Returning ${sorted.length} past sessions`);
    
    return sorted;
  } catch (error: any) {
    console.error("[SESSION] Error fetching past sessions:", error);
    console.error("[SESSION] Error code:", error?.code);
    console.error("[SESSION] Error message:", error?.message);
    if (error?.details) {
      console.error("[SESSION] Error details:", error.details);
    }
    return [];
  }
}

// Logout from specific device (moves to past sessions)
export async function logoutSession(
  userId: string,
  sessionId: string
): Promise<void> {
  try {
    console.log(`[SESSION] Logging out session: ${sessionId}`);
    await moveSessionToPast(userId, sessionId);
  } catch (error) {
    console.error(`[SESSION] Error logging out session:`, error);
    // Fallback: just remove
    const sessionRef = ref(rtdb, `sessions/users/${userId}/active/${sessionId}`);
    await remove(sessionRef);
  }
}

// Logout from all devices
export async function logoutAllSessions(userId: string): Promise<void> {
  try {
    console.log(`[SESSION] Logging out all sessions for user: ${userId}`);
    const sessionsRef = ref(rtdb, `sessions/users/${userId}/active`);
    const snapshot = await get(sessionsRef);

    if (snapshot.exists()) {
      const sessions = snapshot.val();
      const promises = Object.keys(sessions).map((sessionId) =>
        moveSessionToPast(userId, sessionId)
      );
      await Promise.all(promises);
    }
  } catch (error) {
    console.error(`[SESSION] Error logging out all sessions:`, error);
  }
}

// Get login history
export async function getLoginHistory(
  userId: string,
  limit: number = 10
): Promise<AuditEvent[]> {
  try {
    if (!userId) {
      console.warn("[SESSION] Cannot get login history: userId is missing");
      return [];
    }

    console.log(`[SESSION] Fetching login history for user ${userId}...`);
    
    const auditRef = ref(rtdb, `audit/users/${userId}/events`);
    console.log(`[SESSION] Reading from: audit/users/${userId}/events`);
    
    const basicSnapshot = await get(auditRef);
    console.log(`[SESSION] Audit read successful, exists: ${basicSnapshot.exists()}`);

    if (!basicSnapshot.exists()) {
      console.log(`[SESSION] No audit events found`);
      return [];
    }

    const data = basicSnapshot.val();
    console.log(`[SESSION] Raw audit data retrieved:`, data);
    
    const events = Object.values(data) as AuditEvent[];
    const reversed = events.reverse(); // Most recent first
    console.log(`[SESSION] Returning ${reversed.length} audit events`);
    
    return reversed;
  } catch (error: any) {
    console.error("Error fetching audit history:", error);
    console.error("Error code:", error?.code);
    console.error("Error message:", error?.message);
    return [];
  }
}

// Log audit event
export async function logAuditEvent(
  userId: string,
  event: AuditEventInput
): Promise<void> {
  try {
    const eventId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const eventRef = ref(rtdb, `audit/users/${userId}/events/${eventId}`);

    await set(eventRef, {
      id: eventId,
      userId,
      ...event,
    });
  } catch (error) {
    console.error("Error logging audit event:", error);
  }
}

// Subscribe to sessions in real-time
export function subscribeToActiveSessions(
  userId: string,
  callback: (sessions: SessionData[]) => void
): () => void {
  const sessionsRef = ref(rtdb, `sessions/users/${userId}/active`);

  const unsubscribe = onValue(sessionsRef, (snapshot) => {
    if (!snapshot.exists()) {
      callback([]);
    } else {
      const data = snapshot.val();
      const sessions = Object.values(data) as SessionData[];
      callback(sessions);
    }
  });

  return unsubscribe;
}

/**
 * Subscribe to past sessions in real-time
 */
export function subscribeToPastSessions(
  userId: string,
  callback: (sessions: PastSessionData[]) => void
): () => void {
  const pastSessionsRef = ref(rtdb, `sessions/users/${userId}/past`);

  const unsubscribe = onValue(pastSessionsRef, (snapshot) => {
    if (!snapshot.exists()) {
      callback([]);
    } else {
      const data = snapshot.val();
      const sessions = Object.values(data) as PastSessionData[];
      // Sort by endedAt descending
      callback(sessions.sort((a, b) => b.endedAt - a.endedAt));
    }
  });

  return unsubscribe;
}

/**
 * Utility function to format duration in human-readable format
 */
export function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Format timestamp to readable date-time
 */
export function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

/**
 * Get relative time description
 */
export function getRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return formatTimestamp(timestamp);
}
