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
        setUser(null); // Resolves permission denied error by unsubscribing before auth token invalidation
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
          // Sort by creation date descending
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

  // Animated counters — roll up from 0 to target value
  useEffect(() => {
    const activeCount = sessions.filter((s) => s.status === "open").length;
    const closedCount = sessions.filter((s) => s.status === "closed").length;

    let frame = 0;
    const totalFrames = 35;
    const timer = setInterval(() => {
      frame++;
      const progress = frame / totalFrames;
      // Ease-out curve for smooth deceleration
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimatedActive(Math.round(eased * activeCount));
      setAnimatedClosed(Math.round(eased * closedCount));
      if (frame >= totalFrames) clearInterval(timer);
    }, 25);

    return () => clearInterval(timer);
  }, [sessions]);

  // Staggered row visibility
  useEffect(() => {
    if (!loading && sessions.length > 0) {
      const timer = setTimeout(() => setRowsVisible(true), 150);
      return () => clearTimeout(timer);
    }
  }, [loading, sessions]);

  // Handle comparative session creation
  const handleCreateSession = async (e: FormEvent) => {
    e.preventDefault();
    if (!newSessionName.trim() || !user) return;

    setCreatingSession(true);
    try {
      const userSessionsRef = ref(rtdb, `sessions/${user.uid}`);
      const newSessionRef = push(userSessionsRef);

      const newSessionData = {
        title: newSessionName.trim(),
        status: "open",
        createdAt: Date.now(),
      };

      await set(newSessionRef, newSessionData);
      setNewSessionName("");
      // Push directly to new workspace path
      router.push(`/session/${newSessionRef.key}`);
    } catch (error) {
      console.error("Error creating session:", error);
      alert("Failed to initialize session");
    } finally {
      setCreatingSession(false);
    }
  };

  if (loading) {
    return (
      <div className="w-full h-full min-h-[400px] flex flex-col items-center justify-center gap-4 font-sans text-zinc-900 dark:text-zinc-50">
        <div className="relative w-12 h-12 flex items-center justify-center">
          <span className="absolute w-full h-full border-4 border-zinc-200 dark:border-zinc-800 rounded-full" />
          <span className="absolute w-full h-full border-4 border-t-blue-600 dark:border-t-blue-500 rounded-full animate-spin" />
        </div>
        <p className="text-xs font-mono font-bold tracking-widest text-zinc-400 dark:text-zinc-500 uppercase animate-pulse">
          Loading Workspace Overview...
        </p>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-5 font-sans antialiased text-zinc-100 select-none">
      
      {/* Header Overview Banner */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-3 w-full pb-4 border-b border-zinc-800 select-none">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white uppercase select-none leading-none">
              Procurement Overview
            </h1>
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-950/40 border border-emerald-500/20 text-[9px] uppercase font-mono font-bold tracking-widest text-emerald-400 shadow-sm select-none leading-none">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Secure Gateway
            </div>
          </div>
          <p className="text-xs text-zinc-400 mt-2.5 font-medium leading-none">
            Initialize new comparative quotation adjudication sessions and manage bid portfolios.
          </p>
        </div>
      </div>

      {/* Corporate Action Grid: New Session Init & Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 w-full items-stretch">
        
        {/* Left: Init Session Card */}
        <div className="lg:col-span-8 bg-zinc-900/30 border border-zinc-800 p-5 shadow-sm flex flex-col justify-between gap-4 relative hover:border-zinc-700 transition-all duration-300 group/card">
          {/* Subtle shimmer on hover */}
          <div className="absolute inset-0 opacity-0 group-hover/card:opacity-100 transition-opacity duration-500 pointer-events-none overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.02] to-transparent" style={{ animation: "shimmer-sweep 3s ease-in-out infinite" }} />
          </div>
          <div className="relative z-10">
            <h3 className="text-xs font-extrabold uppercase tracking-widest text-zinc-500 select-none">
              Initialize Bid Adjudication
            </h3>
            <p className="text-xs text-zinc-400 mt-2 font-medium leading-relaxed max-w-xl">
              Set up a secure technical RFQ workspace. Specify a clear reference identifier to automatically import vendor quotations and audit measurement details.
            </p>
          </div>

          <form onSubmit={handleCreateSession} className="w-full max-w-xl relative z-10">
            <div className="flex items-center bg-zinc-950/80 border border-zinc-800 focus-within:border-zinc-600 focus-within:shadow-[0_0_12px_rgba(255,255,255,0.03)] transition-all duration-300 pl-4 pr-1.5 py-1.5 w-full">
              <svg className="w-4 h-4 text-zinc-500 shrink-0 mr-3 select-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <input
                type="text"
                placeholder="e.g. Session 28 - Lab Equipment RFQ"
                value={newSessionName}
                onChange={(e) => setNewSessionName(e.target.value)}
                className="w-full bg-transparent text-zinc-100 text-xs font-semibold focus:outline-none placeholder:text-zinc-600"
                required
              />
              <button
                type="submit"
                disabled={creatingSession || !newSessionName.trim()}
                className="px-4 py-2.5 bg-white hover:bg-zinc-200 disabled:bg-zinc-900 disabled:border-zinc-800 disabled:text-zinc-600 disabled:shadow-none text-zinc-950 text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer active:scale-[0.97] border border-transparent shadow-md whitespace-nowrap flex items-center justify-center ml-3 hover:shadow-lg"
              >
                {creatingSession ? "Initializing..." : "Create Workspace"}
              </button>
            </div>
          </form>
        </div>

        {/* Right: Quick stats */}
        <div className="lg:col-span-4 bg-zinc-900/30 border border-zinc-800 p-5 shadow-sm flex flex-col justify-center gap-4 relative select-none hover:border-zinc-700 transition-all duration-300">
          <h3 className="text-xs font-extrabold uppercase tracking-widest text-zinc-500 leading-none">
            Active Portfolios
          </h3>
          
          <div className="space-y-3 divide-y divide-zinc-800">
            <div className="flex justify-between items-center pb-2.5">
              <span className="text-xs font-bold text-zinc-400 uppercase tracking-wide">Active sessions</span>
              <span className="font-mono text-2xl font-bold leading-none text-white tabular-nums transition-all duration-300">
                {animatedActive}
              </span>
            </div>
            <div className="flex justify-between items-center pt-3 border-t border-zinc-800">
              <span className="text-xs font-bold text-zinc-400 uppercase tracking-wide">Closed sessions</span>
              <span className="font-mono text-2xl font-bold leading-none text-zinc-400 tabular-nums transition-all duration-300">
                {animatedClosed}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Workspace Sessions List (Enterprise Data Table Layout) */}
      <div className="w-full flex flex-col gap-3">
        <h2 className="text-xs font-extrabold uppercase tracking-widest text-zinc-500 select-none px-1">
          Comparative Workspaces ({sessions.length})
        </h2>

        {sessions.length === 0 ? (
          <div className="bg-zinc-900/20 border border-dashed border-zinc-800 p-10 text-center shadow-sm flex flex-col items-center gap-3">
            <div className="p-3 bg-zinc-950 text-zinc-500 border border-zinc-800">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-200">No comparative sessions found</p>
              <p className="text-xs text-zinc-500 mt-1.5 font-medium max-w-sm mx-auto leading-relaxed">
                Enter a procurement session title in the workspace card above to begin technical bid analysis.
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-zinc-900/20 border border-zinc-800 overflow-hidden shadow-sm">
            
            {/* Grid Header Row */}
            <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-2.5 bg-zinc-950/40 border-b border-zinc-800 text-[10px] uppercase font-mono font-bold tracking-wider text-zinc-400 select-none">
              <div className="col-span-5">Workspace Reference / Reference Name</div>
              <div className="col-span-2">Creation Date</div>
              <div className="col-span-2 text-center">Spec Status</div>
              <div className="col-span-3 text-right pr-1">Actions</div>
            </div>

            {/* Grid Items List */}
            <div className="divide-y divide-zinc-800/60">
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
                  className="flex flex-col md:grid md:grid-cols-12 gap-4 px-6 py-2.5 md:py-3 hover:bg-zinc-800/15 items-center transition-all duration-200 cursor-pointer group focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-700 border-l-2 border-l-transparent hover:border-l-emerald-500/50"
                  style={{
                    opacity: rowsVisible ? 1 : 0,
                    transform: rowsVisible ? "translateY(0)" : "translateY(6px)",
                    transition: `opacity 0.35s ease ${index * 0.04}s, transform 0.35s ease ${index * 0.04}s, background-color 0.2s, border-color 0.2s`,
                  }}
                >
                  {/* Workspace Session Name (Col 5) */}
                  <div className="col-span-5 flex items-center gap-3.5 min-w-0 w-full">
                    <span className={`h-2 w-2 rounded-full shrink-0 border border-zinc-900 ${
                      session.status === 'open' 
                        ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse' 
                        : 'bg-zinc-600'
                    }`} title={session.status === 'open' ? 'Active Workspace' : 'Closed Session'} />
                    
                    <div className="min-w-0">
                      <h3 className="text-xs sm:text-sm font-extrabold text-zinc-200 group-hover:text-white transition-colors truncate uppercase leading-tight" title={session.title}>
                        {session.title}
                      </h3>
                      <p className="text-[9px] text-zinc-600 mt-0.5 uppercase font-mono font-bold leading-none select-none group-hover:text-zinc-500 transition-colors">
                        ID: {session.id.substring(0, 10)}...
                      </p>
                    </div>
                  </div>

                  {/* Creation Date (Col 2) */}
                  <div className="col-span-2 w-full md:w-auto flex justify-between md:block select-none border-t md:border-t-0 pt-2.5 md:pt-0 border-zinc-800">
                    <span className="md:hidden text-[9px] font-bold text-zinc-500 uppercase font-mono">Created</span>
                    <span className="text-xs font-semibold text-zinc-400 font-mono leading-none group-hover:text-zinc-300 transition-colors">
                      {new Date(session.createdAt).toLocaleDateString("en-GB")}
                    </span>
                  </div>

                  {/* Spec Status Badge (Col 2) */}
                  <div className="col-span-2 w-full md:w-auto flex justify-between md:block md:text-center select-none border-t md:border-t-0 pt-2.5 md:pt-0 border-zinc-800">
                    <span className="md:hidden text-[9px] font-bold text-zinc-500 uppercase font-mono">Spec Upload</span>
                    <span className={`text-[9px] font-mono font-bold uppercase tracking-wider border px-2.5 py-0.5 leading-none inline-block transition-all duration-200 ${
                      session.baseRequirements 
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25 group-hover:bg-emerald-500/15 group-hover:border-emerald-500/35" 
                        : "bg-amber-500/10 text-amber-400 border-amber-500/25 group-hover:bg-amber-500/15 group-hover:border-amber-500/35"
                    }`}>
                      {session.baseRequirements ? "Uploaded" : "Pending"}
                    </span>
                  </div>

                  {/* Action Link Button (Col 3) */}
                  <div className="col-span-3 w-full md:w-auto text-right select-none border-t md:border-t-0 pt-3 md:pt-0 border-zinc-800">
                    <span className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 border border-zinc-800 group-hover:border-zinc-600 bg-zinc-900 group-hover:bg-zinc-800 text-zinc-400 group-hover:text-white font-bold text-[10px] uppercase tracking-wider transition-all duration-200 active:scale-95 shadow-sm whitespace-nowrap opacity-50 group-hover:opacity-100 group-hover:shadow-md">
                      Open Portal
                      <svg className="w-3 h-3 group-hover:translate-x-0.5 transition-transform duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                      </svg>
                    </span>
                  </div>

                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
