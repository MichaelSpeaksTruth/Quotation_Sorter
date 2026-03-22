/**
 * Security Service
 * Handles 2FA, security events, and account security settings
 */

import { ref, set, get, remove } from "firebase/database";
import { rtdb } from "./firebase";
import { logAuditEvent } from "./sessionService";

export interface SecuritySettings {
  userId: string;
  twoFactorEnabled: boolean;
  twoFactorMethod?: "authenticator" | "sms" | "email";
  backupCodes?: string[];
  lastPasswordChange: number;
  lastPasswordChangeIP?: string;
  lastPasswordChangeDevice?: string;
}

export interface SecurityEvent {
  id: string;
  type: "PASSWORD_CHANGE" | "2FA_ENABLE" | "2FA_DISABLE" | "EMAIL_CHANGE";
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
    const settingsRef = ref(rtdb, `security/users/${userId}/settings`);
    const snapshot = await get(settingsRef);

    if (!snapshot.exists()) {
      // Create default settings
      const defaultSettings: SecuritySettings = {
        userId,
        twoFactorEnabled: false,
        lastPasswordChange: Date.now(),
      };

      await set(settingsRef, defaultSettings);
      return defaultSettings;
    }

    return snapshot.val() as SecuritySettings;
  } catch (error) {
    console.error("Error fetching security settings:", error);
    return null;
  }
}

// Enable 2FA
export async function enable2FA(
  userId: string,
  method: "authenticator" | "sms" | "email",
  ipAddress: string,
  device: string
): Promise<{ backupCodes: string[]; enabled: boolean }> {
  try {
    // Generate backup codes
    const backupCodes = generateBackupCodes(5);

    const settingsRef = ref(rtdb, `security/users/${userId}/settings`);
    await set(settingsRef, {
      twoFactorEnabled: true,
      twoFactorMethod: method,
      backupCodes,
    });

    // Log security event
    await logAuditEvent(userId, {
      type: "2FA_ENABLED",
      ipAddress,
      device,
      location: "India",
      timestamp: Date.now(),
      status: "success",
      details: `2FA enabled via ${method}`,
    });

    return { backupCodes, enabled: true };
  } catch (error) {
    console.error("Error enabling 2FA:", error);
    throw error;
  }
}

// Disable 2FA
export async function disable2FA(
  userId: string,
  ipAddress: string,
  device: string
): Promise<void> {
  try {
    const settingsRef = ref(rtdb, `security/users/${userId}/settings`);
    await set(settingsRef, {
      twoFactorEnabled: false,
      twoFactorMethod: undefined,
    });

    // Log security event
    await logAuditEvent(userId, {
      type: "2FA_DISABLED",
      ipAddress,
      device,
      location: "India",
      timestamp: Date.now(),
      status: "success",
      details: "2FA disabled",
    });
  } catch (error) {
    console.error("Error disabling 2FA:", error);
    throw error;
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

// Generate backup codes
function generateBackupCodes(count: number): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = Math.random()
      .toString(36)
      .substring(2, 10)
      .toUpperCase()
      .replace(/[0OIL]/g, (char) => {
        const replacements: { [key: string]: string } = { O: "8", I: "9", L: "1", "0": "2" };
        return replacements[char];
      });
    codes.push(code);
  }
  return codes;
}

// Verify backup code (mark as used)
export async function verifyBackupCode(
  userId: string,
  code: string
): Promise<boolean> {
  try {
    const settingsRef = ref(rtdb, `security/users/${userId}/settings`);
    const snapshot = await get(settingsRef);
    const settings = snapshot.val() as SecuritySettings;

    if (!settings?.backupCodes) return false;

    const codeIndex = settings.backupCodes.indexOf(code);
    if (codeIndex === -1) return false;

    // Remove used code
    const updatedCodes = [
      ...settings.backupCodes.slice(0, codeIndex),
      ...settings.backupCodes.slice(codeIndex + 1),
    ];

    await set(ref(rtdb, `security/users/${userId}/settings/backupCodes`), updatedCodes);
    return true;
  } catch (error) {
    console.error("Error verifying backup code:", error);
    return false;
  }
}
