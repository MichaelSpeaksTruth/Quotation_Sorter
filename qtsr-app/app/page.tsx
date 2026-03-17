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
    <div className="min-h-screen bg-[#FFFDD0] flex items-center justify-center font-mono">
      <div className="text-center">
        <h1 className="text-4xl font-black uppercase tracking-tighter">
          QUOTE ANALYZER
        </h1>
        <p className="text-lg font-bold mt-4">Redirecting...</p>
      </div>
    </div>
  );
}
