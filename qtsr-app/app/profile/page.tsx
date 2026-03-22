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
  AuditEvent,
  getActiveSessions,
  logoutSession,
  logoutAllSessions,
  getLoginHistory,
  getDeviceInfo,
  getIPAddressAndLocation,
} from "@/lib/sessionService";
import {
  SecuritySettings,
  getSecuritySettings,
  enable2FA,
  disable2FA,
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
  const [loginActivity, setLoginActivity] = useState<AuditEvent[]>([]);
  const [securitySettings, setSecuritySettings] = useState<SecuritySettings | null>(
    null
  );
  const [isEnabling2FA, setIsEnabling2FA] = useState(false);
  const [showBackupCodes, setShowBackupCodes] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  // Check authentication and load data
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        router.push("/login");
      } else {
        setUser(currentUser);
        setDisplayName(currentUser.displayName || "");

        // Fetch sessions and security data
        try {
          const sessions = await getActiveSessions(currentUser.uid);
          setActiveSessions(sessions);

          const auditHistory = await getLoginHistory(currentUser.uid, 10);
          setLoginActivity(auditHistory);

          const settings = await getSecuritySettings(currentUser.uid);
          setSecuritySettings(settings);
        } catch (error) {
          console.error("Error loading profile data:", error);
        }

        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [router]);

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
      const { ip: ipAddress } = await getIPAddressAndLocation();
      await logPasswordChange(
        user.uid,
        ipAddress,
        `${os} - ${browser}`
      );

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
      await signOut(auth);
      router.push("/login");
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  const handleEnable2FA = async () => {
    if (!user) return;
    setIsEnabling2FA(true);

    try {
      const { device, browser } = getDeviceInfo();
      const { ip: ipAddress } = await getIPAddressAndLocation();

      const result = await enable2FA(
        user.uid,
        "authenticator",
        ipAddress,
        `${device} - ${browser}`
      );

      setBackupCodes(result.backupCodes);
      setShowBackupCodes(true);

      // Refresh security settings
      const settings = await getSecuritySettings(user.uid);
      setSecuritySettings(settings);

      alert("2FA enabled successfully!");
    } catch (error) {
      console.error("Error enabling 2FA:", error);
      alert("Failed to enable 2FA");
    } finally {
      setIsEnabling2FA(false);
    }
  };

  const handleDisable2FA = async () => {
    if (!user) return;
    const confirmDisable = window.confirm(
      "Are you sure you want to disable 2FA? This reduces your account security."
    );
    if (!confirmDisable) return;

    try {
      const { device, browser } = getDeviceInfo();
      const { ip: ipAddress } = await getIPAddressAndLocation();

      await disable2FA(user.uid, ipAddress, `${device} - ${browser}`);

      // Refresh security settings
      const settings = await getSecuritySettings(user.uid);
      setSecuritySettings(settings);

      alert("2FA disabled successfully");
    } catch (error) {
      console.error("Error disabling 2FA:", error);
      alert("Failed to disable 2FA");
    }
  };

  const handleLogoutSession = async (sessionId: string) => {
    if (!user) return;

    try {
      await logoutSession(user.uid, sessionId);
      const sessions = await getActiveSessions(user.uid);
      setActiveSessions(sessions);
      alert("Session terminated");
    } catch (error) {
      console.error("Error logging out session:", error);
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

  const formatDate = (date: Date): string => {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  const formatRelativeTime = (timestamp: number): string => {
    const diff = Date.now() - timestamp;
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (hours < 1) return "Just now";
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return formatDate(new Date(timestamp));
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
                    ? formatDate(new Date(user.metadata.creationTime))
                    : "N/A"}
                </p>
              </div>

              <div className="bg-white border-6 border-black p-6 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]">
                <p className="text-xs font-black opacity-70 mb-3 uppercase">
                  LAST SIGN IN
                </p>
                <p className="font-bold text-sm">
                  {user.metadata?.lastSignInTime
                    ? formatDate(new Date(user.metadata.lastSignInTime))
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

        {/* SECURITY TAB */}
        {activeTab === "security" && (
          <div className="space-y-6">
            {/* 2FA */}
            <div className="bg-white border-6 border-black p-6 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]">
              <div className="flex justify-between items-center mb-3">
                <p className="text-sm font-black opacity-70">
                  TWO-FACTOR AUTHENTICATION
                </p>
                <span
                  className={`px-3 py-1 text-xs font-black ${
                    securitySettings?.twoFactorEnabled
                      ? "bg-[#2D5A3D] text-white"
                      : "bg-[#D32F2F] text-white"
                  }`}
                >
                  {securitySettings?.twoFactorEnabled ? "ENABLED" : "DISABLED"}
                </span>
              </div>
              <p className="text-xs font-bold mb-4 opacity-80">
                Add an extra security layer to your account with 2FA.
              </p>
              {securitySettings?.twoFactorEnabled ? (
                <button
                  onClick={handleDisable2FA}
                  className="px-4 py-2 border-3 border-[#D32F2F] text-[#D32F2F] bg-white font-black text-xs hover:bg-[#D32F2F] hover:text-white transition-all"
                >
                  DISABLE 2FA
                </button>
              ) : (
                <button
                  onClick={handleEnable2FA}
                  disabled={isEnabling2FA}
                  className="px-4 py-2 border-3 border-[#2D5A3D] text-[#2D5A3D] bg-white font-black text-xs hover:bg-[#2D5A3D] hover:text-white transition-all disabled:opacity-50"
                >
                  {isEnabling2FA ? "ENABLING..." : "ENABLE 2FA"}
                </button>
              )}
            </div>

            {/* Backup Codes Modal */}
            {showBackupCodes && (
              <div className="bg-[#FFF3CD] border-6 border-black p-6 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]">
                <p className="text-sm font-black mb-4 uppercase">⚠️ BACKUP CODES</p>
                <p className="text-xs font-bold mb-4 opacity-80">
                  Save these codes in a safe place. Each code can be used once if you lose access to 2FA.
                </p>
                <div className="bg-black text-white p-4 mb-4 font-mono text-xs space-y-1">
                  {backupCodes.map((code, idx) => (
                    <p key={idx}>{code}</p>
                  ))}
                </div>
                <button
                  onClick={() => setShowBackupCodes(false)}
                  className="px-4 py-2 border-3 border-black bg-white font-black text-xs hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]"
                >
                  CLOSE
                </button>
              </div>
            )}

            {/* Security Events */}
            <div className="bg-white border-6 border-black p-6 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]">
              <p className="text-sm font-black opacity-70 mb-4 uppercase">
                RECENT SECURITY EVENTS
              </p>
              <div className="space-y-3 max-h-48 overflow-y-auto">
                {loginActivity && loginActivity.length > 0 ? (
                  loginActivity
                    .filter(
                      (e: AuditEvent) =>
                        e.type === "PASSWORD_CHANGE" ||
                        e.type === "2FA_ENABLED" ||
                        e.type === "2FA_DISABLED"
                    )
                    .slice(0, 5)
                    .map((event: AuditEvent) => (
                      <div
                        key={event.id}
                        className="border-l-4 border-[#2D5A3D] pl-3 pb-3 border-b last:border-b-0"
                      >
                        <p className="text-xs font-black">
                          ✓{" "}
                          {event.type === "PASSWORD_CHANGE"
                            ? "PASSWORD CHANGED"
                            : event.type === "2FA_ENABLED"
                            ? "2FA ENABLED"
                            : "2FA DISABLED"}
                        </p>
                        <p className="text-xs opacity-70">
                          {formatRelativeTime(event.timestamp)} · {event.location}
                        </p>
                      </div>
                    ))
                ) : (
                  <p className="text-xs opacity-70">No security events yet</p>
                )}
              </div>
            </div>
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
                  activeSessions.map((session, idx) => (
                    <div
                      key={session.id}
                      className={`border-4 p-4 ${
                        idx === 0
                          ? "border-[#2D5A3D] bg-[#F0F8F5]"
                          : "border-gray-300"
                      }`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <p className="font-black text-xs">
                          {session.device} • {session.browser}
                          {idx === 0 && (
                            <span className="ml-2 bg-[#2D5A3D] text-white px-2 py-1 text-xs">
                              CURRENT
                            </span>
                          )}
                        </p>
                        {idx !== 0 && (
                          <button
                            onClick={() => handleLogoutSession(session.id)}
                            className="text-xs font-black border-2 border-black px-2 py-1 hover:bg-black hover:text-white transition-all"
                          >
                            LOGOUT
                          </button>
                        )}
                      </div>
                      <p className="text-xs opacity-70 mb-1">
                        IP: {session.ipAddress}
                      </p>
                      <p className="text-xs opacity-70">
                        {session.location} · Last active:{" "}
                        {formatRelativeTime(session.lastActiveAt)}
                      </p>
                    </div>
                  ))
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
                📋 LOGIN HISTORY
              </p>
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {loginActivity && loginActivity.length > 0 ? (
                  loginActivity
                    .filter((e: AuditEvent) => e.type === "LOGIN")
                    .map((activity: AuditEvent) => (
                      <div
                        key={activity.id}
                        className="border-l-4 border-black pl-3 pb-3 border-b last:border-b-0"
                      >
                        <div className="flex justify-between items-start mb-1">
                          <p className="text-xs font-black">
                            {activity.status === "success" ? "✓" : "✗"}{" "}
                            {activity.status.toUpperCase()}
                          </p>
                          <span className="text-xs opacity-70">
                            {activity.ipAddress}
                          </span>
                        </div>
                        <p className="text-xs font-bold mb-1">
                          {activity.device} • {activity.browser}
                        </p>
                        <p className="text-xs opacity-70">
                          {formatRelativeTime(activity.timestamp)} ·{" "}
                          {activity.location}
                        </p>
                      </div>
                    ))
                ) : (
                  <p className="text-xs opacity-70">No login history yet</p>
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
