"use client";

import React, { useState, useEffect, useRef, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { auth, rtdb } from "@/lib/firebase";
import { ref, onValue, push, set } from "firebase/database";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { Session } from "@/lib/types";

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingSession, setCreatingSession] = useState(false);
  const [newSessionName, setNewSessionName] = useState("");

  // Animated counter state
  const [animatedActive, setAnimatedActive] = useState(0);
  const [animatedClosed, setAnimatedClosed] = useState(0);
  const [rowsVisible, setRowsVisible] = useState(false);

  // Check authentication
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (!currentUser) {
        setUser(null);
        router.push("/login");
      } else {
        setUser(currentUser);
      }
    });
    return () => unsubscribe();
  }, [router]);

  // Load user's sessions
  useEffect(() => {
    if (!user) return;
    const userSessionsRef = ref(rtdb, `sessions/${user.uid}`);
    const unsubscribe = onValue(
      userSessionsRef,
      (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const sessionList: Session[] = Object.entries(data).map(
            ([id, value]) => ({
              id,
              userId: user.uid,
              ...(value as Omit<Session, "id" | "userId">),
            })
          );
          setSessions(sessionList.sort((a, b) => b.createdAt - a.createdAt));
        } else {
          setSessions([]);
        }
        setLoading(false);
      },
      (error) => {
        console.error("Error loading sessions:", error);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [user]);

  // Animated counters
  useEffect(() => {
    const activeCount = sessions.filter((s) => s.status === "open").length;
    const closedCount = sessions.filter((s) => s.status === "closed").length;
    let frame = 0;
    const totalFrames = 40;
    const timer = setInterval(() => {
      frame++;
      const progress = frame / totalFrames;
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimatedActive(Math.round(eased * activeCount));
      setAnimatedClosed(Math.round(eased * closedCount));
      if (frame >= totalFrames) clearInterval(timer);
    }, 22);
    return () => clearInterval(timer);
  }, [sessions]);

  // Staggered row visibility
  useEffect(() => {
    if (!loading && sessions.length > 0) {
      const timer = setTimeout(() => setRowsVisible(true), 120);
      return () => clearTimeout(timer);
    }
  }, [loading, sessions]);

  // Create session
  const handleCreateSession = async (e: FormEvent) => {
    e.preventDefault();
    if (!newSessionName.trim() || !user) return;
    setCreatingSession(true);
    try {
      const userSessionsRef = ref(rtdb, `sessions/${user.uid}`);
      const newSessionRef = push(userSessionsRef);
      await set(newSessionRef, {
        title: newSessionName.trim(),
        status: "open",
        createdAt: Date.now(),
      });
      setNewSessionName("");
      router.push(`/session/${newSessionRef.key}`);
    } catch (error) {
      console.error("Error creating session:", error);
      alert("Failed to initialize session");
    } finally {
      setCreatingSession(false);
    }
  };

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="w-full min-h-[60vh] flex flex-col items-center justify-center gap-5">
        <div className="relative w-10 h-10">
          <span className="absolute inset-0 border-2 border-zinc-800" />
          <span className="absolute inset-0 border-2 border-t-red-500 animate-spin" />
        </div>
        <p className="text-[11px] font-mono font-bold tracking-[0.2em] text-zinc-600 uppercase animate-pulse">
          Loading Workspace…
        </p>
      </div>
    );
  }

  const activeCount  = sessions.filter(s => s.status === "open").length;
  const closedCount  = sessions.filter(s => s.status === "closed").length;
  const totalSessions = sessions.length;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="w-full flex flex-col gap-0 select-none" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* ══ HERO BANNER — Create Session ══════════════════════════════════════ */}
      <div
        className="w-full relative overflow-hidden mb-8"
        style={{
          background: 'linear-gradient(135deg, #140303 0%, #0a0101 60%, #000 100%)',
          borderBottom: '1px solid rgba(239,68,68,0.15)',
        }}
      >
        {/* Background grid */}
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: 'linear-gradient(rgba(239,68,68,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(239,68,68,0.04) 1px,transparent 1px)',
          backgroundSize: '40px 40px',
        }}/>
        {/* Top red glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[200px] pointer-events-none" style={{
          background: 'radial-gradient(ellipse at 50% 0%, rgba(239,68,68,0.08) 0%, transparent 70%)',
        }}/>
        <div className="relative z-10 px-6 sm:px-8 lg:px-10 xl:px-14 pt-16 pb-12">
          <div className="flex flex-col gap-8">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[9px] font-mono font-bold text-red-400 bg-red-950/30 border border-red-900/40 px-2 py-0.5 uppercase tracking-widest rounded-sm">
                  Workspace Initialization
                </span>
              </div>
              <h1 className="text-3xl font-extrabold text-white tracking-tight leading-none uppercase">
                Create Workspace
              </h1>
              <p className="text-zinc-500 text-xs mt-2.5 max-w-xl leading-relaxed">
                Initialize a new comparative quotation workspace to upload vendor sheets and execute automated adjudications.
              </p>
            </div>

            {/* Input + Button */}
            <form onSubmit={handleCreateSession} className="flex flex-col sm:flex-row items-stretch gap-3 w-full max-w-4xl">
              <div className="flex-1 relative">
                <label className="block text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-zinc-400 mb-2">
                  Session / Workspace Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Enter session or workspace name..."
                  value={newSessionName}
                  onChange={(e) => setNewSessionName(e.target.value)}
                  className="w-full px-6 py-5 text-base text-white font-medium focus:outline-none transition-all duration-200"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.12)',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'rgba(239,68,68,0.6)'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; }}
                  required
                />
                <p className="text-zinc-500 text-xs mt-2 leading-relaxed">
                  Name this session <strong>anything you like</strong> (e.g., your project title, purchase order number, or department) to organize your uploaded quotation sheets and reports.
                </p>
              </div>
              <div className="flex flex-col justify-end">
                <div className="h-[28px]" />{/* spacer for label */}
                <button
                  type="submit"
                  disabled={creatingSession || !newSessionName.trim()}
                  className="px-10 py-5 text-base font-bold uppercase tracking-wider transition-all duration-200 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
                  style={{
                    background: creatingSession || !newSessionName.trim() ? 'rgba(255,255,255,0.06)' : '#ef4444',
                    color: creatingSession || !newSessionName.trim() ? '#52525b' : '#fff',
                    border: '1px solid transparent',
                    boxShadow: (!creatingSession && newSessionName.trim()) ? '0 0 24px rgba(239,68,68,0.25)' : 'none',
                  }}
                >
                  {creatingSession ? (
                    <span className="flex items-center gap-2">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89"/>
                      </svg>
                      Initializing…
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
                      </svg>
                      Create Workspace
                    </span>
                  )}
                </button>
                <p className="text-zinc-700 text-xs mt-1.5 text-center">Press Enter or click to launch</p>
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* ══ STAT CARDS ════════════════════════════════════════════════════════ */}
      <div className="px-6 sm:px-8 lg:px-10 xl:px-14 mb-8">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">

          {/* Total */}
          <div className="relative overflow-hidden p-6 flex flex-col gap-2" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <p className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-zinc-600">Total Sessions</p>
            <p className="text-4xl font-extrabold text-white font-mono tabular-nums leading-none">{totalSessions}</p>
            <p className="text-xs text-zinc-600">across all time</p>
            <div className="absolute top-0 right-0 w-16 h-16 pointer-events-none" style={{ background: 'radial-gradient(circle at 100% 0%, rgba(255,255,255,0.03) 0%, transparent 70%)' }}/>
          </div>

          {/* Active */}
          <div className="relative overflow-hidden p-6 flex flex-col gap-2" style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <p className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-red-500/70">Active Sessions</p>
            <p className="text-4xl font-extrabold font-mono tabular-nums leading-none" style={{ color: '#ef4444' }}>{animatedActive}</p>
            <p className="text-xs" style={{ color: 'rgba(239,68,68,0.45)' }}>currently open</p>
            <div className="absolute top-0 right-0 w-16 h-16 pointer-events-none" style={{ background: 'radial-gradient(circle at 100% 0%, rgba(239,68,68,0.08) 0%, transparent 70%)' }}/>
          </div>

          {/* Closed */}
          <div className="relative overflow-hidden p-6 flex flex-col gap-2" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <p className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-zinc-600">Closed Sessions</p>
            <p className="text-4xl font-extrabold text-zinc-400 font-mono tabular-nums leading-none">{animatedClosed}</p>
            <p className="text-xs text-zinc-600">completed &amp; archived</p>
          </div>

          {/* Spec Uploaded */}
          <div className="relative overflow-hidden p-6 flex flex-col gap-2" style={{ background: 'rgba(234,179,8,0.04)', border: '1px solid rgba(234,179,8,0.18)' }}>
            <p className="text-[10px] font-mono font-bold uppercase tracking-[0.18em]" style={{ color: 'rgba(234,179,8,0.6)' }}>Specs Uploaded</p>
            <p className="text-4xl font-extrabold font-mono tabular-nums leading-none" style={{ color: 'rgba(234,179,8,0.85)' }}>
              {sessions.filter(s => s.baseRequirements).length}
            </p>
            <p className="text-xs" style={{ color: 'rgba(234,179,8,0.4)' }}>ready for analysis</p>
            <div className="absolute top-0 right-0 w-16 h-16 pointer-events-none" style={{ background: 'radial-gradient(circle at 100% 0%, rgba(234,179,8,0.06) 0%, transparent 70%)' }}/>
          </div>
        </div>
      </div>

      {/* ══ SESSIONS TABLE ════════════════════════════════════════════════════ */}
      <div className="px-6 sm:px-8 lg:px-10 xl:px-14">

        {/* Section header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-4">
            <div className="w-1 h-6" style={{ background: '#ef4444' }}/>
            <div>
              <h2 className="text-sm font-extrabold uppercase tracking-widest text-white">
                Comparative Workspaces
              </h2>
              <p className="text-[10px] font-mono text-zinc-600 mt-0.5">{sessions.length} session{sessions.length !== 1 ? 's' : ''} found · click any row to open</p>
            </div>
          </div>
          {sessions.length > 0 && (
            <div className="flex items-center gap-3 text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 bg-emerald-500 rounded-full inline-block"/>Open</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 bg-zinc-600 rounded-full inline-block"/>Closed</span>
            </div>
          )}
        </div>

        {sessions.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-20 gap-6" style={{ border: '1px dashed rgba(239,68,68,0.15)', background: 'rgba(239,68,68,0.02)' }}>
            <div className="w-14 h-14 flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <svg className="w-7 h-7 text-red-500/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-base font-bold text-white mb-2">No sessions yet</p>
              <p className="text-sm text-zinc-600 max-w-sm leading-relaxed">
                Type a session name in the field above and click <span className="text-red-400 font-semibold">Create Workspace</span> to begin your first procurement adjudication.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono text-zinc-700 uppercase tracking-widest animate-bounce">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18"/>
              </svg>
              Start above
            </div>
          </div>
        ) : (
          /* Full table */
          <div style={{ border: '1px solid rgba(255,255,255,0.07)' }}>

            {/* Table header */}
            <div className="hidden md:grid grid-cols-12 gap-0 px-6 py-3" style={{ background: 'rgba(0,0,0,0.6)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="col-span-1 text-[9px] font-mono font-bold uppercase tracking-[0.18em] text-zinc-600">#</div>
              <div className="col-span-5 text-[9px] font-mono font-bold uppercase tracking-[0.18em] text-zinc-600">Session / Reference Name</div>
              <div className="col-span-2 text-[9px] font-mono font-bold uppercase tracking-[0.18em] text-zinc-600">Created</div>
              <div className="col-span-2 text-[9px] font-mono font-bold uppercase tracking-[0.18em] text-zinc-600 text-center">Spec Status</div>
              <div className="col-span-1 text-[9px] font-mono font-bold uppercase tracking-[0.18em] text-zinc-600 text-center">State</div>
              <div className="col-span-1 text-[9px] font-mono font-bold uppercase tracking-[0.18em] text-zinc-600 text-right">Action</div>
            </div>

            {/* Table rows */}
            <div>
              {sessions.map((session, index) => (
                <div
                  key={session.id}
                  onClick={() => router.push(`/session/${session.id}`)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(`/session/${session.id}`);
                    }
                  }}
                  className="group relative flex flex-col md:grid md:grid-cols-12 gap-0 px-6 py-4 cursor-pointer transition-all duration-150 focus-visible:outline-none"
                  style={{
                    borderBottom: index < sessions.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                    borderLeft: '3px solid transparent',
                    opacity: rowsVisible ? 1 : 0,
                    transform: rowsVisible ? 'translateY(0)' : 'translateY(8px)',
                    transition: `opacity 0.3s ease ${index * 0.035}s, transform 0.3s ease ${index * 0.035}s, background-color 0.15s, border-color 0.15s`,
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.04)';
                    (e.currentTarget as HTMLElement).style.borderLeftColor = 'rgba(239,68,68,0.6)';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                    (e.currentTarget as HTMLElement).style.borderLeftColor = 'transparent';
                  }}
                >
                  {/* # */}
                  <div className="hidden md:flex col-span-1 items-center">
                    <span className="text-xs font-mono text-zinc-700 group-hover:text-zinc-500 transition-colors">
                      {String(sessions.length - index).padStart(2, '0')}
                    </span>
                  </div>

                  {/* Name */}
                  <div className="col-span-5 flex items-center gap-3.5 min-w-0 mb-3 md:mb-0">
                    <span className={`h-2 w-2 shrink-0 ${session.status === 'open' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-zinc-600'}`}
                      style={{ animation: session.status === 'open' ? 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite' : 'none' }}
                    />
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-zinc-200 group-hover:text-white transition-colors truncate uppercase" title={session.title}>
                        {session.title}
                      </h3>
                      <p className="text-[9px] text-zinc-700 mt-0.5 font-mono group-hover:text-zinc-500 transition-colors">
                        ID: {session.id.substring(0, 12)}…
                      </p>
                    </div>
                  </div>

                  {/* Date */}
                  <div className="col-span-2 flex items-center">
                    <div>
                      <span className="md:hidden text-[9px] font-mono font-bold uppercase tracking-widest text-zinc-600 block mb-0.5">Created</span>
                      <span className="text-xs font-mono text-zinc-400 group-hover:text-zinc-200 transition-colors">
                        {new Date(session.createdAt).toLocaleDateString("en-GB")}
                      </span>
                    </div>
                  </div>

                  {/* Spec Status */}
                  <div className="col-span-2 flex items-center md:justify-center">
                    <div className="flex flex-col items-start md:items-center gap-1">
                      <span className="md:hidden text-[9px] font-mono font-bold uppercase tracking-widest text-zinc-600">Spec</span>
                      <span className={`text-[9px] font-mono font-bold uppercase tracking-wider px-2.5 py-1 leading-none transition-all duration-200 ${
                        session.baseRequirements
                          ? "text-emerald-400 group-hover:text-emerald-300"
                          : "text-amber-400 group-hover:text-amber-300"
                      }`}
                        style={{
                          background: session.baseRequirements ? 'rgba(52,211,153,0.08)' : 'rgba(234,179,8,0.08)',
                          border: session.baseRequirements ? '1px solid rgba(52,211,153,0.2)' : '1px solid rgba(234,179,8,0.2)',
                        }}
                      >
                        {session.baseRequirements ? "✓ Uploaded" : "⏳ Pending"}
                      </span>
                    </div>
                  </div>

                  {/* State */}
                  <div className="col-span-1 flex items-center md:justify-center">
                    <span className={`text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-1 leading-none ${
                      session.status === 'open'
                        ? 'text-red-400'
                        : 'text-zinc-600'
                    }`}
                      style={{
                        background: session.status === 'open' ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.02)',
                        border: session.status === 'open' ? '1px solid rgba(239,68,68,0.2)' : '1px solid rgba(255,255,255,0.05)',
                      }}
                    >
                      {session.status === 'open' ? 'Open' : 'Closed'}
                    </span>
                  </div>

                  {/* Action */}
                  <div className="col-span-1 flex items-center justify-end">
                    <span
                      className="inline-flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-widest transition-all duration-150 px-3 py-2"
                      style={{
                        color: 'rgba(239,68,68,0.5)',
                        border: '1px solid rgba(239,68,68,0.15)',
                      }}
                    >
                      Open
                      <svg className="w-2.5 h-2.5 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                      </svg>
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Table footer */}
            <div className="px-6 py-3 flex items-center justify-between" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', background: 'rgba(0,0,0,0.4)' }}>
              <p className="text-[9px] font-mono text-zinc-700 uppercase tracking-widest">
                {sessions.length} workspace{sessions.length !== 1 ? 's' : ''} · sorted by date descending
              </p>
              <p className="text-[9px] font-mono text-zinc-700 uppercase tracking-widest">
                Click any row to open portal →
              </p>
            </div>

          </div>
        )}
      </div>

    </div>
  );
}
