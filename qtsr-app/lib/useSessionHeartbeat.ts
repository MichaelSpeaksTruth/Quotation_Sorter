/**
 * Session Heartbeat Hook
 * Keeps track of session activity by updating lastActiveAt every 2 minutes
 * Also checks for location changes
 */

import { useEffect, useRef } from "react";
import { updateSessionActivity, getIPAddressAndLocation } from "./sessionService";

const HEARTBEAT_INTERVAL = 2 * 60 * 1000; // 2 minutes

interface UseSessionHeartbeatOptions {
  userId: string | undefined;
  sessionId: string | undefined;
  enabled?: boolean;
}

/**
 * Hook to maintain session activity by sending heartbeat
 * Updates the lastActiveAt timestamp and tracks location changes
 */
export function useSessionHeartbeat({
  userId,
  sessionId,
  enabled = true,
}: UseSessionHeartbeatOptions): void {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastLocationRef = useRef<string | null>(null);

  useEffect(() => {
    // Only run if userId and sessionId are available
    if (!enabled || !userId || !sessionId) {
      return;
    }

    console.log(
      `[HEARTBEAT] Starting session heartbeat for session: ${sessionId}`
    );

    // Initial activity update
    const updateActivity = async () => {
      try {
        const { ip: ipAddress, location } = await getIPAddressAndLocation(
          true
        );

        // Check if location changed
        let locationChanged = false;
        if ((lastLocationRef.current || "") !== location) {
          locationChanged = true;
          lastLocationRef.current = location;
        }

        // Update session activity
        await updateSessionActivity(userId, sessionId, location);

        if (locationChanged) {
          console.log(`[HEARTBEAT] Location changed to: ${location}`);
        } else {
          console.log(`[HEARTBEAT] Session ${sessionId} heartbeat sent`);
        }
      } catch (error) {
        console.error("[HEARTBEAT] Error updating session activity:", error);
      }
    };

    // Send initial heartbeat immediately
    updateActivity();

    // Set up interval for every 2 minutes
    intervalRef.current = setInterval(() => {
      updateActivity();
    }, HEARTBEAT_INTERVAL);

    // Cleanup on unmount or when dependencies change
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        console.log(`[HEARTBEAT] Session heartbeat stopped for: ${sessionId}`);
      }
    };
  }, [userId, sessionId, enabled]);
}

/**
 * Hook to check for inactive sessions and move them to past sessions
 * Useful for cleaning up stale sessions
 */
export function useSessionInactivityChecker(
  userId: string | undefined,
  sessionId: string | undefined,
  inactivityTimeout: number = 30 * 60 * 1000 // 30 minutes default
): void {
  const lastActivityRef = useRef<number>(Date.now());
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!userId || !sessionId) {
      return;
    }

    // Update last activity on user interaction
    const handleActivity = () => {
      lastActivityRef.current = Date.now();
    };

    // Listen for user activity
    const events = [
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "click",
    ];

    events.forEach((event) => {
      document.addEventListener(event, handleActivity);
    });

    // Check for inactivity periodically
    intervalRef.current = setInterval(async () => {
      const timeSinceLastActivity = Date.now() - lastActivityRef.current;

      if (timeSinceLastActivity > inactivityTimeout) {
        console.warn(
          `[ACTIVITY] Session ${sessionId} has been inactive for ${timeSinceLastActivity / 1000}s`
        );
        // Could trigger logout or session end here
      }
    }, 5 * 60 * 1000); // Check every 5 minutes

    // Cleanup
    return () => {
      events.forEach((event) => {
        document.removeEventListener(event, handleActivity);
      });
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [userId, sessionId, inactivityTimeout]);
}
