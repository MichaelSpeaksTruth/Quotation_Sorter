"use client";

import React, { useState, useEffect } from "react";
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

  // Check authentication and load data
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
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

  const splitRelativeTime = (timestamp: number): string => {
    return getRelativeTime(timestamp);
  };

  const formatDate = (timestamp: number): string => {
    return formatTimestamp(timestamp);
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-[#FFFDD0] flex items-center justify-center">
        <p className="text-xl font-black">LOADING...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFFDD0] text-black font-mono overflow-x-hidden flex flex-col">
      {/* Back Button */}
      <div className="p-6 md:p-8">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 px-4 py-2 border-3 border-black bg-white font-black uppercase hover:translate-x-1 hover:translate-y-1 transition-all shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] text-xs md:text-sm"
        >
          ← BACK
        </Link>
      </div>

      {/* Main Content */}
      <div className="flex-1 px-6 md:px-8 pb-12 md:pb-16">
        {/* Header */}
        <div className="mb-8 md:mb-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Avatar */}
            <div className="bg-black border-6 border-black p-6 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]">
              <div className="w-28 h-28 bg-[#FFFDD0] border-6 border-white flex items-center justify-center shadow-[inset_0_0_0_4px_#000]">
                <span className="text-5xl font-black">{getInitials()}</span>
              </div>
              <div className="bg-[#2D5A3D] text-white border-4 border-white px-4 py-2 font-black text-center mt-4">
                <p className="text-xs opacity-70">STATUS</p>
                <p className="text-lg font-black">ACTIVE</p>
              </div>
            </div>

            {/* Quick Info */}
            <div className="md:col-span-2 bg-white border-6 border-black p-6 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]">
              <p className="text-xs font-black opacity-60 mb-2">EMAIL</p>
              <p className="text-lg font-black mb-4 break-all">{user.email}</p>
              <p className="text-xs font-black opacity-60 mb-2">DISPLAY NAME</p>
              <p className="text-lg font-bold">{displayName || user.email}</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-8 md:mb-12 border-4 border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-wrap">
          {(["profile", "security", "activity"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 px-3 py-3 font-black uppercase text-sm border-r-4 border-black transition-all ${
                activeTab === tab
                  ? "bg-black text-white"
                  : "bg-white text-black hover:bg-[#F0F0F0]"
              } ${tab === "activity" ? "border-r-0" : ""}`}
            >
              {tab === "profile" && "👤 PROFILE"}
              {tab === "security" && "🔐 SECURITY"}
              {tab === "activity" && "📊 ACTIVITY"}
            </button>
          ))}
        </div>

        {/* TAB CONTENT */}

        {/* PROFILE TAB */}
        {activeTab === "profile" && (
          <div className="space-y-6">
            {/* Edit Display Name */}
            <div className="bg-white border-6 border-black p-6 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]">
              <div className="flex justify-between items-center mb-4">
                <p className="text-sm font-black opacity-70 uppercase">
                  DISPLAY NAME
                </p>
                {!isEditing && (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="text-xs font-black px-3 py-1 border-2 border-black hover:bg-black hover:text-white transition-all"
                  >
                    EDIT
                  </button>
                )}
              </div>

              {isEditing ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full p-3 border-4 border-black font-black focus:outline-none bg-[#FFFDD0]"
                    placeholder="Enter display name"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveDisplayName}
                      disabled={isSaving}
                      className="flex-1 px-3 py-2 border-4 border-black bg-[#2D5A3D] text-white font-black text-xs hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50"
                    >
                      {isSaving ? "SAVING..." : "SAVE"}
                    </button>
                    <button
                      onClick={() => {
                        setIsEditing(false);
                        setDisplayName(user.displayName || "");
                      }}
                      className="flex-1 px-3 py-2 border-4 border-black bg-white font-black text-xs hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]"
                    >
                      CANCEL
                    </button>
                  </div>
                </div>
              ) : (
                <p className="font-bold text-base">{displayName || user.email}</p>
              )}
            </div>

            {/* Account Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white border-6 border-black p-6 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]">
                <p className="text-xs font-black opacity-70 mb-3 uppercase">
                  ACCOUNT CREATED
                </p>
                <p className="font-bold text-sm">
                  {user.metadata?.creationTime
                    ? formatDate(new Date(user.metadata.creationTime).getTime())
                    : "N/A"}
                </p>
              </div>

              <div className="bg-white border-6 border-black p-6 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]">
                <p className="text-xs font-black opacity-70 mb-3 uppercase">
                  LAST SIGN IN
                </p>
                <p className="font-bold text-sm">
                  {user.metadata?.lastSignInTime
                    ? formatDate(new Date(user.metadata.lastSignInTime).getTime())
                    : "N/A"}
                </p>
              </div>
            </div>

            {/* Change Password */}
            <button
              onClick={() => setShowPasswordModal(true)}
              className="w-full bg-[#2D5A3D] text-white border-6 border-black p-6 font-black uppercase text-sm hover:shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] transition-all shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]"
            >
              🔑 CHANGE PASSWORD
            </button>
          </div>
        )}

        {/* ACTIVITY TAB */}
        {activeTab === "activity" && (
          <div className="space-y-6">
            {/* Active Sessions */}
            <div className="bg-white border-6 border-black p-6 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]">
              <p className="text-sm font-black opacity-70 mb-4 uppercase">
                🖥️ ACTIVE SESSIONS ({activeSessions.length})
              </p>
              <div className="space-y-3">
                {activeSessions && activeSessions.length > 0 ? (
                  activeSessions.map((session) => {
                    const isCurrent = session.id === currentSessionId;
                    const sessionDuration = Date.now() - session.createdAt;
                    return (
                      <div
                        key={session.id}
                        className={`border-4 p-4 ${
                          isCurrent
                            ? "border-[#2D5A3D] bg-[#F0F8F5]"
                            : "border-gray-300"
                        }`}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex-1">
                            <p className="font-black text-xs">
                              {session.os} • {session.browser}
                              {isCurrent && (
                                <span className="ml-2 bg-[#2D5A3D] text-white px-2 py-1 text-xs">
                                  CURRENT
                                </span>
                              )}
                            </p>
                          </div>
                          {!isCurrent && (
                            <button
                              onClick={() => handleLogoutSession(session.id)}
                              className="text-xs font-black border-2 border-black px-2 py-1 hover:bg-black hover:text-white transition-all ml-2"
                            >
                              LOGOUT
                            </button>
                          )}
                        </div>
                        <p className="text-xs font-mono opacity-70 mb-1">
                          🌐 {session.ipAddress}
                        </p>
                        <p className="text-xs opacity-70 mb-1">
                          📍 {session.location}
                        </p>
                        <div className="flex justify-between items-start text-xs opacity-60">
                          <span>Active: {getRelativeTime(session.lastActiveAt)}</span>
                          <span className="font-black bg-[#2D5A3D] text-white px-2 py-1">
                            {formatDuration(sessionDuration)}
                          </span>
                        </div>
                        {session.location && (
                          <p className="text-xs opacity-60 mt-1">
                            📍 Location: {session.location}
                          </p>
                        )}
                        <p className="text-xs opacity-50 mt-1">
                          Started: {formatDate(session.createdAt)}
                        </p>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-xs opacity-70">No active sessions</p>
                )}
              </div>
              {activeSessions.length > 1 && (
                <button
                  onClick={handleLogoutAllSessions}
                  className="w-full mt-4 px-3 py-2 border-3 border-[#D32F2F] text-[#D32F2F] font-black text-xs hover:bg-[#D32F2F] hover:text-white transition-all"
                >
                  LOGOUT ALL DEVICES
                </button>
              )}
            </div>

            {/* Login Activity */}
            <div className="bg-white border-6 border-black p-6 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]">
              <p className="text-sm font-black opacity-70 mb-4 uppercase">
                📋 LAST 5 LOGINS
              </p>
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {loginActivity && loginActivity.length > 0 ? (
                  loginActivity
                    .filter((e: AuditEvent) => e.type === "LOGIN")
                    .slice(0, 5)
                    .map((activity: AuditEvent) => (
                      <div
                        key={activity.id}
                        className="border-l-4 border-black pl-3 pb-3 border-b last:border-b-0"
                      >
                        <div className="flex justify-between items-start mb-2">
                          <p className="text-xs font-black">
                            {activity.status === "success" ? "✓ SUCCESS" : "✗ FAILED"}
                          </p>
                          <span className="text-xs font-mono opacity-70">
                            {activity.ipAddress}
                          </span>
                        </div>
                        <p className="text-xs font-bold mb-1">
                          {activity.device}
                        </p>
                        <p className="text-xs opacity-70 mb-1">
                          {activity.location}
                        </p>
                        <p className="text-xs opacity-60">
                          {formatDate(activity.timestamp)}
                        </p>
                      </div>
                    ))
                ) : (
                  <p className="text-xs opacity-70">No login history yet</p>
                )}
              </div>
            </div>

            {/* Past Sessions */}
            <div className="bg-white border-6 border-black p-6 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]">
              <p className="text-sm font-black opacity-70 mb-4 uppercase">
                🕐 PAST SESSIONS ({pastSessions.length})
              </p>
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {pastSessions && pastSessions.length > 0 ? (
                  pastSessions.slice(0, 10).map((session, idx) => (
                    <div
                      key={session.id}
                      className="border-4 border-gray-300 p-3 bg-gray-50"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <p className="font-black text-xs">
                          {session.device} • {session.browser}
                        </p>
                        <span className="text-xs font-black bg-gray-400 text-white px-2 py-1">
                          {formatDuration(session.duration)}
                        </span>
                      </div>
                      <p className="text-xs font-bold mb-1">
                        📍 {session.location}
                      </p>
                      <p className="text-xs opacity-70 mb-1">
                        IP: <span className="font-mono">{session.ipAddress}</span>
                      </p>
                      {session.locations && session.locations.length > 1 && (
                        <p className="text-xs opacity-60 mb-1">
                          📍 Locations: {session.locations.join(" → ")}
                        </p>
                      )}
                      <p className="text-xs opacity-60">
                        Ended: {formatDate(session.endedAt)}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-xs opacity-70">No past sessions yet</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Danger Zone */}
        <div className="mt-12 pt-8 border-t-6 border-[#D32F2F]">
          <button
            onClick={() => setShowDeleteModal(true)}
            className="w-full bg-[#D32F2F] text-white border-6 border-black p-6 font-black uppercase text-sm hover:shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] transition-all shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]"
          >
            ⚠️ DELETE ACCOUNT
          </button>
        </div>
      </div>

      {/* Sign Out Footer */}
      <div className="px-6 md:px-8 py-6 border-t-6 border-black">
        <button
          onClick={handleSignOut}
          className="w-full bg-[#2D5A3D] text-white border-4 border-black p-4 font-black uppercase text-sm hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] transition-all"
        >
          SIGN OUT
        </button>
      </div>

      {/* Password Change Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
          <div className="bg-white border-8 border-black shadow-[16px_16px_0px_0px_rgba(0,0,0,1)] max-w-sm w-full p-6">
            <h2 className="text-2xl font-black uppercase mb-4">CHANGE PASSWORD</h2>

            <div className="space-y-3 mb-4">
              <div>
                <label className="text-xs font-black uppercase opacity-60 mb-1 block">
                  Current Password
                </label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full p-3 border-4 border-black font-bold focus:outline-none"
                  placeholder="•••••••••"
                />
              </div>
              <div>
                <label className="text-xs font-black uppercase opacity-60 mb-1 block">
                  New Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full p-3 border-4 border-black font-bold focus:outline-none"
                  placeholder="•••••••••"
                />
              </div>
              <div>
                <label className="text-xs font-black uppercase opacity-60 mb-1 block">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full p-3 border-4 border-black font-bold focus:outline-none"
                  placeholder="•••••••••"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowPasswordModal(false);
                  setCurrentPassword("");
                  setNewPassword("");
                  setConfirmPassword("");
                }}
                className="flex-1 px-4 py-2 border-4 border-black bg-white font-black uppercase text-xs hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]"
              >
                CANCEL
              </button>
              <button
                onClick={handleChangePassword}
                disabled={isChangingPassword}
                className="flex-1 px-4 py-2 border-4 border-black bg-[#2D5A3D] text-white font-black uppercase text-xs hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50"
              >
                {isChangingPassword ? "CHANGING..." : "CHANGE"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Account Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
          <div className="bg-white border-8 border-black shadow-[16px_16px_0px_0px_rgba(0,0,0,1)] max-w-sm w-full p-6">
            <h2 className="text-2xl font-black uppercase mb-3 text-[#D32F2F]">
              ⚠️ PERMANENT DELETION
            </h2>

            <p className="font-bold text-sm mb-4">
              This action cannot be undone. All your data will be deleted forever.
            </p>

            <div className="mb-4">
              <label className="text-xs font-black uppercase opacity-60 mb-2 block">
                Enter Your Password
              </label>
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                className="w-full p-3 border-4 border-black font-bold focus:outline-none"
                placeholder="•••••••••"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeletePassword("");
                }}
                className="flex-1 px-4 py-2 border-4 border-black bg-white font-black uppercase text-xs hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]"
              >
                CANCEL
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={isDeleting || !deletePassword}
                className="flex-1 px-4 py-2 border-4 border-black bg-[#D32F2F] text-white font-black uppercase text-xs hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50"
              >
                {isDeleting ? "DELETING..." : "DELETE"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
