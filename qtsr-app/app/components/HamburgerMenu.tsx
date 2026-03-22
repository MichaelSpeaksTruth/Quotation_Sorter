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
        className="p-3 border-4 border-black bg-black text-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all flex flex-col gap-1.5 w-12 h-12 items-center justify-center"
        aria-label="Menu"
      >
        <span
          className={`w-6 h-1 bg-white transition-all ${
            isOpen ? "rotate-45 translate-y-2" : ""
          }`}
        />
        <span
          className={`w-6 h-1 bg-white transition-all ${
            isOpen ? "opacity-0" : ""
          }`}
        />
        <span
          className={`w-6 h-1 bg-white transition-all ${
            isOpen ? "-rotate-45 -translate-y-2" : ""
          }`}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 bg-white border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] z-50">
          {/* User Email Display */}
          <div className="px-4 py-3 border-b-4 border-black bg-[#FFFDD0]">
            <p className="text-xs font-bold text-gray-600">LOGGED IN AS</p>
            <p className="text-sm font-black truncate">{userEmail}</p>
          </div>

          {/* Menu Items */}
          <button
            onClick={handleProfile}
            className="w-full px-4 py-4 text-left font-black uppercase border-b-4 border-black hover:bg-[#FFE5B4] transition-colors text-sm"
          >
            PROFILE
          </button>

          <button
            onClick={handleSignOut}
            className="w-full px-4 py-4 text-left font-black uppercase hover:bg-[#FFB6C1] transition-colors text-sm"
          >
            LOGOUT
          </button>
        </div>
      )}
    </div>
  );
}
