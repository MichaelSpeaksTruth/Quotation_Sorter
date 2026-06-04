"use client";

import React, { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";

export default function HamburgerMenu({ userEmail }: { userEmail: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      router.push("/login");
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  const handleProfile = () => {
    router.push("/profile");
    setIsOpen(false);
  };

  return (
    <div ref={menuRef} className="relative">
      {/* Hamburger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200 shadow-sm hover:shadow-md hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-all flex flex-col gap-1.5 w-11 h-11 items-center justify-center cursor-pointer active:scale-95 smooth-hover"
        aria-label="Menu"
      >
        <span
          className={`w-5 h-0.5 bg-current transition-all duration-300 ${
            isOpen ? "rotate-45 translate-y-2" : ""
          }`}
        />
        <span
          className={`w-5 h-0.5 bg-current transition-all duration-300 ${
            isOpen ? "opacity-0" : ""
          }`}
        />
        <span
          className={`w-5 h-0.5 bg-current transition-all duration-300 ${
            isOpen ? "-rotate-45 -translate-y-1" : ""
          }`}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-60 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-md border border-zinc-200/80 dark:border-zinc-800/80 rounded-xl shadow-lg z-50 overflow-hidden transition-all duration-300 animate-in fade-in slide-in-from-top-2">
          {/* User Email Display */}
          <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-100 dark:border-zinc-800">
            <p className="text-[10px] font-semibold tracking-wider text-zinc-400 dark:text-zinc-500 uppercase">LOGGED IN AS</p>
            <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 truncate mt-0.5">{userEmail}</p>
          </div>

          {/* Menu Items */}
          <div className="p-1">
            <button
              onClick={handleProfile}
              className="w-full px-3 py-2 text-left font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg transition-colors text-xs flex items-center gap-2 cursor-pointer"
            >
              <svg className="w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              Profile Settings
            </button>

            <div className="h-px bg-zinc-100 dark:bg-zinc-800 my-1" />

            <button
              onClick={handleSignOut}
              className="w-full px-3 py-2 text-left font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors text-xs flex items-center gap-2 cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Logout
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

