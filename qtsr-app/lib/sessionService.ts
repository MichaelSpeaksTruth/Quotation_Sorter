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

export interface AuditEvent {
  id: string;
  userId: string;
  type: "LOGIN" | "LOGOUT" | "PASSWORD_CHANGE" | "2FA_ENABLED" | "2FA_DISABLED" | "SESSION_LOGOUT";
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
let cachedGeoData: { ip: string; location: string } | null = null;

export async function getIPAddressAndLocation(): Promise<{
  ip: string;
  location: string;
}> {
  // Return cached data if available (to avoid excessive API calls)
  if (cachedGeoData) {
    return cachedGeoData;
  }

  try {
    // Use ipapi.co - free IP geolocation service with 30k requests/month
    // Alternative: use ip-api.com for high accuracy
    const response = await fetch("https://ipapi.co/json/", { 
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) throw new Error("Geolocation API failed");

    const data = await response.json();
    const ip = data.ip || "0.0.0.0";
    const location = `${data.city || "Unknown"}, ${data.country_name || "Unknown"}`;

    // Cache for 5 minutes to avoid excessive API calls
    cachedGeoData = { ip, location };
    setTimeout(() => {
      cachedGeoData = null;
    }, 5 * 60 * 1000);

    return { ip, location };
  } catch (error) {
    console.error("Failed to fetch geolocation:", error);
    // Fallback to defaults
    return { ip: "0.0.0.0", location: "Unknown Location" };
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
    const sessionsRef = ref(rtdb, `sessions/users/${userId}/active`);
    const snapshot = await get(sessionsRef);

    if (!snapshot.exists()) {
      return [];
    }

    const data = snapshot.val();
    return Object.values(data) as SessionData[];
  } catch (error) {
    console.error("Error fetching sessions:", error);
    return [];
  }
}

// Update session last active time
export async function updateSessionActivity(
  userId: string,
  sessionId: string
): Promise<void> {
  const sessionRef = ref(
    rtdb,
    `sessions/users/${userId}/active/${sessionId}/lastActiveAt`
  );
  await set(sessionRef, Date.now());
}

// Logout from specific device
export async function logoutSession(
  userId: string,
  sessionId: string
): Promise<void> {
  const sessionRef = ref(rtdb, `sessions/users/${userId}/active/${sessionId}`);
  await remove(sessionRef);
}

// Logout from all devices
export async function logoutAllSessions(userId: string): Promise<void> {
  const sessionsRef = ref(rtdb, `sessions/users/${userId}/active`);
  await remove(sessionsRef);
}

// Get login history
export async function getLoginHistory(
  userId: string,
  limit: number = 10
): Promise<AuditEvent[]> {
  try {
    const auditRef = ref(rtdb, `audit/users/${userId}/events`);
    const auditQuery = query(
      auditRef,
      orderByChild("timestamp"),
      limitToLast(limit)
    );

    const snapshot = await get(auditQuery);

    if (!snapshot.exists()) {
      return [];
    }

    const data = snapshot.val();
    const events = Object.values(data) as AuditEvent[];
    return events.reverse(); // Most recent first
  } catch (error) {
    console.error("Error fetching audit history:", error);
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
