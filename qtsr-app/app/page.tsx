"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        router.push("/dashboard");
      } else {
        router.push("/login");
      }
    });
    return () => unsubscribe();
  }, [router]);

  return (
    <div className="h-full w-full min-h-[400px] flex items-center justify-center font-sans antialiased text-zinc-900 dark:text-zinc-50">
      <div className="text-center flex flex-col items-center gap-6 animate-pulse">
        <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 dark:bg-indigo-400/10 flex items-center justify-center border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 shadow-sm">
          <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89M9 11l3 3L22 4" />
          </svg>
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-widest text-zinc-900 dark:text-zinc-50 uppercase">
            QuoteAnalyzer
          </h1>
          <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 mt-2">
            Establishing secure connection...
          </p>
        </div>
      </div>
    </div>
  );
}
