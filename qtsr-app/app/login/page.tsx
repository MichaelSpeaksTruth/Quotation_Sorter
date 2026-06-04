'use client';

import { useState, FormEvent, useEffect } from 'react';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from 'firebase/auth';
import { ref, set, get } from 'firebase/database';
import { auth, rtdb } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { createSession, getDeviceInfo, getIPAddressAndLocation, logAuditEvent } from '@/lib/sessionService';

export default function LoginPage() {
  const router = useRouter();

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

  // Classic B2B login gateway
  const [showDesignerControls, setShowDesignerControls] = useState(false);
  const isDevMode = process.env.NODE_ENV === 'development';

  // Redirect if already authenticated
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        router.push('/dashboard');
      }
    });
    return () => unsubscribe();
  }, [router]);

  // Fetch user data from RTDB
  const fetchUserData = async (uid: string) => {
    try {
      const userRef = ref(rtdb, `users/${uid}`);
      const snapshot = await get(userRef);
      return snapshot.val();
    } catch (err) {
      console.error('[AUTH] Error fetching user data:', err);
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
      console.error('[AUTH] Error checking email:', err);
      return null;
    }
  };

  // Store user data
  const storeUserData = async (uid: string, userData: any) => {
    try {
      await set(ref(rtdb, `users/${uid}`), userData);
    } catch (err) {
      console.error('[AUTH] Error storing user data:', err);
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

      // Collect real device info and geolocation  
      const { device, browser, os } = getDeviceInfo();
      const { ip: ipAddress, location } = await getIPAddressAndLocation(true);

      // Create session with proper device and location info
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await createSession(user, sessionId);

      // Store current session ID in localStorage for heartbeat tracking
      localStorage.setItem("currentSessionId", sessionId);

      // Log audit event with collected info
      await logAuditEvent(user.uid, {
        type: "LOGIN",
        ipAddress: ipAddress,
        device: `${os} - ${browser}`,
        location: location,
        timestamp: Date.now(),
        status: "success",
        details: "User signed up with Google",
      });

      router.push('/dashboard');
    } catch (err: any) {
      console.error('[AUTH] Google signup error:', err);
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

      // Collect real device info and geolocation
      const { device, browser, os } = getDeviceInfo();
      const { ip: ipAddress, location } = await getIPAddressAndLocation(true);

      // Create session for new user
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await createSession(user, sessionId);

      // Store current session ID in localStorage for heartbeat tracking
      localStorage.setItem("currentSessionId", sessionId);

      // Log audit event with collected info
      await logAuditEvent(user.uid, {
        type: "LOGIN",
        ipAddress: ipAddress,
        device: `${os} - ${browser}`,
        location: location,
        timestamp: Date.now(),
        status: "success",
        details: "User signed up with email and password",
      });

      router.push('/dashboard');
    } catch (err: any) {
      console.error('[AUTH] Email signup error:', err);
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

      // Collect real device info and geolocation
      const { device, browser, os } = getDeviceInfo();
      const { ip: ipAddress, location } = await getIPAddressAndLocation(true);

      // Create session for signed-in user
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await createSession(user, sessionId);

      // Store current session ID in localStorage for heartbeat tracking
      localStorage.setItem("currentSessionId", sessionId);

      // Log audit event with collected info
      await logAuditEvent(user.uid, {
        type: "LOGIN",
        ipAddress: ipAddress,
        device: `${os} - ${browser}`,
        location: location,
        timestamp: Date.now(),
        status: "success",
        details: "User signed in with Google",
      });

      router.push('/dashboard');
    } catch (err: any) {
      console.error('[AUTH] Google signin error:', err);
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
        setAuthMode('google');
        setError('This email is registered with Google. Please use "Sign In with Google"');
        setPassword('');
        setLoading(false);
        return;
      }

      if (!authMethod) {
        setError('Email address not registered. Please create an account first');
        setLoading(false);
        return;
      }

      // Sign in with email/password
      const result = await signInWithEmailAndPassword(auth, email, password);
      const user = result.user;

      // Collect real device info and geolocation
      const { device, browser, os } = getDeviceInfo();
      const { ip: ipAddress, location } = await getIPAddressAndLocation(true);

      // Create session for signed-in user
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await createSession(user, sessionId);

      // Store current session ID in localStorage for heartbeat tracking
      localStorage.setItem("currentSessionId", sessionId);

      // Log audit event with collected info
      await logAuditEvent(user.uid, {
        type: "LOGIN",
        ipAddress: ipAddress,
        device: `${os} - ${browser}`,
        location: location,
        timestamp: Date.now(),
        status: "success",
        details: "User signed in with email and password",
      });

      router.push('/dashboard');
    } catch (err: any) {
      console.error('[AUTH] Email signin error:', err);
      setError(err.message || 'Sign in failed. Check credentials.');
    } finally {
      setLoading(false);
    }
  };

  // Reset form state
  const resetForm = () => {
    setAuthMode(null);
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setName('');
    setError('');
  };

  // Standard B2B styling classes (expanded for premium spacing and monochrome style)
  const inputStyle = "w-full px-6 py-4 bg-zinc-900/40 border border-zinc-800 hover:border-zinc-700 text-zinc-100 placeholder:text-zinc-600 text-base transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-700/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";
  const labelStyle = "block text-xs font-mono font-semibold text-zinc-400 mb-3 uppercase tracking-widest select-none";
  const btnPrimaryStyle = "w-full bg-white hover:bg-zinc-100 text-zinc-950 font-bold border border-transparent text-sm py-3.5 cursor-pointer transition-all duration-150 ease-in-out shadow-md hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 active:scale-[0.98] select-none whitespace-nowrap";
  const btnSSOStyle = "w-full bg-zinc-900/60 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800 text-zinc-200 hover:text-white text-sm font-semibold transition-all duration-150 flex items-center justify-center gap-2.5 py-3.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-700/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 active:scale-[0.98] select-none whitespace-nowrap";

  const renderFormContent = () => {
    // Screen 1: Selecting Auth Mode (Google vs Email)
    if (!authMode) {
      return (
        <div className="flex flex-col select-none animate-fade-in w-full">
          <div className="text-center select-none mb-10">
            <h2 className="text-3xl font-bold tracking-tight text-zinc-100 leading-tight">
              Workspace Gateway
            </h2>
            <p className="text-base text-zinc-400 mt-4 leading-relaxed max-w-md mx-auto">
              Authentication 
            </p>
          </div>

          <div className="w-full flex flex-col gap-6">
            {/* Google authentication sso */}
            <button
              onClick={() => setAuthMode('google')}
              className={btnSSOStyle}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v3.9h6.6c-.28 1.48-1.12 2.73-2.38 3.58v3h3.84c2.25-2.07 3.53-5.13 3.53-8.82z" />
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.83-3c-1.08.73-2.45 1.16-4.1 1.16-3.15 0-5.83-2.13-6.78-5.01H1.3v3.1c1.97 3.92 6.02 6.66 10.7 6.66z" />
                <path fill="#FBBC05" d="M5.22 14.24c-.24-.73-.38-1.5-.38-2.3s.14-1.57.38-2.3V6.54H1.3C.47 8.18 0 10.03 0 12s.47 3.82 1.3 5.46l3.92-3.22z" />
                <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.6 4.6 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0 7.32 0 3.27 2.74 1.3 6.54l3.92 3.22c.95-2.88 3.63-5.01 6.78-5.01z" />
              </svg>
              <span>{isSignup ? "Register with Google SSO" : "Sign In with Google SSO"}</span>
            </button>

            {/* Email authentication */}
            <button
              onClick={() => setAuthMode('email')}
              className={btnPrimaryStyle + " flex items-center justify-center gap-3"}
            >
              <svg className="w-5 h-5 text-zinc-950 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <span className="align-middle">{isSignup ? "Register with Email & Pass" : "Sign In with Email & Pass"}</span>
            </button>
          </div>

          <div className="text-center pt-6 mt-10 border-t border-zinc-800/40 text-xs text-zinc-400 font-medium select-none">
            {isSignup ? "Already have a secure account? " : "New to the platform? "}
            <button
              onClick={() => {
                setIsSignup(!isSignup);
                resetForm();
              }}
              className="font-bold text-white hover:underline transition-colors cursor-pointer bg-transparent border-none p-0 focus:outline-none ml-1.5 focus-visible:ring-1 focus-visible:ring-zinc-800 px-1 py-0.5"
            >
              {isSignup ? "Sign In Portal" : "Register Account"}
            </button>
          </div>
        </div>
      );
    }

    // Screen 2: Google Sign Up - Add Metadata
    if (isSignup && authMode === 'google') {
      return (
        <div className="flex flex-col gap-10 animate-fade-in w-full">
          <div className="self-center">
            <button
              onClick={resetForm}
              className="inline-flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-500 hover:text-zinc-200 transition-colors cursor-pointer select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-800 py-1.5 px-3 bg-zinc-900/30 border border-zinc-800/40 mb-2"
            >
              ← Back to Gateway
            </button>
          </div>

          <div className="text-center select-none">
            <h2 className="text-3xl font-bold tracking-tight text-zinc-100 leading-tight">Metadata Profile</h2>
            <p className="text-base text-zinc-400 mt-4 leading-relaxed">Complete your academic & corporate designations.</p>
          </div>
          
          <div className="flex flex-col gap-6 w-full">
            <div className="flex flex-col">
              <label className={labelStyle}>Full Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Anurag Kumar Verma"
                className={inputStyle}
                required
              />
            </div>

            <div className="flex flex-col">
              <label className={labelStyle}>Department Designation *</label>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className={`${inputStyle} cursor-pointer focus-visible:outline-none`}
              >
                <option value="Department of Physics" className="bg-zinc-950 text-white">Department of Physics</option>
                <option value="Department of Chemistry" className="bg-zinc-950 text-white">Department of Chemistry</option>
                <option value="Department of Mathematics" className="bg-zinc-950 text-white">Department of Mathematics</option>
                <option value="Department of Computer Science" className="bg-zinc-950 text-white">Department of Computer Science</option>
              </select>
            </div>

            <div className="flex flex-col">
              <label className={labelStyle}>Institution *</label>
              <select
                value={institute}
                onChange={(e) => setInstitute(e.target.value)}
                className={`${inputStyle} cursor-pointer focus-visible:outline-none`}
              >
                <option value="Birla Institute of Technology, Mesra - Ranchi" className="bg-zinc-950 text-white">Birla Institute of Technology, Mesra - Ranchi</option>
              </select>
            </div>

            {error && (
              <div className="p-4 border border-rose-500/20 bg-rose-500/5 text-rose-400 text-sm font-semibold leading-normal">
                {error}
              </div>
            )}

            <button
              onClick={handleGoogleSignup}
              disabled={loading}
              className={btnPrimaryStyle + " mt-4"}
            >
              {loading ? 'Processing...' : 'Complete Profile Setup'}
            </button>
          </div>
        </div>
      );
    }

    // Screen 3: Email Sign Up Form
    if (isSignup && authMode === 'email') {
      return (
        <div className="flex flex-col gap-10 animate-fade-in w-full">
          <div className="self-center">
            <button
              onClick={resetForm}
              className="inline-flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-500 hover:text-zinc-200 transition-colors cursor-pointer select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-800 py-1.5 px-3 bg-zinc-900/30 border border-zinc-800/40 mb-2"
            >
              ← Back to Gateway
            </button>
          </div>

          <div className="text-center select-none">
            <h2 className="text-3xl font-bold tracking-tight text-zinc-100 leading-tight">Create Account</h2>
            <p className="text-base text-zinc-400 mt-4 leading-relaxed">Set up secure workspace credentials.</p>
          </div>

          <form onSubmit={handleEmailSignup} className="flex flex-col gap-6 w-full">
            <div className="flex flex-col">
              <label className={labelStyle}>Full Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Anurag Kumar Verma"
                className={inputStyle}
                required
              />
            </div>

            <div className="flex flex-col">
              <label className={labelStyle}>Department Designation *</label>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className={`${inputStyle} cursor-pointer focus-visible:outline-none`}
              >
                <option value="Department of Physics" className="bg-zinc-950 text-white">Department of Physics</option>
                <option value="Department of Chemistry" className="bg-zinc-950 text-white">Department of Chemistry</option>
                <option value="Department of Mathematics" className="bg-zinc-950 text-white">Department of Mathematics</option>
                <option value="Department of Computer Science" className="bg-zinc-950 text-white">Department of Computer Science</option>
              </select>
            </div>

            <div className="flex flex-col">
              <label className={labelStyle}>Institution *</label>
              <select
                value={institute}
                onChange={(e) => setInstitute(e.target.value)}
                className={`${inputStyle} cursor-pointer focus-visible:outline-none`}
              >
                <option value="Birla Institute of Technology, Mesra - Ranchi" className="bg-zinc-950 text-white">Birla Institute of Technology, Mesra - Ranchi</option>
              </select>
            </div>

            <div className="flex flex-col">
              <label className={labelStyle}>Corporate Email Address *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@bitmesra.ac.in"
                className={inputStyle}
                required
              />
            </div>

            <div className="flex flex-col">
              <label className={labelStyle}>Secure Password *</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                className={inputStyle}
                required
              />
            </div>

            <div className="flex flex-col">
              <label className={labelStyle}>Confirm Password *</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                className={inputStyle}
                required
              />
            </div>

            {error && (
              <div className="p-4 border border-rose-500/20 bg-rose-500/5 text-rose-400 text-sm font-semibold leading-normal">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className={btnPrimaryStyle + " mt-4"}
            >
              {loading ? 'Creating Credentials...' : 'Register Corporate Account'}
            </button>
          </form>
        </div>
      );
    }

    // Screen 4: Google Sign In
    if (!isSignup && authMode === 'google') {
      return (
        <div className="flex flex-col gap-10 animate-fade-in w-full">
          <div className="self-center">
            <button
              onClick={resetForm}
              className="inline-flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-500 hover:text-zinc-200 transition-colors cursor-pointer select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-800 py-1.5 px-3 bg-zinc-900/30 border border-zinc-800/40 mb-2"
            >
              ← Back to Gateway
            </button>
          </div>

          <div className="text-center select-none">
            <h2 className="text-3xl font-bold tracking-tight text-zinc-100 leading-tight">Google SSO</h2>
            <p className="text-base text-zinc-400 mt-4 leading-relaxed">Authenticate using your registered Google account.</p>
          </div>

          <div className="flex flex-col gap-6 w-full">
            {error && (
              <div className="p-4 border border-rose-500/20 bg-rose-500/5 text-rose-400 text-sm font-semibold leading-normal">
                {error}
              </div>
            )}

            <button
              onClick={handleGoogleSignin}
              disabled={loading}
              className={btnSSOStyle}
            >
              <svg className="w-5 h-5 text-zinc-100" viewBox="0 0 24 24">
                <path fill="#FFFFFF" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v3.9h6.6c-.28 1.48-1.12 2.73-2.38 3.58v3h3.84c2.25-2.07 3.53-5.13 3.53-8.82z" />
                <path fill="#FFFFFF" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.83-3c-1.08.73-2.45 1.16-4.1 1.16-3.15 0-5.83-2.13-6.78-5.01H1.3v3.1c1.97 3.92 6.02 6.66 10.7 6.66z" />
                <path fill="#FFFFFF" d="M5.22 14.24c-.24-.73-.38-1.5-.38-2.3s.14-1.57.38-2.3V6.54H1.3C.47 8.18 0 10.03 0 12s.47 3.82 1.3 5.46l3.92-3.22z" />
                <path fill="#FFFFFF" d="M12 4.75c1.77 0 3.35.6 4.6 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0 7.32 0 3.27 2.74 1.3 6.54l3.92 3.22c.95-2.88 3.63-5.01 6.78-5.01z" />
              </svg>
              <span>{loading ? 'Authenticating...' : 'Sign in with Google'}</span>
            </button>
          </div>
        </div>
      );
    }

    // Screen 5: Email Sign In Form
    if (!isSignup && authMode === 'email') {
      return (
        <div className="flex flex-col gap-10 animate-fade-in w-full">
          <div className="self-center">
            <button
              onClick={resetForm}
              className="inline-flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-500 hover:text-zinc-200 transition-colors cursor-pointer select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-800 py-1.5 px-3 bg-zinc-900/30 border border-zinc-800/40 mb-2"
            >
              ← Back to Gateway
            </button>
          </div>

          <div className="text-center select-none">
            <h2 className="text-3xl font-bold tracking-tight text-zinc-100 leading-tight">Sign In</h2>
            <p className="text-base text-zinc-400 mt-4 leading-relaxed">Authenticate using registered academic credentials.</p>
          </div>

          <form onSubmit={handleEmailSignin} className="flex flex-col gap-6 w-full">
            <div className="flex flex-col">
              <label className={labelStyle}>Registered Email Address *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@bitmesra.ac.in"
                className={inputStyle}
                required
              />
            </div>

            <div className="flex flex-col">
              <label className={labelStyle}>Account Password *</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter account password"
                className={inputStyle}
                required
              />
            </div>

            {error && (
              <div className="p-4 border border-zinc-800 bg-zinc-900/50 text-zinc-400 text-sm font-semibold leading-normal">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className={btnPrimaryStyle + " mt-4"}
            >
              {loading ? 'Authenticating...' : 'Secure Sign In'}
            </button>
          </form>
        </div>
      );
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-full w-full py-4 select-none relative overflow-hidden animate-fade-in">
      {/* Background technical grid overlay */}
      <div className="absolute inset-0 atmospheric-grid opacity-[0.15] pointer-events-none -z-20" />

      {/* Classic, super-soft central monochrome radial glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[550px] rounded-full bg-zinc-500/5 blur-[140px] pointer-events-none -z-10 animate-pulse" style={{ animationDuration: '10s' }} />

      {/* Physical glassmorphic container with double bevel highlight & outer shadow */}
      <div 
        className="w-full max-w-[440px] sm:max-w-[480px] premium-glass-card relative overflow-hidden transition-all duration-300" 
      >
        
        {/* Brand logo */}
        <div className="flex flex-col items-center mb-10 select-none">
          <div className="flex items-center justify-center w-12 h-12 bg-zinc-900/80 border border-white/8 mb-4 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] transition-transform duration-200 hover:scale-105">
            <svg className="w-6 h-6 text-zinc-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
            </svg>
          </div>
          <span className="font-mono text-xs font-bold tracking-[0.35em] text-zinc-100 uppercase">
            QUOTE<span className="text-zinc-500 font-semibold">ANALYZER</span>
          </span>
        </div>

        {/* Active Screen Form Content */}
        <div className="w-full">
          {renderFormContent()}
        </div>

        {/* Technical Footer */}
        <div className="font-mono text-[10px] uppercase text-zinc-500 border-t border-zinc-900/60 pt-6 mt-10 tracking-widest leading-normal text-center">
          PROCUREMENT PORTAL V1.2.0 // ANURAG KUMAR VERMA [BTECH/10173/24]
        </div>

      </div>
    </div>
  );
}
