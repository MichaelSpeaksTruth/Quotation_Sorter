"use client";

import React, { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import Link from "next/link";

export default function AppFrameWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Monitor Auth State for corporate header navigation
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      router.push("/login");
    } catch (error) {
      console.error("[NAV] Sign out error:", error);
    }
  };

  const isLoginPage = pathname === "/login";

  return (
    <div className="min-h-screen w-full flex flex-col bg-zinc-950 text-zinc-100 select-none">
      
      {/* Premium B2B Corporate Navbar — full width */}
      {!isLoginPage && (
        <header className="h-14 w-full shrink-0 border-b border-zinc-900 bg-zinc-950/40 backdrop-blur-md z-30 select-none px-6 sm:px-8 lg:px-10 xl:px-14">
          <div className="w-full h-full flex items-center justify-between">
            {/* Left: Brand Logo & Title */}
            <div className="flex items-center gap-6">
              <Link 
                href="/dashboard" 
                className="flex items-center gap-2 select-none group text-zinc-100"
              >
                <div className="h-7 w-7 bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-200 font-extrabold text-xs shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] group-hover:border-zinc-700 transition-colors">
                  QA
                </div>
                <div>
                  <span className="font-extrabold tracking-tight text-sm font-sans text-zinc-100 hover:text-white transition-colors">
                    Quote<span className="text-zinc-400 font-semibold">Analyzer</span>
                  </span>
                  <span className="hidden sm:inline-block ml-2 text-[9px] uppercase font-mono font-bold tracking-widest text-zinc-500 align-middle">
                    // Enterprise Adjudication
                  </span>
                </div>
              </Link>

              {/* Center navigation links (only if authenticated) */}
              {currentUser && (
                <nav className="hidden md:flex items-center gap-3 ml-6 border-l border-zinc-800 pl-6 h-8 text-xs font-semibold tracking-wide font-sans">
                  <Link
                    href="/dashboard"
                    className={`px-3.5 py-1.5 transition-all duration-150 ${
                      pathname === "/dashboard" || pathname.startsWith("/session") && !pathname.endsWith("/report")
                        ? "bg-zinc-800/80 border border-zinc-700 text-white shadow-sm"
                        : "text-zinc-400 hover:bg-zinc-900/40 hover:text-zinc-200 border border-transparent"
                    }`}
                  >
                    Dashboard
                  </Link>
                  <Link
                    href="/profile"
                    className={`px-3.5 py-1.5 transition-all duration-150 ${
                      pathname === "/profile"
                        ? "bg-zinc-800/80 border border-zinc-700 text-white shadow-sm"
                        : "text-zinc-400 hover:bg-zinc-900/40 hover:text-zinc-200 border border-transparent"
                    }`}
                  >
                    Profile Settings
                  </Link>
                </nav>
              )}
            </div>

            {/* Right: User Status & Sign Out */}
            {currentUser ? (
              <div className="flex items-center gap-4">
                {/* User details display */}
                <div className="hidden sm:flex flex-col text-right font-sans">
                  <span className="text-xs font-semibold text-zinc-200 max-w-[200px] truncate leading-none">
                    {currentUser.displayName || currentUser.email}
                  </span>
                  <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-wide mt-1.5 leading-none">
                    Session Active
                  </span>
                </div>

                {/* Classic Sign Out outline button */}
                <button
                  onClick={handleSignOut}
                  className="px-3.5 py-1.5 border border-zinc-700 hover:border-zinc-500 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white font-semibold text-xs whitespace-nowrap transition-colors cursor-pointer active:scale-95 duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-700 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              !authLoading && (
                <Link
                  href="/login"
                  className="px-3.5 py-1.5 border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 hover:text-white text-zinc-200 font-bold text-xs shadow-sm transition-all cursor-pointer"
                >
                  Account Sign In
                </Link>
              )
            )}
          </div>
        </header>
      )}

      {/* Main Corporate Portal Container — adaptive full-width layout */}
      <main className="flex-1 w-full overflow-y-auto flex flex-col relative bg-zinc-950">
        <div className={`w-full mx-auto px-6 sm:px-8 lg:px-10 xl:px-14 py-5 sm:py-6 ${isLoginPage ? "flex-1 flex items-center justify-center p-4" : "flex-1"}`}>
          {children}
        </div>
      </main>
    </div>
  );
}
