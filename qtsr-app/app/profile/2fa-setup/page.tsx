'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/firebase';
import { generateTOTPSecret, enable2FA, getSecuritySettings } from '@/lib/securityService';
import { getDeviceInfo, getIPAddressAndLocation } from '@/lib/sessionService';
import Image from 'next/image';

function TwoFactorSetupContent() {
  const router = useRouter();
  const [step, setStep] = useState<'intro' | 'scan' | 'verify' | 'backup' | 'complete'>('intro');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [testCode, setTestCode] = useState('');
  const [backupCodesCopied, setBackupCodesCopied] = useState(false);
  const [showBackupCodes, setShowBackupCodes] = useState(false);

  useEffect(() => {
    const checkExistingStatus = async () => {
      const user = auth.currentUser;
      if (!user) {
        router.push('/login');
        return;
      }

      try {
        const settings = await getSecuritySettings(user.uid);
        if (settings?.twoFactorEnabled) {
          setError('2FA is already enabled on your account');
          setTimeout(() => router.push('/profile'), 2000);
        }
      } catch (err) {
        console.error('Error checking 2FA status:', err);
      }
    };

    checkExistingStatus();
  }, [router]);

  const handleStartSetup = async () => {
    const user = auth.currentUser;
    if (!user) {
      setError('User not authenticated');
      return;
    }

    // Clear any leftover backup codes from previous attempts
    setBackupCodes([]);

    setLoading(true);
    setError('');

    try {
      console.log('[2FA Setup] Generating TOTP secret and QR code...');
      const { secret, qrCodeUrl } = await generateTOTPSecret(user.uid, user.email || '');
      
      setTotpSecret(secret);
      setQrCode(qrCodeUrl);
      setStep('scan');
      console.log('[2FA Setup] QR code generated successfully');
    } catch (err: any) {
      console.error('[2FA Setup] Error generating TOTP secret:', err);
      setError(err.message || 'Failed to generate QR code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!testCode || testCode.length !== 6) {
      setError('Please enter a valid 6-digit code');
      return;
    }

    if (!totpSecret) {
      setError('TOTP secret not found. Please restart setup.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      console.log('[2FA Setup] Verifying test code...');
      // @ts-ignore - speakeasy types
      const speakeasy = await import('speakeasy');

      const verified = speakeasy.totp.verify({
        secret: totpSecret,
        encoding: 'base32',
        token: testCode,
        window: 2,
      });

      if (!verified) {
        setError('Invalid code. Please check your authenticator app and try again.');
        setLoading(false);
        return;
      }

      console.log('[2FA Setup] Code verified successfully. Enabling 2FA...');

      // Code is valid! Now enable 2FA in the database
      const user = auth.currentUser;
      if (!user) {
        setError('User not authenticated');
        setLoading(false);
        return;
      }

      const { device, browser, os } = getDeviceInfo();
      const { ip: ipAddress, location } = await getIPAddressAndLocation(true);
      const deviceInfo = `${os} - ${browser}`;

      const result = await enable2FA(
        user.uid,
        'authenticator',
        ipAddress,
        deviceInfo,
        user.email || undefined
      );

      if (result.enabled) {
        // CRITICAL: ONLY use codes from enable2FA result
        const codesFromServer = result.backupCodes;
        console.log('[2FA Setup] 🔹 Step 1: Codes FROM SERVER:', codesFromServer);
        
        setBackupCodes(codesFromServer);
        console.log('[2FA Setup] 🔹 Step 2: Backup codes SET IN STATE:', codesFromServer);
        
        // CRITICAL: Verify codes were actually saved to database
        console.log('[2FA Setup] 🔹 Step 3: Verifying backup codes were saved to database...');
        setTimeout(async () => {
          try {
            const user = auth.currentUser;
            if (user) {
              const settings = await getSecuritySettings(user.uid);
              const codesInDatabase = settings?.backupCodes;
              console.log('[2FA Setup] 🔹 Step 4: Codes IN DATABASE:', codesInDatabase);
              
              // Check if codes match
              if (codesInDatabase && codesFromServer) {
                const databaseString = JSON.stringify(codesInDatabase.sort());
                const serverString = JSON.stringify(codesFromServer.sort());
                
                if (databaseString === serverString) {
                  console.log('[2FA Setup] ✅✅✅ CODES MATCH - Setup is valid! ✅✅✅');
                } else {
                  console.error('[2FA Setup] ❌❌❌ CODES DO NOT MATCH ❌❌❌', {
                    fromServer: codesFromServer,
                    inDatabase: codesInDatabase
                  });
                }
              }
            }
          } catch (err) {
            console.error('[2FA Setup] Error verifying codes:', err);
          }
        }, 1000);
        
        setStep('backup');
        console.log('[2FA Setup] 2FA enabled successfully. Backup codes generated.');
      }
    } catch (err: any) {
      console.error('[2FA Setup] Error:', err);
      setError(err.message || 'Failed to enable 2FA. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyBackupCodes = () => {
    const codesText = backupCodes.join('\n');
    navigator.clipboard.writeText(codesText);
    setBackupCodesCopied(true);
    setTimeout(() => setBackupCodesCopied(false), 2000);
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
  };

  const handleComplete = () => {
    console.log('[2FA Setup] Setup complete. Redirecting to profile...');
    router.push('/profile');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl p-8 w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">🔐</div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Set Up Two-Factor Authentication</h1>
          <p className="text-gray-600">Secure your account with an extra layer of protection</p>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-between mb-8">
          {['intro', 'scan', 'verify', 'backup', 'complete'].map((s, idx) => (
            <div key={s} className="flex items-center">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${
                  step === s
                    ? 'bg-indigo-600 text-white'
                    : ['intro', 'scan', 'verify', 'backup'].includes(s) &&
                      ['intro', 'scan', 'verify', 'backup', 'complete'].indexOf(step) >
                        ['intro', 'scan', 'verify', 'backup', 'complete'].indexOf(s)
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-200 text-gray-600'
                }`}
              >
                {['intro', 'scan', 'verify', 'backup', 'complete'].indexOf(step) >
                ['intro', 'scan', 'verify', 'backup', 'complete'].indexOf(s)
                  ? '✓'
                  : idx + 1}
              </div>
              {idx < 4 && (
                <div
                  className={`w-12 h-1 mx-2 ${
                    ['intro', 'scan', 'verify', 'backup'].indexOf(step) >
                    ['intro', 'scan', 'verify', 'backup'].indexOf(s)
                      ? 'bg-green-500'
                      : 'bg-gray-200'
                  }`}
                ></div>
              )}
            </div>
          ))}
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800 text-sm font-semibold">❌ {error}</p>
          </div>
        )}

        {/* Step 1: Introduction */}
        {step === 'intro' && (
          <div className="space-y-6">
            <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-6">
              <h2 className="text-lg font-bold text-blue-900 mb-4">What is Two-Factor Authentication?</h2>
              <ul className="space-y-3 text-blue-800">
                <li className="flex items-start">
                  <span className="text-xl mr-3">📱</span>
                  <span>
                    <strong>Authenticator App:</strong> Use an app like Google Authenticator, Authy, or Microsoft
                    Authenticator to generate time-based codes
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="text-xl mr-3">🔑</span>
                  <span>
                    <strong>Backup Codes:</strong> Save emergency codes to regain access if you lose your authenticator
                    app
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="text-xl mr-3">🛡️</span>
                  <span>
                    <strong>Enhanced Security:</strong> Even if someone has your password, they can't access your account
                    without the 6-digit code
                  </span>
                </li>
              </ul>
            </div>

            <div className="bg-yellow-50 border-2 border-yellow-200 rounded-lg p-4">
              <p className="text-yellow-800 text-sm">
                <strong>⚠️ Important:</strong> Store your backup codes in a secure place (password manager, safe, etc.)
              </p>
            </div>

            <button
              onClick={handleStartSetup}
              disabled={loading}
              className="w-full py-3 px-4 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 disabled:bg-gray-400 transition"
            >
              {loading ? 'Setting Up...' : 'Continue'}
            </button>
          </div>
        )}

        {/* Step 2: Scan QR Code */}
        {step === 'scan' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-4">Step 1: Scan QR Code</h2>
              <p className="text-gray-600 mb-4">
                Download an authenticator app if you don't have one, then scan this QR code:
              </p>

              <div className="bg-gray-100 rounded-lg p-6 flex justify-center mb-4">
                {qrCode ? (
                  <img
                    src={qrCode}
                    alt="TOTP QR Code"
                    className="w-64 h-64 border-4 border-indigo-600 rounded"
                  />
                ) : (
                  <div className="text-gray-500">Generating QR code...</div>
                )}
              </div>

              <p className="text-sm text-gray-600 mb-4">
                <strong>Can't scan?</strong> Enter this code manually in your authenticator app:
              </p>
              <div className="bg-gray-100 p-4 rounded-lg font-mono text-center break-all mb-4">
                {totpSecret}
              </div>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setStep('intro')}
                className="flex-1 py-2 px-4 border-2 border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50 transition"
              >
                Back
              </button>
              <button
                onClick={() => setStep('verify')}
                className="flex-1 py-3 px-4 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition"
              >
                Next: Verify Code
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Verify Code */}
        {step === 'verify' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-4">Step 2: Verify Your Code</h2>
              <p className="text-gray-600 mb-4">Enter the 6-digit code from your authenticator app to confirm setup:</p>

              <div>
                <label htmlFor="testCode" className="block text-sm font-semibold text-gray-700 mb-2">
                  Authentication Code
                </label>
                <input
                  id="testCode"
                  type="text"
                  placeholder="000000"
                  value={testCode}
                  onChange={(e) => setTestCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  maxLength={6}
                  className="w-full px-4 py-3 text-center text-4xl font-mono border-2 border-gray-300 rounded-lg focus:outline-none focus:border-indigo-500 transition"
                  disabled={loading}
                  autoFocus
                />
                <p className="text-xs text-gray-500 mt-2">Enter the 6-digit code from your authenticator app</p>
              </div>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setStep('scan')}
                disabled={loading}
                className="flex-1 py-2 px-4 border-2 border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50 disabled:opacity-50 transition"
              >
                Back
              </button>
              <button
                onClick={handleVerifyCode}
                disabled={loading || testCode.length !== 6}
                className="flex-1 py-3 px-4 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 disabled:bg-gray-400 transition"
              >
                {loading ? 'Verifying...' : 'Enable 2FA'}
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Backup Codes */}
        {step === 'backup' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-4">Step 3: Save Backup Codes</h2>
              <p className="text-gray-600 mb-4">
                Save these codes in a secure place. You can use them to access your account if you lose your authenticator
                app:
              </p>

              <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4 mb-4">
                <p className="text-red-800 text-sm font-bold">🚨 Important Security Notice:</p>
                <p className="text-red-700 text-sm mt-2">
                  Each code can only be used once. Store them securely and never share them with anyone.
                </p>
              </div>

              <div className="bg-gray-100 rounded-lg p-4 font-mono text-sm">
                <div className="space-y-2">
                  {backupCodes.map((code, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-white p-3 rounded border border-gray-300">
                      <span>{code}</span>
                      <button
                        onClick={() => handleCopyCode(code)}
                        className="px-2 py-1 text-xs bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 transition"
                      >
                        Copy
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={handleCopyBackupCodes}
                className="w-full mt-4 py-2 px-4 bg-indigo-100 text-indigo-700 font-bold rounded-lg hover:bg-indigo-200 transition"
              >
                {backupCodesCopied ? '✓ Copied to Clipboard' : 'Copy All Codes'}
              </button>

              <button
                onClick={() => setShowBackupCodes(!showBackupCodes)}
                className="w-full mt-2 py-2 px-4 text-indigo-600 font-semibold hover:text-indigo-700"
              >
                {showBackupCodes ? '▼ Hide Codes' : '▶ Show Codes'}
              </button>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setStep('verify')}
                className="flex-1 py-2 px-4 border-2 border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50 transition"
              >
                Back
              </button>
              <button
                onClick={() => setStep('complete')}
                className="flex-1 py-3 px-4 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 transition"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 5: Complete */}
        {step === 'complete' && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="text-6xl mb-4">✅</div>
              <h2 className="text-2xl font-bold text-green-600 mb-2">2FA Enabled Successfully!</h2>
              <p className="text-gray-600 mb-4">Your account is now protected with two-factor authentication</p>
            </div>

            <div className="bg-green-50 border-2 border-green-200 rounded-lg p-6 space-y-3">
              <h3 className="font-bold text-green-900">What's Next:</h3>
              <ul className="space-y-2 text-green-800 text-sm">
                <li className="flex items-start">
                  <span className="mr-2">✓</span>
                  <span>Keep your authenticator app secure</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">✓</span>
                  <span>Store backup codes in a safe place</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">✓</span>
                  <span>Next login will require the 6-digit code</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">✓</span>
                  <span>You can disable 2FA anytime in profile settings</span>
                </li>
              </ul>
            </div>

            <button
              onClick={handleComplete}
              className="w-full py-3 px-4 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition"
            >
              Return to Profile
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TwoFactorSetupPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <TwoFactorSetupContent />
    </Suspense>
  );
}
