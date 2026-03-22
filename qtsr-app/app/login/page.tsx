'use client';

import { useState, FormEvent } from 'react';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { ref, set, get } from 'firebase/database';
import { auth, rtdb } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { createSession } from '@/lib/sessionService';
import { logAuditEvent } from '@/lib/sessionService';

export default function LoginPage() {
  // Auth mode selection
  const [authMode, setAuthMode] = useState<'google' | 'email' | null>(null);
  const [isSignup, setIsSignup] = useState(false);
  
  // Form fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [department, setDepartment] = useState('Department of Physics');
  const [institute, setInstitute] = useState('Birla Institute of Technology, Mesra - Ranchi');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  // Fetch user data from RTDB
  const fetchUserData = async (uid: string) => {
    try {
      const userRef = ref(rtdb, `users/${uid}`);
      const snapshot = await get(userRef);
      return snapshot.val();
    } catch (err) {
      console.error('Error fetching user data:', err);
      return null;
    }
  };

  // Check email exists and get auth method
  const checkEmailAuthMethod = async (emailToCheck: string) => {
    try {
      const usersRef = ref(rtdb, 'users');
      const snapshot = await get(usersRef);
      if (snapshot.exists()) {
        const users = snapshot.val();
        for (const uid in users) {
          if (users[uid].email === emailToCheck) {
            return users[uid].authMethod || 'email';
          }
        }
      }
      return null;
    } catch (err) {
      console.error('Error checking email:', err);
      return null;
    }
  };

  // Store user data
  const storeUserData = async (uid: string, userData: any) => {
    try {
      await set(ref(rtdb, `users/${uid}`), userData);
    } catch (err) {
      console.error('Error storing user data:', err);
      throw err;
    }
  };

  // Handle Google Sign Up
  const handleGoogleSignup = async () => {
    if (!name.trim()) {
      setError('Please enter your name');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      // Check if user already exists
      const existingUser = await fetchUserData(user.uid);
      
      if (existingUser) {
        setError('This Google account is already registered');
        setLoading(false);
        return;
      }

      // Store new user data
      await storeUserData(user.uid, {
        email: user.email,
        name: name,
        department: department,
        institute: institute,
        authMethod: 'google',
        createdAt: new Date().toISOString(),
      });

      // Create session for new user
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await createSession(user, sessionId);

      // Log audit event
      await logAuditEvent(user.uid, {
        type: "LOGIN",
        ipAddress: "0.0.0.0",
        device: "Google OAuth",
        location: "Web",
        timestamp: Date.now(),
        status: "success",
        details: "User signed up with Google",
      });

      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Google sign up failed');
    } finally {
      setLoading(false);
    }
  };

  // Handle Email Sign Up
  const handleEmailSignup = async (e: FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !email.trim() || !password.trim() || !confirmPassword.trim()) {
      setError('Please fill in all fields');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      const user = result.user;

      // Store user data
      await storeUserData(user.uid, {
        email: user.email,
        name: name,
        department: department,
        institute: institute,
        authMethod: 'email',
        createdAt: new Date().toISOString(),
      });

      // Create session for new user
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await createSession(user, sessionId);

      // Log audit event
      await logAuditEvent(user.uid, {
        type: "LOGIN",
        ipAddress: "0.0.0.0",
        device: "Email",
        location: "Web",
        timestamp: Date.now(),
        status: "success",
        details: "User signed up with email and password",
      });

      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Sign up failed');
    } finally {
      setLoading(false);
    }
  };

  // Handle Google Sign In
  const handleGoogleSignin = async () => {
    setLoading(true);
    setError('');

    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      // Check if user exists
      const existingUser = await fetchUserData(user.uid);
      
      if (!existingUser || existingUser.authMethod !== 'google') {
        setError('This Google account is not registered or was registered with email/password');
        setLoading(false);
        return;
      }

      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Google sign in failed');
    } finally {
      setLoading(false);
    }
  };

  // Handle Email Sign In
  const handleEmailSignin = async (e: FormEvent) => {
    e.preventDefault();

    if (!email.trim() || !password.trim()) {
      setError('Please enter email and password');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Check which auth method this email uses
      const authMethod = await checkEmailAuthMethod(email);

      if (authMethod === 'google') {
        // Automatically switch to Google mode
        setAuthMode('google');
        setError('This email is registered with Google authentication. Please use "Sign in with Google"');
        setPassword('');
        setLoading(false);
        return;
      }

      if (!authMethod) {
        setError('Email not found. Please create an account first');
        setLoading(false);
        return;
      }

      // Sign in with email/password
      const result = await signInWithEmailAndPassword(auth, email, password);
      const user = result.user;

      // Create session for signed-in user
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await createSession(user, sessionId);

      // Log audit event
      await logAuditEvent(user.uid, {
        type: "LOGIN",
        ipAddress: "0.0.0.0",
        device: "Email",
        location: "Web",
        timestamp: Date.now(),
        status: "success",
        details: "User signed in with email and password",
      });

      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  // Reset form
  const resetForm = () => {
    setAuthMode(null);
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setName('');
    setError('');
  };

  // If no mode selected, show mode selection
  if (!authMode) {
    return (
      <div className="min-h-screen bg-[#FFFDD0] flex items-center justify-center p-4">
        <div className="w-full max-w-lg">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-center mb-8 text-[#2D5A3D]">
            Quotation Sorter
          </h1>

          {!isSignup ? (
            // Sign In Mode Selection
            <div className="space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold text-center mb-6">Sign In</h2>
              
              <button
                onClick={() => setAuthMode('google')}
                className="w-full py-3 sm:py-4 px-4 border-4 border-black bg-white hover:bg-yellow-200 font-bold transition-colors text-sm sm:text-base"
              >
                Sign In with Google
              </button>

              <button
                onClick={() => setAuthMode('email')}
                className="w-full py-3 sm:py-4 px-4 border-4 border-black bg-white hover:bg-yellow-200 font-bold transition-colors text-sm sm:text-base"
              >
                Sign In with Email
              </button>

              <div className="text-center mt-6">
                <span className="text-xs sm:text-sm">Don't have an account? </span>
                <button
                  onClick={() => {
                    setIsSignup(true);
                    resetForm();
                  }}
                  className="font-bold text-[#2D5A3D] hover:underline text-xs sm:text-sm"
                >
                  Create Account
                </button>
              </div>
            </div>
          ) : (
            // Sign Up Mode Selection
            <div className="space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold text-center mb-6">Create Account</h2>
              
              <button
                onClick={() => setAuthMode('google')}
                className="w-full py-3 sm:py-4 px-4 border-4 border-black bg-white hover:bg-yellow-200 font-bold transition-colors text-sm sm:text-base"
              >
                Sign Up with Google
              </button>

              <button
                onClick={() => setAuthMode('email')}
                className="w-full py-3 sm:py-4 px-4 border-4 border-black bg-white hover:bg-yellow-200 font-bold transition-colors text-sm sm:text-base"
              >
                Sign Up with Email
              </button>

              <div className="text-center mt-6">
                <span className="text-xs sm:text-sm">Already have an account? </span>
                <button
                  onClick={() => {
                    setIsSignup(false);
                    resetForm();
                  }}
                  className="font-bold text-[#2D5A3D] hover:underline text-xs sm:text-sm"
                >
                  Sign In
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Creator Credit - Fade In Animation */}
        <style>{`
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          .animate-creditsFadeIn {
            animation: fadeIn 2.5s ease-in 0.3s forwards;
            opacity: 0;
          }
        `}</style>

        <div className="fixed bottom-4 left-0 right-0 flex justify-center px-4">
          <p className="font-mono text-xs text-black opacity-0 animate-creditsFadeIn">
            Created by Anurag Kumar Verma [ BTECH/10173/24 ]
          </p>
        </div>
      </div>
    );
  }

  // Google Sign Up
  if (isSignup && authMode === 'google') {
    return (
      <div className="min-h-screen bg-[#FFFDD0] flex items-center justify-center p-4">
        <div className="w-full max-w-lg">
          <button
            onClick={resetForm}
            className="mb-6 text-xs sm:text-sm font-bold text-[#2D5A3D] hover:underline"
          >
            ← Back to Mode Selection
          </button>

          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-center mb-2 text-[#2D5A3D]">
            Sign Up with Google
          </h1>
          
          <div className="space-y-4 sm:space-y-5">
            <div>
              <label className="block text-xs sm:text-sm md:text-base font-bold mb-2">Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your full name"
                className="w-full p-3 sm:p-4 border-4 border-black bg-white focus:outline-none focus:ring-4 focus:ring-[#2D5A3D] text-xs sm:text-sm"
              />
            </div>

            <div>
              <label className="block text-xs sm:text-sm md:text-base font-bold mb-2">Department *</label>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full p-3 sm:p-4 border-4 border-black bg-white focus:outline-none focus:ring-4 focus:ring-[#2D5A3D] text-xs sm:text-sm"
              >
                <option>Department of Physics</option>
              </select>
            </div>

            <div>
              <label className="block text-xs sm:text-sm md:text-base font-bold mb-2">Institute *</label>
              <select
                value={institute}
                onChange={(e) => setInstitute(e.target.value)}
                className="w-full p-3 sm:p-4 border-4 border-black bg-white focus:outline-none focus:ring-4 focus:ring-[#2D5A3D] text-xs sm:text-sm"
              >
                <option>Birla Institute of Technology, Mesra - Ranchi</option>
              </select>
            </div>

            {error && (
              <div className="p-3 sm:p-4 border-4 border-red-500 bg-red-50 text-red-700 text-xs sm:text-sm">
                {error}
              </div>
            )}

            <button
              onClick={handleGoogleSignup}
              disabled={loading}
              className="w-full py-3 sm:py-4 px-4 bg-[#2D5A3D] hover:bg-[#1f3f2b] text-white font-bold border-4 border-black transition-colors disabled:opacity-50 text-xs sm:text-sm"
            >
              {loading ? 'Signing up...' : 'Sign Up with Google'}
            </button>

            <div className="text-center">
              <span className="text-xs sm:text-sm">Already have an account? </span>
              <button
                onClick={() => {
                  setIsSignup(false);
                  resetForm();
                }}
                className="font-bold text-[#2D5A3D] hover:underline text-xs sm:text-sm"
              >
                Sign In
              </button>
            </div>
          </div>
        </div>

        {/* Creator Credit - Fade In Animation */}
        <style>{`
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          .animate-creditsFadeIn {
            animation: fadeIn 2.5s ease-in 0.3s forwards;
            opacity: 0;
          }
        `}</style>

        <div className="fixed bottom-4 left-0 right-0 flex justify-center px-4">
          <p className="font-mono text-xs text-black opacity-0 animate-creditsFadeIn">
            Created by Anurag Kumar Verma [ BTECH/10173/24 ]
          </p>
        </div>
      </div>
    );
  }

  // Email Sign Up
  if (isSignup && authMode === 'email') {
    return (
      <div className="min-h-screen bg-[#FFFDD0] flex items-center justify-center p-4">
        <div className="w-full max-w-lg">
          <button
            onClick={resetForm}
            className="mb-6 text-xs sm:text-sm font-bold text-[#2D5A3D] hover:underline"
          >
            ← Back to Mode Selection
          </button>

          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-center mb-2 text-[#2D5A3D]">
            Sign Up with Email
          </h1>

          <form onSubmit={handleEmailSignup} className="space-y-4 sm:space-y-5">
            <div>
              <label className="block text-xs sm:text-sm md:text-base font-bold mb-2">Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your full name"
                className="w-full p-3 sm:p-4 border-4 border-black bg-white focus:outline-none focus:ring-4 focus:ring-[#2D5A3D] text-xs sm:text-sm"
              />
            </div>

            <div>
              <label className="block text-xs sm:text-sm md:text-base font-bold mb-2">Department *</label>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full p-3 sm:p-4 border-4 border-black bg-white focus:outline-none focus:ring-4 focus:ring-[#2D5A3D] text-xs sm:text-sm"
              >
                <option>Department of Physics</option>
              </select>
            </div>

            <div>
              <label className="block text-xs sm:text-sm md:text-base font-bold mb-2">Institute *</label>
              <select
                value={institute}
                onChange={(e) => setInstitute(e.target.value)}
                className="w-full p-3 sm:p-4 border-4 border-black bg-white focus:outline-none focus:ring-4 focus:ring-[#2D5A3D] text-xs sm:text-sm"
              >
                <option>Birla Institute of Technology, Mesra - Ranchi</option>
              </select>
            </div>

            <div>
              <label className="block text-xs sm:text-sm md:text-base font-bold mb-2">Email *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full p-3 sm:p-4 border-4 border-black bg-white focus:outline-none focus:ring-4 focus:ring-[#2D5A3D] text-xs sm:text-sm"
              />
            </div>

            <div>
              <label className="block text-xs sm:text-sm md:text-base font-bold mb-2">Password *</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="w-full p-3 sm:p-4 border-4 border-black bg-white focus:outline-none focus:ring-4 focus:ring-[#2D5A3D] text-xs sm:text-sm"
              />
            </div>

            <div>
              <label className="block text-xs sm:text-sm md:text-base font-bold mb-2">Confirm Password *</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                className="w-full p-3 sm:p-4 border-4 border-black bg-white focus:outline-none focus:ring-4 focus:ring-[#2D5A3D] text-xs sm:text-sm"
              />
            </div>

            {error && (
              <div className="p-3 sm:p-4 border-4 border-red-500 bg-red-50 text-red-700 text-xs sm:text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 sm:py-4 px-4 bg-[#2D5A3D] hover:bg-[#1f3f2b] text-white font-bold border-4 border-black transition-colors disabled:opacity-50 text-xs sm:text-sm"
            >
              {loading ? 'Creating Account...' : 'Create Account'}
            </button>

            <div className="text-center">
              <span className="text-xs sm:text-sm">Already have an account? </span>
              <button
                type="button"
                onClick={() => {
                  setIsSignup(false);
                  resetForm();
                }}
                className="font-bold text-[#2D5A3D] hover:underline text-xs sm:text-sm"
              >
                Sign In
              </button>
            </div>
          </form>
        </div>

        {/* Creator Credit - Fade In Animation */}
        <style>{`
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          .animate-creditsFadeIn {
            animation: fadeIn 2.5s ease-in 0.3s forwards;
            opacity: 0;
          }
        `}</style>

        <div className="fixed bottom-4 left-0 right-0 flex justify-center px-4">
          <p className="font-mono text-xs text-black opacity-0 animate-creditsFadeIn">
            Created by Anurag Kumar Verma [ BTECH/10173/24 ]
          </p>
        </div>
      </div>
    );
  }

  // Google Sign In
  if (!isSignup && authMode === 'google') {
    return (
      <div className="min-h-screen bg-[#FFFDD0] flex items-center justify-center p-4">
        <div className="w-full max-w-lg">
          <button
            onClick={resetForm}
            className="mb-6 text-xs sm:text-sm font-bold text-[#2D5A3D] hover:underline"
          >
            ← Back to Mode Selection
          </button>

          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-center mb-2 text-[#2D5A3D]">
            Sign In with Google
          </h1>

          <div className="space-y-4 sm:space-y-5">
            {error && (
              <div className="p-3 sm:p-4 border-4 border-red-500 bg-red-50 text-red-700 text-xs sm:text-sm">
                {error}
              </div>
            )}

            <button
              onClick={handleGoogleSignin}
              disabled={loading}
              className="w-full py-3 sm:py-4 px-4 bg-[#2D5A3D] hover:bg-[#1f3f2b] text-white font-bold border-4 border-black transition-colors disabled:opacity-50 text-xs sm:text-sm"
            >
              {loading ? 'Signing in...' : 'Sign In with Google'}
            </button>

            <div className="text-center">
              <span className="text-xs sm:text-sm">Don't have an account? </span>
              <button
                onClick={() => {
                  setIsSignup(true);
                  resetForm();
                }}
                className="font-bold text-[#2D5A3D] hover:underline text-xs sm:text-sm"
              >
                Create Account
              </button>
            </div>
          </div>
        </div>

        {/* Creator Credit - Fade In Animation */}
        <style>{`
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          .animate-creditsFadeIn {
            animation: fadeIn 2.5s ease-in 0.3s forwards;
            opacity: 0;
          }
        `}</style>

        <div className="fixed bottom-4 left-0 right-0 flex justify-center px-4">
          <p className="font-mono text-xs text-black opacity-0 animate-creditsFadeIn">
            Created by Anurag Kumar Verma [ BTECH/10173/24 ]
          </p>
        </div>
      </div>
    );
  }

  // Email Sign In
  if (!isSignup && authMode === 'email') {
    return (
      <div className="min-h-screen bg-[#FFFDD0] flex items-center justify-center p-4">
        <div className="w-full max-w-lg">
          <button
            onClick={resetForm}
            className="mb-6 text-xs sm:text-sm font-bold text-[#2D5A3D] hover:underline"
          >
            ← Back to Mode Selection
          </button>

          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-center mb-2 text-[#2D5A3D]">
            Sign In with Email
          </h1>

          <form onSubmit={handleEmailSignin} className="space-y-4 sm:space-y-5">
            <div>
              <label className="block text-xs sm:text-sm md:text-base font-bold mb-2">Email *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full p-3 sm:p-4 border-4 border-black bg-white focus:outline-none focus:ring-4 focus:ring-[#2D5A3D] text-xs sm:text-sm"
              />
            </div>

            <div>
              <label className="block text-xs sm:text-sm md:text-base font-bold mb-2">Password *</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full p-3 sm:p-4 border-4 border-black bg-white focus:outline-none focus:ring-4 focus:ring-[#2D5A3D] text-xs sm:text-sm"
              />
            </div>

            {error && (
              <div className="p-3 sm:p-4 border-4 border-red-500 bg-red-50 text-red-700 text-xs sm:text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 sm:py-4 px-4 bg-[#2D5A3D] hover:bg-[#1f3f2b] text-white font-bold border-4 border-black transition-colors disabled:opacity-50 text-xs sm:text-sm"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>

            <div className="text-center">
              <span className="text-xs sm:text-sm">Don't have an account? </span>
              <button
                type="button"
                onClick={() => {
                  setIsSignup(true);
                  resetForm();
                }}
                className="font-bold text-[#2D5A3D] hover:underline text-xs sm:text-sm"
              >
                Create Account
              </button>
            </div>
          </form>
        </div>

        {/* Creator Credit - Fade In Animation */}
        <style>{`
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          .animate-creditsFadeIn {
            animation: fadeIn 2.5s ease-in 0.3s forwards;
            opacity: 0;
          }
        `}</style>

        <div className="fixed bottom-4 left-0 right-0 flex justify-center px-4">
          <p className="font-mono text-xs text-black opacity-0 animate-creditsFadeIn">
            Created by Anurag Kumar Verma [ BTECH/10173/24 ]
          </p>
        </div>
      </div>
    );
  }
}
