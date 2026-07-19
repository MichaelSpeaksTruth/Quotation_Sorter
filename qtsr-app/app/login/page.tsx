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

  // ─── Shared style tokens ──────────────────────────────────────────────────
  const inp = [
    "w-full px-5 py-4 text-sm bg-white/[0.04] border border-white/[0.1]",
    "text-white placeholder:text-zinc-600",
    "focus:outline-none focus:border-red-500/70 focus:bg-white/[0.07]",
    "hover:border-white/[0.18] transition-all duration-200",
  ].join(" ");

  const lbl = "block text-[11px] font-mono font-bold text-zinc-400 mb-2 uppercase tracking-[0.18em]";

  // ─── Screen 1: Choose auth method ────────────────────────────────────────
  const screenGateway = () => (
    <div className="w-full animate-fade-in">
      {/* Heading */}
      <div className="mb-10">
        <p className="text-[11px] font-mono font-bold uppercase tracking-[0.2em] text-red-500/70 mb-3">
          {isSignup ? '— New Account' : '— Returning User'}
        </p>
        <h2 className="text-4xl font-bold text-white leading-tight mb-3">
          {isSignup ? 'Create your\naccount' : 'Welcome\nback'}
        </h2>
        <p className="text-zinc-500 text-sm leading-relaxed">
          {isSignup
            ? 'Choose a method below to register and get access to your procurement workspace.'
            : 'Sign in to access your quotation workspace. Choose your preferred method.'}
        </p>
      </div>

      {/* Auth options */}
      <div className="flex flex-col gap-4">

        {/* Google */}
        <button
          onClick={() => setAuthMode('google')}
          className="w-full group border border-white/[0.1] hover:border-white/[0.25] bg-white/[0.03] hover:bg-white/[0.07] transition-all duration-200 active:scale-[0.99] cursor-pointer text-left"
        >
          <div className="flex items-center gap-5 px-6 py-5">
            <div className="w-12 h-12 bg-white flex items-center justify-center shrink-0">
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#EA4335" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v3.9h6.6c-.28 1.48-1.12 2.73-2.38 3.58v3h3.84c2.25-2.07 3.53-5.13 3.53-8.82z"/>
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.83-3c-1.08.73-2.45 1.16-4.1 1.16-3.15 0-5.83-2.13-6.78-5.01H1.3v3.1c1.97 3.92 6.02 6.66 10.7 6.66z"/>
                <path fill="#FBBC05" d="M5.22 14.24c-.24-.73-.38-1.5-.38-2.3s.14-1.57.38-2.3V6.54H1.3C.47 8.18 0 10.03 0 12s.47 3.82 1.3 5.46l3.92-3.22z"/>
                <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.6 4.6 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0 7.32 0 3.27 2.74 1.3 6.54l3.92 3.22c.95-2.88 3.63-5.01 6.78-5.01z"/>
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-white font-semibold text-base">{isSignup ? 'Sign up with Google' : 'Sign in with Google'}</p>
              <p className="text-zinc-500 text-xs mt-0.5">
                {isSignup ? 'Quick one-click registration using your Google account' : 'Fast & secure — no password needed'}
              </p>
            </div>
            <svg className="w-4 h-4 text-zinc-600 group-hover:text-white transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
            </svg>
          </div>
        </button>

        {/* Divider */}
        <div className="flex items-center gap-4 my-1">
          <div className="flex-1 h-px bg-white/[0.06]"/>
          <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">or use email</span>
          <div className="flex-1 h-px bg-white/[0.06]"/>
        </div>

        {/* Email */}
        <button
          onClick={() => setAuthMode('email')}
          className="w-full group border border-red-600/40 hover:border-red-500 bg-red-600/10 hover:bg-red-600/20 transition-all duration-200 active:scale-[0.99] cursor-pointer text-left"
        >
          <div className="flex items-center gap-5 px-6 py-5">
            <div className="w-12 h-12 bg-red-600 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-white font-semibold text-base">{isSignup ? 'Sign up with Email' : 'Sign in with Email'}</p>
              <p className="text-red-400/60 text-xs mt-0.5">
                {isSignup ? 'Register using your email address and a password' : 'Enter your email address and password'}
              </p>
            </div>
            <svg className="w-4 h-4 text-red-700 group-hover:text-red-400 transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
            </svg>
          </div>
        </button>
      </div>

      {/* Toggle sign in / sign up */}
      <div className="mt-8 pt-6 border-t border-white/[0.05] text-center">
        <p className="text-zinc-600 text-sm">
          {isSignup ? 'Already have an account? ' : "Don't have an account? "}
          <button
            onClick={() => { setIsSignup(!isSignup); resetForm(); }}
            className="text-red-400 hover:text-red-300 font-semibold transition-colors cursor-pointer bg-transparent border-none"
          >
            {isSignup ? 'Sign in instead →' : 'Register for free →'}
          </button>
        </p>
      </div>
    </div>
  );

  // ─── Screen 2: Google signup (name) ──────────────────────────────────────
  const screenGoogleSignup = () => (
    <div className="w-full animate-fade-in">
      <button onClick={resetForm} className="flex items-center gap-2 text-zinc-600 hover:text-white text-xs font-mono uppercase tracking-widest transition-colors mb-10 cursor-pointer">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/>
        </svg>
        Back to options
      </button>

      <div className="mb-8">
        <p className="text-[11px] font-mono font-bold uppercase tracking-[0.2em] text-green-500/70 mb-3">— Step 1 of 2</p>
        <h2 className="text-3xl font-bold text-white mb-2">Enter your name</h2>
        <p className="text-zinc-500 text-sm leading-relaxed">
          This name will be attached to your account and displayed on all reports and sessions. Then you'll be redirected to Google to complete registration.
        </p>
      </div>

      <div className="mb-6">
        <label className={lbl}>
          Your Full Name
          <span className="text-red-500 ml-1">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Anurag Kumar Verma"
          className={inp}
          autoFocus
        />
        <p className="text-zinc-600 text-xs mt-2">Enter your real name as it should appear on procurement documents.</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 border border-red-600/40 bg-red-600/10 mb-6">
          <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
          </svg>
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      <button
        onClick={handleGoogleSignup}
        disabled={loading || !name.trim()}
        className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-white hover:bg-zinc-100 text-zinc-950 font-semibold text-sm transition-all duration-200 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        {loading ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89"/>
            </svg>
            Connecting to Google…
          </>
        ) : (
          <>
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="#EA4335" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v3.9h6.6c-.28 1.48-1.12 2.73-2.38 3.58v3h3.84c2.25-2.07 3.53-5.13 3.53-8.82z"/>
              <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.83-3c-1.08.73-2.45 1.16-4.1 1.16-3.15 0-5.83-2.13-6.78-5.01H1.3v3.1c1.97 3.92 6.02 6.66 10.7 6.66z"/>
              <path fill="#FBBC05" d="M5.22 14.24c-.24-.73-.38-1.5-.38-2.3s.14-1.57.38-2.3V6.54H1.3C.47 8.18 0 10.03 0 12s.47 3.82 1.3 5.46l3.92-3.22z"/>
              <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.6 4.6 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0 7.32 0 3.27 2.74 1.3 6.54l3.92 3.22c.95-2.88 3.63-5.01 6.78-5.01z"/>
            </svg>
            Continue with Google →
          </>
        )}
      </button>
    </div>
  );

  // ─── Screen 3: Email signup ───────────────────────────────────────────────
  const screenEmailSignup = () => (
    <div className="w-full animate-fade-in">
      <button onClick={resetForm} className="flex items-center gap-2 text-zinc-600 hover:text-white text-xs font-mono uppercase tracking-widest transition-colors mb-10 cursor-pointer">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/>
        </svg>
        Back to options
      </button>

      <div className="mb-8">
        <p className="text-[11px] font-mono font-bold uppercase tracking-[0.2em] text-red-500/70 mb-3">— New Account · Email</p>
        <h2 className="text-3xl font-bold text-white mb-2">Create your account</h2>
        <p className="text-zinc-500 text-sm">Fill in the four fields below to set up your workspace credentials.</p>
      </div>

      <form onSubmit={handleEmailSignup} className="flex flex-col gap-5">
        <div>
          <label className={lbl}>Full Name <span className="text-red-500">*</span></label>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="Your full name — e.g. Anurag Kumar Verma" className={inp} required autoFocus />
          <p className="text-zinc-700 text-xs mt-1.5">Used on your profile and all workspace reports</p>
        </div>

        <div>
          <label className={lbl}>Email Address <span className="text-red-500">*</span></label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="Your email — e.g. you@example.com" className={inp} required />
          <p className="text-zinc-700 text-xs mt-1.5">You'll use this to sign in each time</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={lbl}>Password <span className="text-red-500">*</span></label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="Min. 6 characters" className={inp} required />
          </div>
          <div>
            <label className={lbl}>Confirm Password <span className="text-red-500">*</span></label>
            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password" className={inp} required />
          </div>
        </div>
        <p className="text-zinc-700 text-xs -mt-2">Choose a strong password of at least 6 characters</p>

        {error && (
          <div className="flex items-center gap-2 px-4 py-3 border border-red-600/40 bg-red-600/10">
            <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            </svg>
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <button type="submit" disabled={loading}
          className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-red-600 hover:bg-red-500 text-white font-semibold text-sm transition-all duration-200 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer mt-2 shadow-lg shadow-red-950/40">
          {loading ? 'Creating account…' : 'Create Account & Enter Workspace →'}
        </button>
      </form>
    </div>
  );

  // ─── Screen 4: Google sign-in ─────────────────────────────────────────────
  const screenGoogleSignin = () => (
    <div className="w-full animate-fade-in">
      <button onClick={resetForm} className="flex items-center gap-2 text-zinc-600 hover:text-white text-xs font-mono uppercase tracking-widest transition-colors mb-10 cursor-pointer">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/>
        </svg>
        Back to options
      </button>

      <div className="mb-8">
        <p className="text-[11px] font-mono font-bold uppercase tracking-[0.2em] text-green-500/70 mb-3">— Sign In · Google SSO</p>
        <h2 className="text-3xl font-bold text-white mb-2">Sign in with Google</h2>
        <p className="text-zinc-500 text-sm leading-relaxed">
          Click the button below. A Google pop-up will appear — select the Google account you used when you first registered on this platform.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 border border-red-600/40 bg-red-600/10 mb-6">
          <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
          </svg>
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      <button
        onClick={handleGoogleSignin}
        disabled={loading}
        className="w-full flex items-center justify-center gap-4 px-6 py-5 bg-white hover:bg-zinc-100 text-zinc-950 font-semibold text-base transition-all duration-200 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        {loading ? (
          <>
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89"/>
            </svg>
            Authenticating…
          </>
        ) : (
          <>
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#EA4335" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v3.9h6.6c-.28 1.48-1.12 2.73-2.38 3.58v3h3.84c2.25-2.07 3.53-5.13 3.53-8.82z"/>
              <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.83-3c-1.08.73-2.45 1.16-4.1 1.16-3.15 0-5.83-2.13-6.78-5.01H1.3v3.1c1.97 3.92 6.02 6.66 10.7 6.66z"/>
              <path fill="#FBBC05" d="M5.22 14.24c-.24-.73-.38-1.5-.38-2.3s.14-1.57.38-2.3V6.54H1.3C.47 8.18 0 10.03 0 12s.47 3.82 1.3 5.46l3.92-3.22z"/>
              <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.6 4.6 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0 7.32 0 3.27 2.74 1.3 6.54l3.92 3.22c.95-2.88 3.63-5.01 6.78-5.01z"/>
            </svg>
            Click here to open Google Sign-In →
          </>
        )}
      </button>

      <p className="text-zinc-700 text-xs mt-4 text-center">A pop-up window will open. Make sure pop-ups are allowed in your browser.</p>
    </div>
  );

  // ─── Screen 5: Email sign-in ──────────────────────────────────────────────
  const screenEmailSignin = () => (
    <div className="w-full animate-fade-in">
      <button onClick={resetForm} className="flex items-center gap-2 text-zinc-600 hover:text-white text-xs font-mono uppercase tracking-widest transition-colors mb-10 cursor-pointer">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/>
        </svg>
        Back to options
      </button>

      <div className="mb-8">
        <p className="text-[11px] font-mono font-bold uppercase tracking-[0.2em] text-red-500/70 mb-3">— Sign In · Email & Password</p>
        <h2 className="text-3xl font-bold text-white mb-2">Enter your credentials</h2>
        <p className="text-zinc-500 text-sm">Enter the email address and password you used when you first created your account.</p>
      </div>

      <form onSubmit={handleEmailSignin} className="flex flex-col gap-5">
        <div>
          <label className={lbl}>Email Address <span className="text-red-500">*</span></label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="The email you registered with" className={inp} required autoFocus />
        </div>

        <div>
          <label className={lbl}>Password <span className="text-red-500">*</span></label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Your account password" className={inp} required />
        </div>

        {error && (
          <div className="flex items-center gap-2 px-4 py-3 border border-red-600/40 bg-red-600/10">
            <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            </svg>
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <button type="submit" disabled={loading}
          className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-red-600 hover:bg-red-500 text-white font-semibold text-sm transition-all duration-200 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer mt-2 shadow-lg shadow-red-950/40">
          {loading ? 'Signing in…' : 'Sign In to Workspace →'}
        </button>
      </form>
    </div>
  );

  // ─── Router ────────────────────────────────────────────────────────────────
  const renderFormContent = () => {
    if (!authMode)                       return screenGateway();
    if (isSignup && authMode === 'google') return screenGoogleSignup();
    if (isSignup && authMode === 'email')  return screenEmailSignup();
    if (!isSignup && authMode === 'google') return screenGoogleSignin();
    if (!isSignup && authMode === 'email')  return screenEmailSignin();
  };

  // ─── Page layout ──────────────────────────────────────────────────────────
  return (
    <div
      className="h-screen w-full flex overflow-hidden relative"
      style={{ background: '#000', fontFamily: "'Inter', sans-serif" }}
    >

      {/* ── LEFT PANEL: Brand ─────────────────────────────────────────── */}
      <div
        className="hidden lg:flex flex-col justify-between w-[40%] shrink-0 pt-10 px-14"
        style={{
          background: 'linear-gradient(160deg, #1c0505 0%, #0e0101 55%, #000 100%)',
          borderRight: '1px solid rgba(239,68,68,0.12)',
          paddingBottom: '80px',
        }}
      >
        {/* Logo */}
        <div>
          <div className="flex items-center gap-3 mb-10">
            <div
              className="w-10 h-10 flex items-center justify-center shrink-0"
              style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.35)', boxShadow: '0 0 20px rgba(239,68,68,0.15)' }}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="rgba(248,113,113,0.9)" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"/>
              </svg>
            </div>
            <div>
              <span className="font-mono font-bold tracking-[0.22em] text-sm text-white uppercase">QUOTE</span>
              <span className="font-mono font-bold tracking-[0.22em] text-sm uppercase" style={{ color: 'rgba(234,179,8,0.75)' }}>ANALYZER</span>
            </div>
          </div>

          {/* Hero text */}
          <h1 className="text-5xl font-bold text-white leading-[1.1] mb-5">
            Procurement<br/>
            <span style={{ color: '#ef4444' }}>Intelligence</span><br/>
            Portal
          </h1>
          <p className="text-zinc-500 text-sm leading-relaxed mb-8 max-w-xs">
            A structured comparative quotation adjudication system for technical procurement workflows. Built for accuracy, speed and audit compliance.
          </p>

          {/* Feature highlights */}
          <div className="flex flex-col gap-4">
            {[
              { dot: '#ef4444', label: 'Comparative bid analysis across vendors' },
              { dot: '#eab308', label: 'Session-tracked audit-ready logs' },
              { dot: '#22c55e', label: 'Secure role-based access control' },
              { dot: 'rgba(255,255,255,0.3)', label: 'Real-time procurement overview' },
            ].map((f, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="w-1.5 h-1.5 shrink-0" style={{ background: f.dot }}/>
                <span className="text-zinc-400 text-sm">{f.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div>
          <div className="h-px mb-4" style={{ background: 'rgba(239,68,68,0.12)' }}/>
          <p className="text-zinc-700 text-[11px] font-mono uppercase tracking-[0.15em] leading-relaxed mb-3">
            Developed &amp; owned by<br/>
            <span className="text-zinc-500">Anurag Kumar Verma · B.Tech [10173/24]</span>
          </p>
          <div className="flex flex-wrap items-center gap-2.5 mt-2">
            <span className="text-red-500 text-[12px] font-mono font-black uppercase tracking-[0.2em] bg-red-950/45 border border-red-500/30 px-2.5 py-1 rounded-sm shadow-[0_0_12px_rgba(239,68,68,0.15)]">
              ⊘ NOT FOR SALE
            </span>
            <span className="text-zinc-600 text-[10px] font-mono uppercase tracking-widest">
              ◈ Project Demonstration · v1.2.0
            </span>
          </div>
        </div>
      </div>

      {/* ── RIGHT PANEL: Form ─────────────────────────────────────────── */}
      <div
        className="flex-1 flex flex-col items-center justify-center px-8 py-16 pb-24 relative overflow-y-auto"
        style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 0%, #150404 0%, #000 70%)' }}
      >
        {/* Faint red grid */}
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: 'linear-gradient(rgba(239,68,68,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(239,68,68,0.025) 1px,transparent 1px)',
          backgroundSize: '44px 44px',
        }}/>

        {/* Mobile logo */}
        <div className="lg:hidden flex items-center gap-3 mb-12">
          <div className="w-8 h-8 flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }}>
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="rgba(248,113,113,0.9)" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"/>
            </svg>
          </div>
          <span className="font-mono font-bold tracking-[0.2em] text-sm text-white uppercase">
            QUOTE<span style={{ color: 'rgba(234,179,8,0.75)' }}>ANALYZER</span>
          </span>
        </div>

        {/* Form container — wide, no box, no border */}
        <div className="relative z-10 w-full" style={{ maxWidth: 560 }}>
          {renderFormContent()}
        </div>
      </div>

      {/* ── Fixed bottom marquee ──────────────────────────────────────── */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 overflow-hidden select-none"
        style={{
          borderTop: '1px solid rgba(239,68,68,0.15)',
          background: 'rgba(4,0,0,0.97)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div className="relative flex" style={{ maskImage: 'linear-gradient(90deg,transparent 0%,black 5%,black 95%,transparent 100%)' }}>
          <div
            className="flex shrink-0 items-center gap-14 py-3 whitespace-nowrap"
            style={{ animation: 'marquee-scroll 24s linear infinite' }}
          >
            {[...Array(4)].map((_, i) => (
              <span key={i} className="flex items-center gap-14">
                <span className="font-mono font-bold uppercase tracking-[0.25em]" style={{ fontSize: '0.78rem', color: 'rgba(239,68,68,0.9)' }}>⊘ NOT FOR SALE</span>
                <span style={{ color: 'rgba(255,255,255,0.08)' }}>◆</span>
                <span className="font-mono font-bold uppercase tracking-[0.25em]" style={{ fontSize: '0.78rem', color: 'rgba(234,179,8,0.8)' }}>◈ ONLY FOR DEMO</span>
                <span style={{ color: 'rgba(255,255,255,0.08)' }}>◆</span>
                <span className="font-mono font-semibold uppercase tracking-[0.2em]" style={{ fontSize: '0.78rem', color: 'rgba(52,211,153,0.7)' }}>© ANURAG KUMAR VERMA · PROJECT DEMONSTRATION · v1.2.0</span>
                <span style={{ color: 'rgba(255,255,255,0.08)' }}>◆</span>
              </span>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}
