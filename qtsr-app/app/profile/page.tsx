"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import {
  onAuthStateChanged,
  User as FirebaseUser,
  updateProfile,
  signOut,
  reauthenticateWithCredential,
  EmailAuthProvider,
  deleteUser,
  updatePassword,
} from "firebase/auth";
import Link from "next/link";
import {
  SessionData,
  PastSessionData,
  AuditEvent,
  getActiveSessions,
  getPastSessions,
  logoutSession,
  logoutAllSessions,
  getLoginHistory,
  getDeviceInfo,
  getIPAddressAndLocation,
  formatDuration,
  formatTimestamp,
  getRelativeTime,
} from "@/lib/sessionService";
import { useSessionHeartbeat } from "@/lib/useSessionHeartbeat";
import {
  SecuritySettings,
  logPasswordChange,
} from "@/lib/securityService";

type TabType = "profile" | "security" | "activity";

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   CYBERNETIC HUD TERMINAL â€” PROFILE CONSOLE
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("profile");
  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [loading, setLoading] = useState(true);
  
  // Password change state
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Real data from Firebase
  const [activeSessions, setActiveSessions] = useState<SessionData[]>([]);
  const [pastSessions, setPastSessions] = useState<PastSessionData[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>();
  const [loginActivity, setLoginActivity] = useState<AuditEvent[]>([]);

  // â”€â”€ CYBERNETIC HUD STATE â”€â”€
  const [diagnosticActive, setDiagnosticActive] = useState(false);
  const [diagnosticProgress, setDiagnosticProgress] = useState(0);
  const [diagnosticLogs, setDiagnosticLogs] = useState<string[]>([]);
  const [integrityValue] = useState(99.8);
  const [hudTime, setHudTime] = useState("");

  // Check authentication and load data
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        setUser(null); // Resolves permission denied error by unsubscribing before auth token invalidation
        router.push("/login");
      } else {
        setUser(currentUser);
        setDisplayName(currentUser.displayName || "");

        // Get current session ID from localStorage
        const sessionId = localStorage.getItem("currentSessionId");
        if (sessionId) {
          setCurrentSessionId(sessionId);
          console.log(`[PROFILE] Current session ID from storage: ${sessionId}`);
        }

        // Fetch sessions and security data
        try {
          console.log(`[PROFILE] Loading data for user ${currentUser.uid}...`);
          
          const sessions = await getActiveSessions(currentUser.uid);
          console.log(`[PROFILE] Found ${sessions.length} active sessions`);
          setActiveSessions(sessions || []);

          // If no session ID from storage, use the first active session as current
          if (!sessionId && sessions && sessions.length > 0) {
            setCurrentSessionId(sessions[0].id);
            localStorage.setItem("currentSessionId", sessions[0].id);
          }

          const past = await getPastSessions(currentUser.uid, 10);
          console.log(`[PROFILE] Found ${past.length} past sessions`);
          setPastSessions(past || []);

          const auditHistory = await getLoginHistory(currentUser.uid, 5);
          console.log(`[PROFILE] Found ${auditHistory.length} recent logins`);
          setLoginActivity(auditHistory || []);
        } catch (error) {
          console.error("[PROFILE] Error loading profile data:", error);
          alert("Warning: Could not load all profile data. Please refresh if needed.");
        }

        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [router]);

  // Live clock for HUD
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setHudTime(now.toLocaleTimeString("en-US", { hour12: false }) + "." + String(now.getMilliseconds()).padStart(3, "0"));
    };
    tick();
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, []);

  // Diagnostic scan sequence
  useEffect(() => {
    if (!diagnosticActive) return;

    const logs = [
      "[SYS_INIT] Bootstrapping credential matrix scan...",
      "[AUTH_VRF] Verifying Firebase authentication token integrity...",
      "[NET_SCAN] Scanning active session handshake protocols...",
      "[SEC_CHK] Validating encryption key rotation cycles...",
      "[DB_SYNC] Cross-referencing Firestore permission lattice...",
      "[CMP_ALG] Executing compliance adjudication algorithms...",
      "[HASH_VRF] Verifying SHA-256 credential hashes...",
      "[NODE_OK] All adjudication nodes responding nominal.",
      `[REPORT] System integrity: ${integrityValue}% â€” ALL CLEAR`,
    ];

    let i = 0;
    setDiagnosticLogs([]);
    setDiagnosticProgress(0);

    const interval = setInterval(() => {
      if (i < logs.length) {
        setDiagnosticLogs((prev) => [...prev, logs[i]]);
        setDiagnosticProgress(Math.round(((i + 1) / logs.length) * 100));
        i++;
      } else {
        clearInterval(interval);
        setTimeout(() => {
          setDiagnosticActive(false);
          setDiagnosticProgress(0);
          setDiagnosticLogs([]);
        }, 4000);
      }
    }, 550);

    return () => clearInterval(interval);
  }, [diagnosticActive, integrityValue]);

  // Use session heartbeat to keep session active (every 2 minutes)
  useSessionHeartbeat({
    userId: user?.uid,
    sessionId: currentSessionId,
    enabled: !!user,
  });

  const handleSaveDisplayName = async () => {
    if (!user) return;
    setIsSaving(true);

    try {
      await updateProfile(user, {
        displayName: displayName.trim() || user.email,
      });
      setUser({ ...user, displayName: displayName.trim() || user.email });
      setIsEditing(false);
    } catch (error) {
      console.error("Error updating profile:", error);
      alert("Failed to update profile");
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!user || !currentPassword || !newPassword || !confirmPassword) {
      alert("Please fill all fields");
      return;
    }

    if (newPassword !== confirmPassword) {
      alert("New passwords do not match");
      return;
    }

    setIsChangingPassword(true);

    try {
      const credential = EmailAuthProvider.credential(
        user.email!,
        currentPassword
      );
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);

      // Log the password change to audit trail
      const { browser, os } = getDeviceInfo();
      const { ip: ipAddress, location } = await getIPAddressAndLocation(true);
      await logPasswordChange(
        user.uid,
        ipAddress,
        `${os} - ${browser}`
      );

      // Refresh login activity
      const auditHistory = await getLoginHistory(user.uid, 10);
      setLoginActivity(auditHistory || []);

      alert("Password changed successfully");
      setShowPasswordModal(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      console.error("Error changing password:", error);
      alert("Failed to change password. Please check your current password.");
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user || !deletePassword) {
      alert("Please enter your password");
      return;
    }

    setIsDeleting(true);

    try {
      const credential = EmailAuthProvider.credential(
        user.email!,
        deletePassword
      );
      await reauthenticateWithCredential(user, credential);
      await deleteUser(user);
      router.push("/login");
    } catch (error) {
      console.error("Error deleting account:", error);
      alert("Failed to delete account. Please check your password.");
    } finally {
      setIsDeleting(false);
      setDeletePassword("");
      setShowDeleteModal(false);
    }
  };

  const handleSignOut = async () => {
    try {
      // Clear current session ID from localStorage
      localStorage.removeItem("currentSessionId");
      console.log(`[PROFILE] Cleared current session ID from storage`);
      
      await signOut(auth);
      router.push("/login");
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  // 2FA has been removed
  const handleEnable2FA = async () => {
    console.log("[PROFILE] 2FA removed from application");
  };

  // 2FA has been removed
  const handleDisable2FA = async () => {
    console.log("[PROFILE] 2FA removed from application");
  };

  const handleLogoutSession = async (sessionId: string) => {
    if (!user) return;

    try {
      console.log(`[PROFILE] Logging out session ${sessionId}...`);
      await logoutSession(user.uid, sessionId);
      
      // Refresh session list
      const sessions = await getActiveSessions(user.uid);
      console.log(`[PROFILE] After logout, ${sessions.length} sessions remain`);
      setActiveSessions(sessions || []);

      // Refresh past sessions
      const past = await getPastSessions(user.uid, 10);
      setPastSessions(past || []);

      alert("Session terminated successfully");
    } catch (error) {
      console.error("[PROFILE] Error logging out session:", error);
      alert("Failed to logout session");
    }
  };

  const handleLogoutAllSessions = async () => {
    if (!user) return;
    const confirm = window.confirm(
      "This will log you out from all devices. You will need to log in again. Continue?"
    );
    if (!confirm) return;

    try {
      await logoutAllSessions(user.uid);
      await signOut(auth);
      router.push("/login");
    } catch (error) {
      console.error("Error logging out all sessions:", error);
      alert("Failed to logout from all devices");
    }
  };

  const getInitials = (): string => {
    if (user?.displayName) {
      return user.displayName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
    return (user?.email?.[0] || "U").toUpperCase();
  };

  const formatDate = (timestamp: number): string => {
    return formatTimestamp(timestamp);
  };

  // Integrity gauge SVG calculation
  const integrityCircumference = 2 * Math.PI * 38;
  const integrityOffset = integrityCircumference - (integrityCircumference * integrityValue) / 100;

  // Tab labels for HUD
  const tabConfig: { id: TabType; label: string; icon: React.ReactNode }[] = [
    {
      id: "profile",
      label: "SYS_PROFILE",
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
    },
    {
      id: "security",
      label: "SEC_CREDENTIALS",
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      ),
    },
    {
      id: "activity",
      label: "AUDIT_TRAIL",
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2z" />
        </svg>
      ),
    },
  ];

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ LOADING STATE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  if (loading || !user) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-6 relative">
        <div className="absolute inset-0 hud-grid-bg pointer-events-none" />
        <div className="relative">
          <svg viewBox="0 0 120 120" className="w-24 h-24">
            <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(20,184,166,0.1)" strokeWidth="2" />
            <circle
              cx="60" cy="60" r="50" fill="none" stroke="rgba(20,184,166,0.6)" strokeWidth="2"
              strokeDasharray="80 240"
              style={{ transformOrigin: "center", animation: "hud-rotate-cw 1.5s linear infinite" }}
            />
            <circle
              cx="60" cy="60" r="38" fill="none" stroke="rgba(6,182,212,0.4)" strokeWidth="1.5"
              strokeDasharray="40 200"
              style={{ transformOrigin: "center", animation: "hud-rotate-ccw 2s linear infinite" }}
            />
          </svg>
        </div>
        <p className="font-mono text-[10px] font-bold tracking-[0.25em] text-teal-500/60 uppercase crt-glow">
          Initializing Profile Terminal...
        </p>
      </div>
    );
  }

  /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     MAIN CYBERNETIC HUD RENDER
     â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
  return (
    <div className="relative w-full min-h-full hud-scanline">
      {/* â”€â”€ ATMOSPHERIC GRID BACKGROUND â”€â”€ */}
      <div className="absolute inset-0 hud-grid-bg pointer-events-none" />

      {/* â”€â”€ Floating particles â”€â”€ */}
      {[12, 28, 45, 62, 78, 88].map((left, i) => (
        <div
          key={i}
          className="hud-particle"
          style={{
            left: `${left}%`,
            top: `${15 + i * 12}%`,
            animationDelay: `${i * 0.8}s`,
            animationDuration: `${5 + i * 1.2}s`,
          }}
        />
      ))}

      {/* â•â•â• CONTENT LAYER â•â•â• */}
      <div className="relative z-10 w-full flex flex-col gap-8 pb-20">

        {/* â”€â”€ COMMAND BAR / NAVIGATION â”€â”€ */}
        <div className="flex items-center justify-between border-b border-teal-500/10 pb-4">
          <Link
            href="/dashboard"
            className="group inline-flex items-center gap-2.5 px-4 py-2 border border-teal-500/20 bg-black/30 backdrop-blur-sm font-mono text-[10px] font-bold tracking-[0.15em] uppercase text-teal-500/70 hover:text-teal-400 hover:border-teal-500/40 transition-all duration-200 cursor-pointer active:scale-95"
          >
            <svg className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span className="text-teal-500/40 mr-1">â†</span> RETURN://DASHBOARD
          </Link>

          <div className="hidden sm:flex items-center gap-4 font-mono text-[9px] tracking-[0.2em] uppercase text-zinc-600 select-none">
            <span className="text-teal-500/30 crt-glow">{hudTime}</span>
            <span className="text-zinc-700">â”‚</span>
            <span>SYS://PROFILE_CONSOLE</span>
          </div>
        </div>

        {/* â”€â”€ HERO SECTION: AVATAR CORE + METRICS GRID â”€â”€ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* â–¸ AVATAR ADJUDICATION CORE */}
          <div className="hud-card neon-border-teal p-6 flex flex-col items-center gap-5">
            {/* Rotating SVG Ring System */}
            <div className="relative">
              <svg viewBox="0 0 200 200" className="w-44 h-44 sm:w-48 sm:h-48">
                {/* Ring 3 â€” Outermost â€” Slow CW with tick marks */}
                <g style={{ transformOrigin: "100px 100px", animation: "hud-rotate-cw 45s linear infinite" }}>
                  <circle cx="100" cy="100" r="95" fill="none" stroke="rgba(20,184,166,0.08)" strokeWidth="0.5" />
                  {Array.from({ length: 60 }).map((_, i) => (
                    <line
                      key={`tick-${i}`}
                      x1="100" y1={i % 5 === 0 ? "5" : "8"}
                      x2="100" y2="14"
                      stroke={i % 5 === 0 ? "rgba(20,184,166,0.4)" : "rgba(20,184,166,0.15)"}
                      strokeWidth={i % 5 === 0 ? "1.5" : "0.5"}
                      transform={`rotate(${i * 6} 100 100)`}
                    />
                  ))}
                </g>

                {/* Ring 2 â€” Middle â€” CCW dashed */}
                <g style={{ transformOrigin: "100px 100px", animation: "hud-rotate-ccw 18s linear infinite" }}>
                  <circle
                    cx="100" cy="100" r="78"
                    fill="none"
                    stroke="rgba(6,182,212,0.25)"
                    strokeWidth="2"
                    strokeDasharray="16 8 4 8"
                    strokeLinecap="round"
                  />
                </g>

                {/* Ring 1 â€” Inner â€” CW dotted */}
                <g style={{ transformOrigin: "100px 100px", animation: "hud-rotate-cw 22s linear infinite" }}>
                  <circle
                    cx="100" cy="100" r="63"
                    fill="none"
                    stroke="rgba(20,184,166,0.3)"
                    strokeWidth="1.5"
                    strokeDasharray="3 9"
                  />
                </g>

                {/* Crosshair lines */}
                <line x1="100" y1="35" x2="100" y2="45" stroke="rgba(20,184,166,0.2)" strokeWidth="0.5" />
                <line x1="100" y1="155" x2="100" y2="165" stroke="rgba(20,184,166,0.2)" strokeWidth="0.5" />
                <line x1="35" y1="100" x2="45" y2="100" stroke="rgba(20,184,166,0.2)" strokeWidth="0.5" />
                <line x1="155" y1="100" x2="165" y2="100" stroke="rgba(20,184,166,0.2)" strokeWidth="0.5" />

                {/* Center core circle */}
                <circle cx="100" cy="100" r="48" fill="rgba(20,184,166,0.04)" stroke="rgba(20,184,166,0.3)" strokeWidth="1.5" />
                <circle cx="100" cy="100" r="46" fill="rgba(9,9,11,0.8)" stroke="none" />

                {/* Initials */}
                <text
                  x="100" y="106"
                  textAnchor="middle"
                  fill="rgb(20,184,166)"
                  fontSize="30"
                  fontWeight="800"
                  fontFamily="Inter, sans-serif"
                  style={{ filter: "drop-shadow(0 0 12px rgba(20,184,166,0.5))" }}
                >
                  {getInitials()}
                </text>
              </svg>

              {/* Corner brackets */}
              <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-teal-500/30 rounded-tl" />
              <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-teal-500/30 rounded-tr" />
              <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-teal-500/30 rounded-bl" />
              <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-teal-500/30 rounded-br" />
            </div>

            {/* Operational Status Badge */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/8 border border-emerald-500/20">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" style={{ boxShadow: "0 0 8px rgba(16,185,129,0.6)" }} />
              <span className="font-mono text-[10px] font-bold tracking-[0.2em] uppercase text-emerald-400 crt-glow">
                OPERATIONAL
              </span>
            </div>

            {/* Diagnostic Scan Button */}
            <button
              onClick={() => !diagnosticActive && setDiagnosticActive(true)}
              disabled={diagnosticActive}
              className="w-full mt-1 px-4 py-2.5 border border-teal-500/20 bg-teal-500/5 hover:bg-teal-500/10 hover:border-teal-500/35 text-teal-400/80 hover:text-teal-300 font-mono text-[10px] font-bold tracking-[0.15em] uppercase transition-all duration-200 cursor-pointer active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {diagnosticActive ? (
                <>
                  <svg className="w-3.5 h-3.5" style={{ animation: "hud-rotate-cw 1s linear infinite" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  SCANNING... {diagnosticProgress}%
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  INITIATE DIAGNOSTIC SCAN
                </>
              )}
            </button>
          </div>

          {/* â–¸ METRICS CONSOLE GRID */}
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Email Credential */}
            <div className="hud-card p-5 border-l-2 border-l-teal-500/40">
              <p className="hud-label mb-2.5">EMAIL_CREDENTIAL</p>
              <p className="hud-value break-all">{user.email}</p>
              <div className="mt-3 flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-teal-500/50" />
                <span className="font-mono text-[9px] text-teal-500/40 tracking-wider">VERIFIED</span>
              </div>
            </div>

            {/* Identity Alias */}
            <div className="hud-card p-5 border-l-2 border-l-cyan-500/40">
              <p className="hud-label mb-2.5">IDENTITY_ALIAS</p>
              <p className="hud-value">{displayName || "UNREGISTERED"}</p>
              <div className="mt-3 flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-cyan-500/50" />
                <span className="font-mono text-[9px] text-cyan-500/40 tracking-wider">ACTIVE</span>
              </div>
            </div>

            {/* Genesis Timestamp */}
            <div className="hud-card p-5 border-l-2 border-l-violet-500/40">
              <p className="hud-label mb-2.5">GENESIS_TIMESTAMP</p>
              <p className="font-mono text-xs font-bold text-zinc-300 leading-none">
                {user.metadata?.creationTime
                  ? formatDate(new Date(user.metadata.creationTime).getTime())
                  : "N/A"}
              </p>
              <div className="mt-3 flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-violet-500/50" />
                <span className="font-mono text-[9px] text-violet-500/40 tracking-wider">ORIGIN</span>
              </div>
            </div>

            {/* Last Auth Event */}
            <div className="hud-card p-5 border-l-2 border-l-amber-500/40">
              <p className="hud-label mb-2.5">LAST_AUTH_EVENT</p>
              <p className="font-mono text-xs font-bold text-zinc-300 leading-none">
                {user.metadata?.lastSignInTime
                  ? formatDate(new Date(user.metadata.lastSignInTime).getTime())
                  : "N/A"}
              </p>
              <div className="mt-3 flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-amber-500/50" />
                <span className="font-mono text-[9px] text-amber-500/40 tracking-wider">RECENT</span>
              </div>
            </div>

            {/* System Integrity Gauge */}
            <div className="sm:col-span-2 hud-card p-5 flex items-center gap-6">
              <div className="relative shrink-0">
                <svg viewBox="0 0 100 100" className="w-20 h-20">
                  <circle cx="50" cy="50" r="38" fill="none" stroke="rgba(20,184,166,0.08)" strokeWidth="6" />
                  <circle
                    cx="50" cy="50" r="38" fill="none"
                    stroke="rgba(20,184,166,0.7)"
                    strokeWidth="6"
                    strokeDasharray={integrityCircumference}
                    strokeDashoffset={integrityOffset}
                    strokeLinecap="round"
                    transform="rotate(-90 50 50)"
                    style={{ filter: "drop-shadow(0 0 6px rgba(20,184,166,0.4))", transition: "stroke-dashoffset 1.5s ease" }}
                  />
                  <text x="50" y="48" textAnchor="middle" fill="rgb(20,184,166)" fontSize="16" fontWeight="800" fontFamily="Inter, sans-serif">
                    {integrityValue}
                  </text>
                  <text x="50" y="60" textAnchor="middle" fill="rgba(20,184,166,0.5)" fontSize="7" fontWeight="700" fontFamily="JetBrains Mono, monospace">
                    PERCENT
                  </text>
                </svg>
              </div>
              <div className="flex-1">
                <p className="hud-label mb-2">SYSTEM_INTEGRITY_INDEX</p>
                <p className="text-xs text-zinc-400 font-medium leading-relaxed">
                  All adjudication nodes responding. Credential matrix verified. Firebase token rotation nominal.
                </p>
                <div className="mt-3 flex items-center gap-3 flex-wrap">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/15 text-emerald-400 font-mono text-[9px] font-bold tracking-wider">
                    <span className="h-1 w-1 rounded-full bg-emerald-500 animate-pulse" /> VERIFIED BUILD
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-teal-500/10 border border-teal-500/15 text-teal-400 font-mono text-[9px] font-bold tracking-wider">
                    BTECH/10173/24
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* â”€â”€ DIAGNOSTIC SCANNER OUTPUT â”€â”€ */}
        {diagnosticActive && diagnosticLogs.length > 0 && (
          <div className="hud-card neon-border-teal overflow-hidden">
            {/* Progress bar */}
            <div className="h-1 w-full bg-zinc-900">
              <div
                className="h-full bg-teal-500/70 transition-all duration-500 ease-out"
                style={{ width: `${diagnosticProgress}%`, boxShadow: "0 0 12px rgba(20,184,166,0.5)" }}
              />
            </div>
            {/* Terminal output */}
            <div className="hud-terminal p-4 max-h-52 border-0 rounded-none">
              <p className="text-teal-500/40 mb-2 select-none">C:\SYS\DIAGNOSTIC_SWEEP&gt; EXEC scan_all --verbose</p>
              {diagnosticLogs.map((log, i) => (
                <p key={i} className="text-teal-400/80" style={{ animation: "data-cascade 0.4s ease-out forwards" }}>
                  <span className="text-teal-500/30 select-none">{String(i + 1).padStart(2, "0")}â”‚ </span>
                  {log}
                </p>
              ))}
              {diagnosticProgress < 100 && (
                <span className="inline-block w-1.5 h-3.5 bg-teal-500/60 ml-0.5" style={{ animation: "blink-cursor 1s step-end infinite" }} />
              )}
              {diagnosticProgress === 100 && (
                <p className="text-emerald-400 font-bold mt-2 crt-glow">
                  âœ“ DIAGNOSTIC COMPLETE â€” ALL SYSTEMS NOMINAL
                </p>
              )}
            </div>
          </div>
        )}

        {/* â”€â”€ TAB CONTROL SYSTEM â”€â”€ */}
        <div className="flex p-1 gap-1 bg-black/40 backdrop-blur-sm border border-teal-500/10 max-w-2xl select-none">
          {tabConfig.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-2.5 px-3 font-mono text-[10px] font-bold tracking-[0.12em] uppercase transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer active:scale-95 ${
                activeTab === tab.id
                  ? "bg-teal-500/10 text-teal-400 border border-teal-500/25 shadow-[0_0_15px_rgba(20,184,166,0.08)]"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-white/3 border border-transparent"
              }`}
            >
              <span className={activeTab === tab.id ? "text-teal-400" : "text-zinc-600"}>
                {activeTab === tab.id ? "[â—]" : "[â—‹]"}
              </span>
              <span className="hidden sm:inline">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* â•â•â•â•â•â•â• TAB CONTENT â•â•â•â•â•â•â• */}

        {/* â”€â”€ PROFILE TAB â”€â”€ */}
        {activeTab === "profile" && (
          <div className="space-y-6">
            {/* Edit Display Name */}
            <div className="hud-card p-6">
              <div className="flex justify-between items-center mb-5">
                <p className="hud-label flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 text-teal-500/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                  IDENTITY_ALIAS_CONFIG
                </p>
                {!isEditing && (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-teal-500/20 hover:border-teal-500/40 hover:bg-teal-500/5 text-teal-400/70 hover:text-teal-300 font-mono font-bold text-[10px] tracking-wider uppercase transition-all cursor-pointer active:scale-95 duration-150"
                  >
                    MODIFY
                  </button>
                )}
              </div>

              {isEditing ? (
                <div className="space-y-3 max-w-md">
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full px-4 py-2.5 border border-teal-500/20 bg-black/40 text-teal-100 text-sm font-mono focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20 focus:outline-none transition-all placeholder:text-zinc-600"
                    placeholder="Enter identity alias..."
                  />
                  <div className="flex gap-2.5">
                    <button
                      onClick={handleSaveDisplayName}
                      disabled={isSaving}
                      className="flex-1 px-4 py-2.5 bg-teal-500/15 hover:bg-teal-500/25 border border-teal-500/30 text-teal-300 font-mono font-bold text-[10px] uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer active:scale-95 duration-150"
                    >
                      {isSaving ? "WRITING..." : "COMMIT_SAVE"}
                    </button>
                    <button
                      onClick={() => {
                        setIsEditing(false);
                        setDisplayName(user.displayName || "");
                      }}
                      className="flex-1 px-4 py-2.5 border border-zinc-700 hover:border-zinc-600 hover:bg-white/3 text-zinc-400 font-mono font-bold text-[10px] uppercase tracking-wider transition-all cursor-pointer active:scale-95 duration-150"
                    >
                      ABORT
                    </button>
                  </div>
                </div>
              ) : (
                <p className="hud-value text-base">{displayName || "UNREGISTERED"}</p>
              )}
            </div>

            {/* System Integrity & Credits */}
            <div className="hud-card p-6">
              <h3 className="hud-label flex items-center gap-2 mb-5">
                <svg className="w-4 h-4 text-teal-500/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                SYSTEM_INTEGRITY_&_ATTRIBUTION
              </h3>
              <div className="text-xs text-zinc-400 leading-relaxed font-medium space-y-3">
                <p>
                  QuoteAnalyzer is a production-grade procurement platform built with Next.js, Tailwind CSS v4, and Firebase. It evaluates technical compliance criteria and automates vendor adjudication mathematically.
                </p>
                <div className="hud-terminal p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-[10px]">
                    <div>
                      <span className="text-teal-500/40">CORE_DEV:</span>{" "}
                      <span className="font-bold text-teal-300">Anurag Kumar Verma</span>
                    </div>
                    <div>
                      <span className="text-teal-500/40">AFFILIATION:</span>{" "}
                      <span className="font-bold text-teal-300">BTECH/10173/24</span>
                    </div>
                    <div className="inline-flex items-center gap-1.5 bg-emerald-500/10 text-emerald-400 px-2.5 py-1 border border-emerald-500/15 font-bold text-[9px] uppercase tracking-wider leading-none">
                      <span className="h-1 w-1 rounded-full bg-emerald-500 animate-pulse" />
                      VERIFIED BUILD
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* â”€â”€ SECURITY TAB â”€â”€ */}
        {activeTab === "security" && (
          <div className="space-y-6">
            <div className="hud-card p-6">
              <h3 className="hud-label flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 text-teal-500/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
                ENCRYPTION_KEY_MANAGEMENT
              </h3>
              <p className="text-xs text-zinc-500 mb-6 font-medium leading-relaxed">
                Rotate authentication credentials periodically to maintain encryption integrity across procurement workspaces.
              </p>

              {/* Key Visual */}
              <div className="flex items-center gap-4 mb-6 p-4 bg-black/30 border border-teal-500/10">
                <div className="w-12 h-12 bg-teal-500/8 border border-teal-500/20 flex items-center justify-center">
                  <svg className="w-6 h-6 text-teal-500/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs font-bold text-zinc-300">Password Authentication</p>
                  <p className="font-mono text-[10px] text-zinc-500 mt-1">SHA-256 Â· Salt-hashed Â· Firebase Auth Provider</p>
                </div>
              </div>

              <button
                onClick={() => setShowPasswordModal(true)}
                className="inline-flex items-center gap-2.5 px-5 py-3 bg-teal-500/10 hover:bg-teal-500/20 border border-teal-500/25 hover:border-teal-500/45 text-teal-300 font-mono font-bold text-[10px] uppercase tracking-[0.15em] transition-all shadow-sm cursor-pointer active:scale-95 duration-150"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
                ROTATE CREDENTIAL KEY
              </button>
            </div>
          </div>
        )}

        {/* â”€â”€ ACTIVITY TAB â”€â”€ */}
        {activeTab === "activity" && (
          <div className="space-y-6">

            {/* Active Sessions - CRT Terminal */}
            <div className="hud-card overflow-hidden">
              <div className="px-5 py-4 border-b border-teal-500/10 flex items-center justify-between">
                <p className="hud-label flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-teal-500/50 animate-pulse" />
                  ACTIVE_DEVICE_SESSIONS ({activeSessions.length})
                </p>
                {activeSessions.length > 1 && (
                  <button
                    onClick={handleLogoutAllSessions}
                    className="px-3 py-1.5 border border-rose-500/20 hover:border-rose-500/40 hover:bg-rose-500/10 text-rose-400/70 hover:text-rose-300 font-mono text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer active:scale-95"
                  >
                    TERMINATE_ALL_REMOTE
                  </button>
                )}
              </div>

              <div className="hud-terminal p-0 max-h-[420px] border-0 rounded-none">
                <div className="px-4 py-2 border-b border-teal-500/5 text-teal-500/30 select-none text-[10px]">
                  C:\SYS\SESSION_MONITOR&gt; LIST --active --verbose
                </div>

                <div className="p-4 space-y-3">
                  {activeSessions && activeSessions.length > 0 ? (
                    activeSessions.map((session) => {
                      const isCurrent = session.id === currentSessionId;
                      const sessionDuration = Date.now() - session.createdAt;
                      return (
                        <div
                          key={session.id}
                          className={`rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 transition-all duration-200 ${
                            isCurrent
                              ? "bg-teal-500/5 border border-teal-500/20"
                              : "bg-white/[0.02] border border-zinc-800/50 hover:border-zinc-700/50"
                          }`}
                        >
                          <div className="flex-1 flex gap-3.5 items-start">
                            {/* Device icon */}
                            <div className={`p-2.5 border mt-0.5 ${
                              isCurrent
                                ? "bg-teal-500/8 border-teal-500/20 text-teal-400"
                                : "bg-zinc-900 border-zinc-800 text-zinc-500"
                            }`}>
                              {session.device.toLowerCase().includes("mobile") ? (
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                </svg>
                              ) : (
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                </svg>
                              )}
                            </div>

                            <div>
                              <div className="flex items-center gap-2 flex-wrap select-none">
                                <span className="text-sm font-bold text-zinc-200 leading-none">
                                  {session.os} â€¢ {session.browser}
                                </span>
                                {isCurrent && (
                                  <span className="inline-flex items-center gap-1 bg-teal-500/10 text-teal-400 px-2 py-0.5 text-[9px] font-bold border border-teal-500/20 uppercase tracking-wider font-mono leading-none">
                                    THIS_DEVICE
                                  </span>
                                )}
                              </div>
                              <div className="mt-2.5 space-y-1 font-mono text-[10px] text-zinc-500 leading-tight">
                                <p><span className="text-teal-500/30">IP:</span> {session.ipAddress}</p>
                                <p><span className="text-teal-500/30">LOC:</span> {session.location}</p>
                                <p className="mt-2 flex items-center gap-1.5 text-zinc-400">
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  Active {getRelativeTime(session.lastActiveAt)} Â· Uptime: {formatDuration(sessionDuration)}
                                </p>
                              </div>
                            </div>
                          </div>

                          {!isCurrent && (
                            <button
                              onClick={() => handleLogoutSession(session.id)}
                              className="px-3.5 py-2 border border-rose-500/20 hover:border-rose-500/40 hover:bg-rose-500/10 text-rose-400/70 hover:text-rose-300 font-mono font-bold text-[9px] uppercase tracking-wider transition-all cursor-pointer self-start sm:self-auto active:scale-95 duration-150"
                            >
                              TERMINATE
                            </button>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-zinc-600 font-mono text-[10px] py-4">[EMPTY] No active device sessions detected</p>
                  )}
                </div>
              </div>
            </div>

            {/* Recent Sign-In History */}
            <div className="hud-card overflow-hidden">
              <div className="px-5 py-4 border-b border-teal-500/10">
                <p className="hud-label flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 text-teal-500/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  AUTH_EVENT_LOG (LAST 5)
                </p>
              </div>

              <div className="hud-terminal p-0 max-h-80 border-0 rounded-none">
                <div className="px-4 py-2 border-b border-teal-500/5 text-teal-500/30 select-none text-[10px]">
                  C:\SYS\AUDIT_TRAIL&gt; QUERY auth_events --limit 5 --sort desc
                </div>
                <div className="p-4 space-y-2.5">
                  {loginActivity && loginActivity.length > 0 ? (
                    loginActivity
                      .filter((e: AuditEvent) => e.type === "LOGIN")
                      .slice(0, 5)
                      .map((activity: AuditEvent, idx: number) => (
                        <div
                          key={activity.id}
                          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-2.5 border-b border-teal-500/5 last:border-0"
                        >
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-teal-500/20 text-[10px] select-none w-5">{String(idx + 1).padStart(2, "0")}</span>
                            <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[9px] font-bold font-mono tracking-wider leading-none ${
                              activity.status === "success"
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/15"
                                : "bg-rose-500/10 text-rose-400 border border-rose-500/15"
                            }`}>
                              {activity.status === "success" ? "OK" : "FAIL"}
                            </span>
                            <span className="text-xs font-bold text-zinc-300 leading-none">
                              {activity.device}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 font-mono text-[10px] text-zinc-500 sm:text-right">
                            <span>{activity.ipAddress}</span>
                            <span className="text-zinc-600">â”‚</span>
                            <span className="text-zinc-400">{formatDate(activity.timestamp)}</span>
                          </div>
                        </div>
                      ))
                  ) : (
                    <p className="text-zinc-600 font-mono text-[10px] py-4">[EMPTY] No authentication events recorded</p>
                  )}
                </div>
              </div>
            </div>

            {/* Past Sessions (Closed) */}
            <div className="hud-card overflow-hidden">
              <div className="px-5 py-4 border-b border-teal-500/10">
                <p className="hud-label flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                  </svg>
                  WORKSPACE_ARCHIVE (CLOSED SESSIONS)
                </p>
              </div>

              <div className="hud-terminal p-0 max-h-80 border-0 rounded-none">
                <div className="px-4 py-2 border-b border-teal-500/5 text-teal-500/30 select-none text-[10px]">
                  C:\SYS\SESSION_ARCHIVE&gt; LIST --closed --limit 10
                </div>
                <div className="p-4 space-y-2.5">
                  {pastSessions && pastSessions.length > 0 ? (
                    pastSessions.slice(0, 10).map((session, idx) => (
                      <div
                        key={session.id}
                        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-3 border-b border-teal-500/5 last:border-0"
                      >
                        <div className="flex items-start gap-3">
                          <span className="font-mono text-zinc-700 text-[10px] select-none w-5 mt-0.5">{String(idx + 1).padStart(2, "0")}</span>
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2 select-none">
                              <span className="text-xs font-bold text-zinc-400 leading-none">
                                {session.device} â€¢ {session.browser}
                              </span>
                              <span className="inline-flex items-center gap-1 rounded bg-zinc-800/60 px-2 py-0.5 text-[9px] font-bold text-zinc-500 border border-zinc-700/30 uppercase font-mono leading-none">
                                CLOSED
                              </span>
                            </div>
                            <p className="text-[10px] text-zinc-600 font-mono">
                              <span className="text-teal-500/20">LOC:</span> {session.location} <span className="text-zinc-700">â”‚</span> <span className="text-teal-500/20">IP:</span> {session.ipAddress}
                            </p>
                          </div>
                        </div>

                        <div className="sm:text-right font-mono select-none flex items-center gap-3">
                          <span className="text-[9px] font-bold text-zinc-500 bg-zinc-800/40 px-2 py-0.5 rounded border border-zinc-700/20">
                            {formatDuration(session.duration)}
                          </span>
                          <span className="text-[10px] text-zinc-600">{formatDate(session.endedAt)}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-zinc-600 font-mono text-[10px] py-4">[EMPTY] No archived sessions found</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* â•â•â• DANGER ZONE â€” CORE SHUTDOWN PROTOCOL â•â•â• */}
        <div className="mt-12 pt-8 border-t border-rose-500/10">
          <div className="hud-card-danger neon-border-red p-6">
            <h3 className="flex items-center gap-2.5 mb-3">
              <svg className="w-4 h-4 text-rose-500/80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="font-mono text-[10px] font-bold tracking-[0.2em] uppercase text-rose-400/90 crt-glow">
                SYS_CRITICAL: CORE SHUTDOWN PROTOCOL
              </span>
            </h3>
            <p className="text-xs text-zinc-500 font-medium mb-5 ml-6 leading-relaxed">
              Initiating account deletion will permanently destroy all workspaces, database events, session archives, and compliance reports. This action is irreversible and cannot be recovered.
            </p>

            <button
              onClick={() => setShowDeleteModal(true)}
              className="ml-6 inline-flex items-center gap-2 px-5 py-2.5 border border-rose-500/25 hover:border-rose-500/50 hover:bg-rose-500/10 text-rose-400/80 hover:text-rose-300 font-mono font-bold text-[10px] uppercase tracking-[0.15em] transition-all cursor-pointer active:scale-95 duration-150"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              INITIATE COLD SHUTDOWN
            </button>
          </div>
        </div>

        {/* â•â•â• SIGN OUT â€” SESSION TERMINATION â•â•â• */}
        <div className="mt-6">
          <button
            onClick={handleSignOut}
            className="w-full py-4 bg-zinc-900/60 backdrop-blur-sm border border-zinc-700/50 hover:border-teal-500/30 hover:bg-zinc-800/60 text-zinc-300 hover:text-teal-300 font-mono font-bold text-[10px] uppercase tracking-[0.2em] transition-all cursor-pointer flex items-center justify-center gap-3 active:scale-[0.98] duration-150 group"
          >
            <svg className="w-4.5 h-4.5 transition-transform group-hover:-translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            â» TERMINATE CURRENT SESSION
          </button>
        </div>
      </div>

      {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
         MODALS â€” CYBERNETIC HUD OVERLAYS
         â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}

      {/* Password Change Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4" style={{ animation: "data-cascade 0.3s ease-out" }}>
          <div className="hud-card neon-border-teal max-w-sm w-full p-0 overflow-hidden">
            {/* Modal header bar */}
            <div className="px-6 py-4 border-b border-teal-500/10 bg-teal-500/[0.03]">
              <h2 className="text-base font-bold text-teal-100 leading-tight flex items-center gap-2">
                <svg className="w-4 h-4 text-teal-500/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
                KEY_ROTATION
              </h2>
              <p className="text-[10px] text-zinc-500 font-mono mt-1.5 tracking-wider">ENCRYPT &gt; VERIFY &gt; COMMIT</p>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="hud-label block mb-2">CURRENT_KEY</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-4 py-2.5 border border-teal-500/15 bg-black/50 text-teal-100 text-sm font-mono focus:border-teal-500/40 focus:outline-none focus:ring-1 focus:ring-teal-500/15 transition-all placeholder:text-zinc-700"
                  placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
                />
              </div>
              <div>
                <label className="hud-label block mb-2">NEW_KEY</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-2.5 border border-teal-500/15 bg-black/50 text-teal-100 text-sm font-mono focus:border-teal-500/40 focus:outline-none focus:ring-1 focus:ring-teal-500/15 transition-all placeholder:text-zinc-700"
                  placeholder="Min. 6 characters"
                />
              </div>
              <div>
                <label className="hud-label block mb-2">CONFIRM_KEY</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-2.5 border border-teal-500/15 bg-black/50 text-teal-100 text-sm font-mono focus:border-teal-500/40 focus:outline-none focus:ring-1 focus:ring-teal-500/15 transition-all placeholder:text-zinc-700"
                  placeholder="Re-enter key"
                />
              </div>
            </div>

            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={() => {
                  setShowPasswordModal(false);
                  setCurrentPassword("");
                  setNewPassword("");
                  setConfirmPassword("");
                }}
                className="flex-1 px-4 py-2.5 border border-zinc-700 hover:border-zinc-600 hover:bg-white/3 text-zinc-400 font-mono font-bold text-[10px] uppercase tracking-wider transition-all cursor-pointer active:scale-95 duration-150"
              >
                ABORT
              </button>
              <button
                onClick={handleChangePassword}
                disabled={isChangingPassword}
                className="flex-1 px-4 py-2.5 bg-teal-500/15 hover:bg-teal-500/25 border border-teal-500/30 text-teal-300 font-mono font-bold text-[10px] uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer active:scale-95 duration-150"
              >
                {isChangingPassword ? "ENCRYPTING..." : "COMMIT_KEY"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Account Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4" style={{ animation: "data-cascade 0.3s ease-out" }}>
          <div className="hud-card-danger neon-border-red max-w-sm w-full p-0 overflow-hidden">
            {/* Modal header */}
            <div className="px-6 py-4 border-b border-rose-500/10 bg-rose-500/[0.03]">
              <h2 className="text-base font-bold text-rose-300 leading-tight flex items-center gap-2">
                <svg className="w-5 h-5 text-rose-500/80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                CORE_SHUTDOWN
              </h2>
              <p className="text-[10px] text-zinc-500 font-mono mt-1.5 tracking-wider">âš  IRREVERSIBLE OPERATION</p>
            </div>

            <div className="px-6 py-5">
              <p className="text-xs text-zinc-400 mb-5 font-medium leading-relaxed">
                This action cannot be undone. All session data, workspaces, and authentication records will be permanently destroyed.
              </p>
              <div>
                <label className="hud-label block mb-2">CONFIRM_AUTHORIZATION_KEY</label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  className="w-full px-4 py-2.5 border border-rose-500/15 bg-black/50 text-rose-100 text-sm font-mono focus:border-rose-500/40 focus:outline-none focus:ring-1 focus:ring-rose-500/15 transition-all placeholder:text-zinc-700"
                  placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
                />
              </div>
            </div>

            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeletePassword("");
                }}
                className="flex-1 px-4 py-2.5 border border-zinc-700 hover:border-zinc-600 hover:bg-white/3 text-zinc-400 font-mono font-bold text-[10px] uppercase tracking-wider transition-all cursor-pointer active:scale-95 duration-150"
              >
                ABORT
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={isDeleting || !deletePassword}
                className="flex-1 px-4 py-2.5 bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 font-mono font-bold text-[10px] uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer active:scale-95 duration-150"
              >
                {isDeleting ? "WIPING..." : "EXECUTE SHUTDOWN"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
