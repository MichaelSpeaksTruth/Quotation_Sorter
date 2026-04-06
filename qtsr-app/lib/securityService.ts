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

/**
 * Placeholder function - 2FA functionality removed
 */
export async function enable2FA(
  userId: string,
  method: "authenticator" | "sms" | "email",
  ipAddress: string,
  device: string,
  email?: string
): Promise<{ backupCodes: string[]; totpSecret?: string; qrCodeUrl?: string; enabled: boolean }> {
  throw new Error("2FA functionality has been removed from this application");
}

/**
 * Placeholder function - 2FA functionality removed
 */
export async function disable2FA(
  userId: string,
  ipAddress: string,
  device: string
): Promise<void> {
  throw new Error("2FA functionality has been removed from this application");
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

// Placeholder for removed 2FA backup code generation
function generateBackupCodes(count: number): string[] {
  return [];
}

/**
 * Placeholder function kept for backwards compatibility
 * 2FA has been removed from this application
 */
export async function verifyBackupCode(
  userId: string,
  code: string
): Promise<boolean> {
  return false;
}

/**
 * Placeholder function kept for backwards compatibility
 * 2FA has been removed from this application
 */
export async function generateTOTPSecret(
  userId: string,
  email: string
): Promise<{ secret: string; qrCodeUrl: string }> {
  try {
    // @ts-ignore - speakeasy types not available
    const speakeasy = await import("speakeasy");
    // @ts-ignore - qrcode types not available
    const QRCode = await import("qrcode");

    console.log(`[2FA] Generating TOTP secret for user ${userId}...`);

    // Generate secret
    const secret = speakeasy.generateSecret({
      name: `Quotation Sorter (${email})`,
      issuer: "Quotation Sorter",
      length: 32,
    });

    // Generate QR code
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url || "");

    console.log(`[2FA] TOTP secret generated successfully`);
    return {
      secret: secret.base32,
      qrCodeUrl,
    };
  } catch (error: any) {
    console.error("[2FA] Error generating TOTP secret:", error);
    throw error;
  }
}

/**
 * Verify TOTP code (Time-based One-Time Password)
 * For authenticator apps like Google Authenticator, Authy, Microsoft Authenticator
 * Uses speakeasy library for proper TOTP verification with time window tolerance
 */
export async function verify2FACode(
  userId: string,
  code: string,
  secret?: string
): Promise<boolean> {
  try {
    console.log(`[2FA] Verifying TOTP code for user ${userId}...`);

    if (!code || code.length !== 6 || !/^\d+$/.test(code)) {
      console.warn("[2FA] Invalid code format");
      return false;
    }

    const settingsRef = ref(rtdb, `security/users/${userId}/settings`);
    const snapshot = await get(settingsRef);
    const settings = snapshot.val() as SecuritySettings | null;

    if (!settings?.twoFactorEnabled) {
      console.warn("[2FA] 2FA not enabled for this user");
      return false;
    }

    // If secret passed, use it; otherwise try to get from settings (note: secrets shouldn't be in client)
    // This is a security consideration - totpSecret should be verified server-side
    const totpSecret = secret || (settings as any)?.totpSecret;

    if (!totpSecret) {
      console.error("[2FA] No TOTP secret found for user");
      return false;
    }

    try {
      // @ts-ignore - speakeasy types not available
      const speakeasy = await import("speakeasy");

      // Verify TOTP code with time window tolerance (±2 steps = ~1 minute)
      const verified = speakeasy.totp.verify({
        secret: totpSecret,
        encoding: "base32",
        token: code,
        window: 2, // Allow ±2 time windows (30 seconds each = ±1 minute)
      });

      if (verified) {
        console.log("[2FA] TOTP code verified successfully");
        return true;
      } else {
        console.warn("[2FA] TOTP code verification failed - code does not match");
        return false;
      }
    } catch (totpError: any) {
      console.error("[2FA] TOTP verification error:", totpError);
      return false;
    }
  } catch (error: any) {
    console.error("[2FA] Error verifying 2FA code:", error);
    return false;
  }
}

/**
 * Verify and use backup code
 * Returns validation result and remaining backup code count
 */
export async function useBackupCode(
  userId: string,
  code: string
): Promise<{ valid: boolean; remainingCodes: number }> {
  try {
    console.log(`[2FA] Checking backup code for user ${userId}...`);

    const settingsRef = ref(rtdb, `security/users/${userId}/settings`);
    const snapshot = await get(settingsRef);
    const settings = snapshot.val() as SecuritySettings;

    console.log(`[2FA] Settings snapshot:`, settings);

    if (!settings) {
      console.warn("[2FA] No settings found for user");
      return { valid: false, remainingCodes: 0 };
    }

    let backupCodes = settings.backupCodes;
    
    // Ensure backup codes is an array
    if (!Array.isArray(backupCodes)) {
      console.warn("[2FA] Backup codes is not an array. Type:", typeof backupCodes, "Value:", backupCodes);
      if (typeof backupCodes === 'object' && backupCodes !== null) {
        // Firebase might return it as an object with numeric keys
        backupCodes = Object.values(backupCodes as Record<string, string>);
        console.log("[2FA] Converted to array:", backupCodes);
      } else {
        console.warn("[2FA] No backup codes available");
        return { valid: false, remainingCodes: 0 };
      }
    }

    if (!backupCodes || backupCodes.length === 0) {
      console.warn("[2FA] No backup codes available");
      return { valid: false, remainingCodes: 0 };
    }

    // Log what codes exist in database
    console.log(`[2FA] Codes in database (count: ${backupCodes.length}):`, backupCodes);
    console.log(`[2FA] User entered code: "${code}"`);

    // Normalize code for comparison (remove spaces, uppercase)
    const normalizedInput = code.toUpperCase().replace(/\s/g, "");
    console.log(`[2FA] Normalized input: "${normalizedInput}"`);

    const codeIndex = backupCodes.findIndex((c: string) => {
      const normalizedDb = String(c).toUpperCase().replace(/\s/g, "");
      const match = normalizedDb === normalizedInput;
      console.log(`[2FA] Comparing "${normalizedDb}" (db) === "${normalizedInput}" (input) ? ${match}`);
      return match;
    });

    if (codeIndex === -1) {
      console.warn("[2FA] Backup code not found or invalid. No matches found.");
      return { valid: false, remainingCodes: backupCodes.length };
    }

    // Remove used code
    const updatedCodes = [
      ...backupCodes.slice(0, codeIndex),
      ...backupCodes.slice(codeIndex + 1),
    ];

    console.log(`[2FA] Backup code valid. Removing and updating...`);
    
    // Update settings to remove the used code
    await update(settingsRef, {
      backupCodes: updatedCodes.length > 0 ? updatedCodes : null,
    });

    console.log(`[2FA] Backup code consumed. ${updatedCodes.length} codes remaining.`);
    
    return { valid: true, remainingCodes: updatedCodes.length };
  } catch (error: any) {
    console.error("[2FA] Error using backup code:", error);
    console.error("[2FA] Error details:", error?.code, error?.message);
    return { valid: false, remainingCodes: 0 };
  }
}
