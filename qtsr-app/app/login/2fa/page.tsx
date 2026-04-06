'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { auth } from '@/lib/firebase';
import { getSecuritySettings, verify2FACode, useBackupCode } from '@/lib/securityService';
import { createSession, getDeviceInfo, getIPAddressAndLocation, logAuditEvent } from '@/lib/sessionService';
import Link from 'next/link';

function TwoFactorPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [code, setCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [remainingAttempts, setRemainingAttempts] = useState(5);
  const [timeRemaining, setTimeRemaining] = useState(300); // 5 minutes
  
  const userId = searchParams.get("userId");
  const email = searchParams.get("email");

  // Countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          // Code expired
          router.push("/login");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [router]);

  // Format time remaining
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!userId || !email) {
      setError("Invalid session. Please log in again.");
      router.push("/login");
      return;
    }

    const requiredLength = useBackup ? 8 : 6;
    if (!code.trim() || code.length !== requiredLength) {
      setError(useBackup ? "Please enter an 8-character backup code" : "Please enter a valid 6-digit code");
      return;
    }
    console.log(`[2FA] Code validation passed: "${code}" (length: ${code.length}, mode: ${useBackup ? "backup" : "authenticator"})`);

    setIsVerifying(true);
    setError("");

    try {
      console.log(`[2FA] Verifying ${useBackup ? "backup" : "2FA"} code for user ${userId}...`);

      if (useBackup) {
        // Verify backup code
        console.log(`[2FA] Verifying backup code...`);
        const result = await useBackupCode(userId, code);
        
        if (!result.valid) {
          setRemainingAttempts((prev) => prev - 1);
          if (result.remainingCodes <= 0) {
            setError("No backup codes remaining. Contact support.");
          } else {
            setError(`Invalid backup code. ${result.remainingCodes} remaining.`);
          }
          setIsVerifying(false);
          return;
        }
        
        console.log(`[2FA] Backup code valid. ${result.remainingCodes} codes remaining.`);
      } else {
        // Verify 2FA code (TOTP)
        console.log(`[2FA] Verifying TOTP code...`);
        const isValid = await verify2FACode(userId, code);
        
        if (!isValid) {
          setRemainingAttempts((prev) => prev - 1);
          setError("Invalid code. Please try again.");
          
          if (remainingAttempts <= 1) {
            setError("Too many failed attempts. Your session has expired.");
            setTimeout(() => router.push("/login"), 2000);
          }
          
          setIsVerifying(false);
          return;
        }
        
        console.log(`[2FA] TOTP code valid.`);
      }

      // Code verified! Create session
      console.log(`[2FA] ${useBackup ? "Backup" : "2FA"} verification successful. Creating session...`);
      
      try {
        // Get the user object from Firebase auth
        const user = auth.currentUser;
        if (!user) {
          setError("Session expired. Please log in again.");
          router.push("/login");
          return;
        }

        // Create a session for this user
        const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const session = await createSession(user, sessionId);
        localStorage.setItem("currentSessionId", session.id);
        
        console.log(`[2FA] Session created: ${session.id}. Logging audit event...`);
        
        // Log successful 2FA login in audit
        await logAuditEvent(user.uid, {
          type: "LOGIN",
          ipAddress: session.ipAddress,
          device: `${session.os} - ${session.browser}`,
          location: session.location,
          timestamp: Date.now(),
          status: "success",
          details: `2FA ${useBackup ? "backup code" : "authenticator"} verification successful`,
        });
        
        console.log(`[2FA] Redirecting to dashboard...`);
        router.push("/dashboard");
      } catch (sessionError) {
        console.error("[2FA] Error creating session:", sessionError);
        setError("Session creation failed. Please try again.");
        setIsVerifying(false);
      }
    } catch (err: any) {
      console.error("[2FA] Verification error:", err);
      setError(err.message || "Verification failed. Please try again.");
      setIsVerifying(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl p-8 w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-4xl mb-4">🔐</div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Two-Factor Authentication</h1>
          <p className="text-gray-600">
            {useBackup ? "Enter a backup code" : "Enter the code from your authenticator app"}
          </p>
        </div>

        {/* Timer */}
        <div className="mb-6 text-center">
          <div className={`text-sm font-semibold ${timeRemaining < 60 ? "text-red-600" : "text-gray-600"}`}>
            Code expires in: <span className="font-mono">{formatTime(timeRemaining)}</span>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800 text-sm font-semibold">❌ {error}</p>
            {!useBackup && remainingAttempts > 0 && (
              <p className="text-red-600 text-xs mt-1">Remaining attempts: {remainingAttempts}</p>
            )}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleVerify2FA} className="space-y-6">
          {/* Code Input */}
          <div>
            <label htmlFor="code" className="block text-sm font-semibold text-gray-700 mb-2">
              {useBackup ? "Backup Code" : "Authentication Code"}
            </label>
            <input
              id="code"
              type="text"
              maxLength={useBackup ? 12 : 6}
              placeholder={useBackup ? "Enter backup code" : "000000"}
              value={code}
              onChange={(e) => {
                let inputValue = e.target.value;
                const originalValue = inputValue;
                
                if (useBackup) {
                  // Backup code: allow alphanumeric, convert to uppercase
                  inputValue = inputValue.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
                  if (originalValue !== inputValue) {
                    console.log(`[2FA] Backup mode: "${originalValue}" → "${inputValue}"`);
                  }
                } else {
                  // Authenticator code: only allow digits
                  inputValue = inputValue.replace(/\D/g, "");
                  if (originalValue !== inputValue) {
                    console.log(`[2FA] Authenticator mode: "${originalValue}" → "${inputValue}"`);
                  }
                }
                
                setCode(inputValue);
                console.log(`[2FA] useBackup: ${useBackup}, final value: "${inputValue}"`);
              }}
              className="w-full px-4 py-3 text-center text-2xl font-mono border-2 border-gray-300 rounded-lg focus:outline-none focus:border-indigo-500 transition"
              disabled={isVerifying}
              autoFocus
            />
            <p className="text-xs text-gray-500 mt-2">
              {useBackup ? "Example: ABC123DEF456" : "Enter the 6-digit code"}
            </p>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isVerifying || code.length < (useBackup ? 8 : 6)}
            className={`w-full py-3 px-4 rounded-lg font-semibold transition ${
              isVerifying || code.length < (useBackup ? 8 : 6)
                ? "bg-gray-300 text-gray-600 cursor-not-allowed"
                : "bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95"
            }`}
          >
            {isVerifying ? "Verifying..." : "Verify Code"}
          </button>
        </form>

        {/* Divider */}
        <div className="my-6 flex items-center">
          <div className="flex-1 border-t border-gray-300"></div>
          <div className="px-3 text-gray-500 text-sm">or</div>
          <div className="flex-1 border-t border-gray-300"></div>
        </div>

        {/* Toggle Backup Code */}
        <button
          onClick={() => {
            const newMode = !useBackup;
            console.log(`[2FA] Switching to ${newMode ? "backup" : "authenticator"} mode`);
            setUseBackup(newMode);
            setCode("");
            setError("");
          }}
          disabled={isVerifying}
          className="w-full py-2 px-4 text-indigo-600 hover:text-indigo-700 font-semibold text-sm disabled:text-gray-400"
        >
          {useBackup ? "← Use authenticator code instead" : "Use backup code instead →"}
        </button>

        {/* Help Link */}
        <div className="mt-8 pt-6 border-t border-gray-200 text-center">
          <p className="text-sm text-gray-600 mb-3">Lost access to your authenticator?</p>
          <Link href="/login/help" className="text-indigo-600 hover:text-indigo-700 font-semibold text-sm">
            Contact Support
          </Link>
        </div>

        {/* Back to Login */}
        <div className="mt-4 text-center">
          <button
            onClick={() => router.push("/login")}
            className="text-gray-600 hover:text-gray-900 text-sm font-semibold"
          >
            ← Back to login
          </button>
        </div>

        {/* Debug Info (dev only) */}
        {process.env.NODE_ENV === "development" && (
          <div className="mt-6 p-3 bg-gray-100 rounded text-xs text-gray-600 font-mono">
            <p>userId: {userId}</p>
            <p>email: {email}</p>
            <p>attempts: {remainingAttempts}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TwoFactorPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <TwoFactorPageContent />
    </Suspense>
  );
}
