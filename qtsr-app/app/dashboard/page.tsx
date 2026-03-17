"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { auth, rtdb } from "@/lib/firebase";
import { ref, onValue, push, set } from "firebase/database";
import { signOut, onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { Session } from "@/lib/types";

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingSession, setCreatingSession] = useState(false);
  const [newSessionName, setNewSessionName] = useState("");

  // Check authentication
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (!currentUser) {
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

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newSessionName.trim()) return;

    setCreatingSession(true);

    try {
      const newSessionRef = push(ref(rtdb, `sessions/${user.uid}`));
      const sessionId = newSessionRef.key;

      if (!sessionId) throw new Error("Failed to generate session ID");

      const newSessionData = {
        title: newSessionName.trim(),
        status: "open" as const,
        createdAt: Date.now(),
        baseRequirements: null,
      };

      await set(newSessionRef, newSessionData);
      setNewSessionName("");

      router.push(`/session/${sessionId}`);
    } catch (error) {
      console.error("Error creating session:", error);
      alert("Failed to create session");
    } finally {
      setCreatingSession(false);
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

  if (!user) {
    return (
      <div className="min-h-screen bg-[#FFFDD0] flex items-center justify-center">
        <p className="text-xl font-bold">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFFDD0] font-mono text-black overflow-x-hidden">
      <div className="w-full px-4 md:px-8 lg:px-12 max-w-[1600px] mx-auto py-4 md:py-8">
        {/* Header */}
        <div className="flex justify-between items-start mb-8">
          <div className="bg-white border-8 border-black p-6 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]">
            <h1 className="text-4xl font-black uppercase tracking-tighter">
              DASHBOARD
            </h1>
            <p className="text-sm font-bold mt-2">
              LOGGED IN: {user.email}
            </p>
          </div>

          <button
            onClick={handleSignOut}
            className="bg-black text-white px-6 py-3 font-black uppercase border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all"
          >
            SIGN OUT
          </button>
        </div>

        {/* Create New Session */}
        <form
          onSubmit={handleCreateSession}
          className="bg-[#2D5A3D] border-4 border-black p-4 md:p-8 lg:p-12 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] text-white mb-6 md:mb-8"
        >
          <h2 className="text-3xl font-black uppercase mb-6 tracking-tighter">
            CREATE NEW SESSION
          </h2>

          <div className="flex gap-4 mb-4">
            <input
              type="text"
              placeholder="Session Name (e.g., Server Rack Upgrade Q1 2026)"
              value={newSessionName}
              onChange={(e) => setNewSessionName(e.target.value)}
              className="flex-1 p-4 border-4 border-black bg-white text-black font-bold focus:outline-none placeholder-gray-400"
              required
            />
            <button
              type="submit"
              disabled={creatingSession || !newSessionName.trim()}
              className="bg-white text-black px-8 py-4 font-black uppercase border-4 border-black hover:bg-yellow-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creatingSession ? "CREATING..." : "CREATE"}
            </button>
          </div>

          <p className="text-sm font-bold opacity-80">
            NAME YOUR PROCUREMENT SESSION TO GET STARTED
          </p>
        </form>

        {/* Sessions Grid */}
        <div>
          <h2 className="text-2xl font-black uppercase mb-6 tracking-tighter">
            ACTIVE SESSIONS ({sessions.length})
          </h2>

          {loading ? (
            <div className="text-center py-12">
              <p className="font-bold text-xl">LOADING SESSIONS...</p>
            </div>
          ) : sessions.length === 0 ? (
            <div className="bg-white border-4 border-black p-8 text-center">
              <p className="font-black uppercase text-lg">NO SESSIONS YET</p>
              <p className="text-sm font-bold mt-2">
                CREATE ONE ABOVE TO BEGIN
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 lg:gap-8">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="bg-white border-4 border-black p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hover:shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] transition-all cursor-pointer"
                  onClick={() => router.push(`/session/${session.id}`)}
                >
                  <h3 className="text-base md:text-lg font-black uppercase tracking-tight mb-2">
                    {session.title}
                  </h3>

                  <div className="mb-4 space-y-1 text-sm font-bold">
                    <p>Status: {session.status.toUpperCase()}</p>
                    <p>
                      Created:{" "}
                      {new Date(session.createdAt).toLocaleDateString()}
                    </p>
                    <p>
                      Base Req:{" "}
                      {session.baseRequirements
                        ? "✓ UPLOADED"
                        : "→ PENDING"}
                    </p>
                  </div>

                  <button
                    className="w-full bg-black text-white py-3 font-black uppercase border-2 border-black hover:bg-white hover:text-black transition-all"
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/session/${session.id}`);
                    }}
                  >
                    OPEN WORKSPACE
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
