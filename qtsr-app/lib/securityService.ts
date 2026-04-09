/**
 * Security Service
 * Handles account security settings and password management
 */

import { ref, set, get, update, remove } from "firebase/database";
import { rtdb } from "./firebase";
import { logAuditEvent, getIPAddressAndLocation } from "./sessionService";

export interface SecuritySettings {
  userId: string;
  lastPasswordChange: number;
  lastPasswordChangeIP?: string;
  lastPasswordChangeDevice?: string;
}

export interface SecurityEvent {
  id: string;
  type: "PASSWORD_CHANGE" | "EMAIL_CHANGE";
  timestamp: number;
  ipAddress: string;
  device: string;
  location: string;
  status: "success" | "failed";
  details?: string;
}

// Get security settings
export async function getSecuritySettings(
  userId: string
): Promise<SecuritySettings | null> {
  try {
    if (!userId) {
      console.warn("[SECURITY] Cannot get settings: userId is missing");
      return null;
    }

    const settingsRef = ref(rtdb, `security/users/${userId}/settings`);
    console.log(`[SECURITY] Reading settings from: security/users/${userId}/settings`);
    
    const snapshot = await get(settingsRef);

    if (!snapshot.exists()) {
      console.log(`[SECURITY] No settings found, creating defaults...`);
      
      // Create default settings
      const defaultSettings: SecuritySettings = {
        userId,
        lastPasswordChange: Date.now(),
      };

      console.log(`[SECURITY] Writing default settings...`);
      await set(settingsRef, defaultSettings);
      return defaultSettings;
    }

    const settings = snapshot.val() as SecuritySettings;
    
    console.log(`[SECURITY] Settings loaded successfully`, settings);
    return settings;
  } catch (error: any) {
    console.error("[SECURITY] Error fetching security settings:", error);
    console.error("[SECURITY] Error code:", error?.code);
    console.error("[SECURITY] Error message:", error?.message);
    return null;
  }
}



// Log password change
export async function logPasswordChange(
  userId: string,
  ipAddress: string,
  device: string
): Promise<void> {
  try {
    const settingsRef = ref(rtdb, `security/users/${userId}/settings`);
    const snapshot = await get(settingsRef);
    const currentSettings = snapshot.val() || {};

    await set(settingsRef, {
      ...currentSettings,
      lastPasswordChange: Date.now(),
      lastPasswordChangeIP: ipAddress,
      lastPasswordChangeDevice: device,
    });

    // Log audit event
    await logAuditEvent(userId, {
      type: "PASSWORD_CHANGE",
      ipAddress,
      device,
      location: "India",
      timestamp: Date.now(),
      status: "success",
      details: "Password changed successfully",
    });
  } catch (error) {
    console.error("Error logging password change:", error);
    throw error;
  }
}

// Get security events
export async function getSecurityEvents(
  userId: string,
  limit: number = 10
): Promise<SecurityEvent[]> {
  try {
    const eventsRef = ref(rtdb, `security/users/${userId}/events`);
    const snapshot = await get(eventsRef);

    if (!snapshot.exists()) {
      return [];
    }

    const data = snapshot.val();
    const events = Object.values(data) as SecurityEvent[];

    // Sort by timestamp descending and limit
    return events.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  } catch (error) {
    console.error("Error fetching security events:", error);
    return [];
  }
}


