"use client";

import React, { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { auth, rtdb } from "@/lib/firebase";
import {
  ref,
  get,
  update,
  onValue,
  push,
  set,
} from "firebase/database";
import { onAuthStateChanged, User as FirebaseUser, getIdToken } from "firebase/auth";
import { Session, Quotation } from "@/lib/types";
import Link from "next/link";

export default function SessionWorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;

  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [baseReqDragActive, setBaseReqDragActive] = useState(false);
  const [quoteDragActive, setQuoteDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, { status: string; progress: number }>>({}); // Track per-file progress
  const [isClosingSession, setIsClosingSession] = useState(false);
  const [targetCurrency, setTargetCurrency] = useState("INR");
  const baseReqInputRef = useRef<HTMLInputElement>(null);
  const quoteInputRef = useRef<HTMLInputElement>(null);
  const uploadQueueRef = useRef<Set<string>>(new Set()); // Track active uploads

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

  // Load session
  useEffect(() => {
    if (!sessionId || !user) return;

    const sessionRef = ref(rtdb, `sessions/${user.uid}/${sessionId}`);
    const unsubscribe = onValue(
      sessionRef,
      (snapshot) => {
        const data = snapshot.val();
        if (data) {
          setSession({ id: sessionId, userId: user.uid, ...data });
        }
        setLoading(false);
      },
      (error) => {
        console.error("Error loading session:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [sessionId, user]);

  // Load quotations
  useEffect(() => {
    if (!sessionId || !user) return;

    const quotesRef = ref(rtdb, `quotations/${user.uid}/${sessionId}`);
    const unsubscribe = onValue(
      quotesRef,
      (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const quoteList: Quotation[] = Object.entries(data).map(
            ([id, value]) => ({
              id,
              sessionId,
              ...(value as Omit<Quotation, "id" | "sessionId">),
            })
          );
          setQuotations(quoteList.sort((a, b) => b.uploadedAt - a.uploadedAt));
        } else {
          setQuotations([]);
        }
      },
      (error) => {
        console.error("Error loading quotations:", error);
      }
    );

    return () => unsubscribe();
  }, [sessionId, user]);

  // Convert file to base64 string
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Handle quotation cancellation - Call backend API
  const handleCancelQuotation = async (quoteId: string, quoteName: string) => {
    if (!user || !window.confirm(`Cancel "${quoteName}"? This will remove it from processing.`)) return;

    try {
      console.log(`🔴 [CANCEL REQUEST] Removing QuoteID: ${quoteId}`);
      
      // Get ID token for Firebase auth
      console.log(`🔴 [CANCEL REQUEST] Retrieving ID token for user: ${user.uid}`);
      const idToken = await getIdToken(user);
      console.log(`✅ [CANCEL REQUEST] ID Token retrieved: ${idToken.substring(0, 50)}...`);
      
      const payload = {
        userId: user.uid,
        sessionId,
        quoteId,
        idToken: idToken.substring(0, 50) + "...",
        reason: "Manually canceled by user",
      };
      console.log(`✅ [CANCEL REQUEST] Sending payload:`, payload);
      
      const response = await fetch("/api/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.uid,
          sessionId,
          quoteId,
          idToken,
          reason: "Manually canceled by user",
        }),
      });

      const responseData = await response.json();
      
      if (!response.ok) {
        const error = responseData.error || "Failed to cancel quotation";
        console.error(`🔴 [CANCEL ERROR] Response Status: ${response.status}`, responseData);
        throw new Error(error);
      }

      console.log(`✅ [CANCEL SUCCESS] Quotation canceled: ${quoteId}`);
      alert(`"${quoteName}" has been canceled and removed from processing.`);
    } catch (error) {
      console.error(`❌ [CANCEL ERROR] Failed to cancel quotation:`, error);
      alert(`Error canceling quotation: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  // Auto-fail quotations stuck in processing for too long (5 minutes)
  useEffect(() => {
    if (!user || quotations.length === 0) return;

    const PROCESSING_TIMEOUT = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();

    quotations.forEach((quote) => {
      if (quote.status === "processing") {
        const processingDuration = now - quote.uploadedAt;
        
        if (processingDuration > PROCESSING_TIMEOUT) {
          console.warn(`[AUTO-FAIL] QuoteID: ${quote.id} stuck in PROCESSING for ${Math.round(processingDuration / 1000)}s`);
          
          // Auto-fail via backend API (uses ID token auth) - sets status to "error"
          getIdToken(user).then((idToken) => {
            fetch("/api/cancel", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                userId: user.uid,
                sessionId,
                quoteId: quote.id,
                idToken,
                targetStatus: "error",
                reason: "Processing timeout (5 minutes exceeded)",
              }),
            }).catch((err) => {
              console.error(`[AUTO-FAIL ERROR] Failed to auto-fail quotation:`, err);
            });
          });
        }
      }
    });
  }, [quotations, user, sessionId]);

  // Handle base requirements file upload
  const handleBaseReqFile = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const file = files[0];
    const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "text/plain", "application/json"];

    if (!allowedTypes.includes(file.type)) {
      alert("Only PDF, JPG, PNG, TXT, and JSON files are allowed");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert("File size must be less than 10MB");
      return;
    }

    try {
      const base64 = await fileToBase64(file);
      let extractedText = "";

      // For text/plain and JSON, extract directly
      if (file.type === "text/plain" || file.type === "application/json") {
        const text = await file.text();
        extractedText = text;
      } else {
        // For PDF/images, send to backend for extraction
        extractedText = `[File: ${file.name}]\nBase64 encoded content for AI analysis`;
      }

      // Store in RTDB
      if (!user) return;
      const baseReq = {
        fileUrl: base64,
        extractedText: extractedText.substring(0, 5000), // Limit to 5000 chars for RTDB
        uploadedAt: Date.now(),
        fileName: file.name,
      };

      await update(ref(rtdb, `sessions/${user.uid}/${sessionId}`), {
        baseRequirements: baseReq,
      });

      console.log(`%c✅ [BASE REQUIREMENTS] Successfully uploaded: ${file.name}`, "color: green; font-weight: bold; font-size: 12px;");
      alert("Base requirements uploaded successfully!");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(
        `%c❌ [BASE REQUIREMENTS ERROR] File: ${file.name} | Error: ${errorMsg}`,
        "color: darkred; font-weight: bold; font-size: 14px; background-color: #ffaaaa; padding: 8px; border-radius: 4px;"
      );
      console.error("Full error object:", error);
      alert(`Error processing file: ${errorMsg}`);
    }
  };

  // Handle quotation file upload with sequential processing (1 at a time)
  const handleQuotationFile = async (files: FileList | null) => {
    if (!files || !user) return;

    const fileArray = Array.from(files);
    const maxConcurrent = 1; // Process only 1 quotation at a time to avoid JSON parsing conflicts
    const filesToProcess = fileArray.filter((file) => {
      const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "text/plain"];
      if (!allowedTypes.includes(file.type)) {
        alert(`Skipping ${file.name}: Only PDF, JPG, PNG, and TXT files are allowed`);
        return false;
      }
      if (file.size > 10 * 1024 * 1024) {
        alert(`Skipping ${file.name}: File size must be less than 10MB`);
        return false;
      }
      return true;
    });

    console.log(`Starting sequential upload: ${filesToProcess.length} files (1 at a time)`);

    // Process files sequentially (1 at a time)
    for (let i = 0; i < filesToProcess.length; i += maxConcurrent) {
      const batch = filesToProcess.slice(i, i + maxConcurrent);
      const batchPromises = batch.map((file) => processQuotationFile(file));

      await Promise.all(batchPromises).catch((err) => {
        console.error("Processing error:", err);
      });

      // Wait between files to ensure clean processing
      if (i + maxConcurrent < filesToProcess.length) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  };

  // Helper: Process a single quotation file
  const processQuotationFile = async (file: File) => {
    try {
      const fileKey = `${file.name}_${Date.now()}`;
      setUploadProgress((prev) => ({
        ...prev,
        [fileKey]: { status: "converting", progress: 20 },
      }));

      const base64 = await fileToBase64(file);
      
      setUploadProgress((prev) => ({
        ...prev,
        [fileKey]: { status: "creating", progress: 40 },
      }));

      // Create quotation entry in RTDB
      if (!user) throw new Error("User not authenticated");
      const newQuoteRef = push(ref(rtdb, `quotations/${user.uid}/${sessionId}`));
      const quoteId = newQuoteRef.key;

      if (!quoteId) throw new Error("Failed to generate quote ID");

      const newQuote: Quotation = {
        id: quoteId,
        sessionId,
        vendorName: file.name.replace(/\.[^.]*$/, ""),
        fileUrl: base64,
        status: "processing",
        uploadedAt: Date.now(),
        parsedData: null,
        finalJsonReport: null,
      };

      await set(newQuoteRef, newQuote);
      uploadQueueRef.current.add(quoteId);

      setUploadProgress((prev) => ({
        ...prev,
        [fileKey]: { status: "uploading", progress: 60 },
      }));

      // Trigger extraction pipeline with aggressive error handling
      if (!user) throw new Error("User not authenticated");
      const baseReqText = session?.baseRequirements?.extractedText || "";
      
      // Get Firebase ID token for backend authentication
      let idToken = "";
      try {
        idToken = await getIdToken(user);
      } catch (tokenError) {
        console.error("Failed to get ID token:", tokenError);
        throw new Error("Unable to authenticate: cannot retrieve ID token");
      }

      fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.uid,
          sessionId,
          quoteId,
          fileName: file.name,
          fileUrl: base64,
          baseRequirementsText: baseReqText,
          targetCurrency,
          idToken,
        }),
      })
        .then(async (response) => {
          if (!response.ok) {
            // Parse detailed error response from backend
            let errorData: any = {};
            try {
              errorData = await response.json();
            } catch {
              errorData = { error: response.statusText };
            }
            
            const errorMessage = errorData.error || errorData.details || `HTTP ${response.status}`;
            const detailedReason = errorData.details || errorMessage;
            
            // Log with prominent styling to browser console
            console.error(
              `%c❌ [UPLOAD FAILED] File: ${file.name} | Status: ${response.status} | Reason: ${errorMessage}`,
              "color: red; font-weight: bold; font-size: 14px; background-color: #ffcccc; padding: 8px; border-radius: 4px;"
            );
            console.error(
              `%c📋 Full Error Details:`,
              "color: #cc0000; font-weight: bold; font-size: 12px;"
            );
            console.error(errorData);
            
            // Update RTDB with specific error reason instead of generic "error" status
            try {
              const quoteRef = ref(rtdb, `quotations/${user.uid}/${sessionId}/${quoteId}`);
              await update(quoteRef, {
                status: "error",
                errorMessage: `FAILED: ${detailedReason}`,
                errorDetails: {
                  file: file.name,
                  reason: errorMessage,
                  httpStatus: response.status,
                  timestamp: Date.now(),
                },
                errorAt: Date.now(),
              });
              console.log(`✓ RTDB error status updated for QuoteID: ${quoteId}`);
            } catch (rtdbError) {
              console.error("Failed to update RTDB error status:", rtdbError);
            }
            
            throw new Error(`${errorMessage}`);
          }
          
          setUploadProgress((prev) => ({
            ...prev,
            [fileKey]: { status: "complete", progress: 100 },
          }));
          uploadQueueRef.current.delete(quoteId);
          console.log(
            `%c✅ [UPLOAD SUCCESS] File: ${file.name} | QuoteID: ${quoteId}`,
            "color: green; font-weight: bold; font-size: 12px; background-color: #ccffcc; padding: 4px;"
          );
        })
        .catch((err) => {
          const errorMsg = err instanceof Error ? err.message : "Unknown error";
          console.error(
            `%c❌ [EXTRACTION PIPELINE ERROR] File: ${file.name} | Error: ${errorMsg}`,
            "color: darkred; font-weight: bold; font-size: 14px; background-color: #ffaaaa; padding: 8px; border-radius: 4px;"
          );
          console.error("Full error object:", err);
          
          setUploadProgress((prev) => ({
            ...prev,
            [fileKey]: { status: "error", progress: 0 },
          }));
          uploadQueueRef.current.delete(quoteId);
        });
    } catch (error) {
      console.error("Error processing quotation:", error);
      setUploadProgress((prev) => {
        const newProgress = { ...prev };
        Object.keys(newProgress).forEach((key) => {
          if (newProgress[key].status !== "complete") {
            newProgress[key] = { status: "error", progress: 0 };
          }
        });
        return newProgress;
      });
    }
  };

  // Drag handlers
  const handleBaseReqDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setBaseReqDragActive(e.type === "dragenter" || e.type === "dragover");
  };

  const handleQuoteDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setQuoteDragActive(e.type === "dragenter" || e.type === "dragover");
  };

  const handleBaseReqDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setBaseReqDragActive(false);
    handleBaseReqFile(e.dataTransfer.files);
  };

  const handleQuoteDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setQuoteDragActive(false);
    handleQuotationFile(e.dataTransfer.files);
  };

  // Handle Close Session - Trigger adjudication
  const handleCloseSession = async () => {
    if (!user || !session) return;

    // Exclude canceled quotations from counts
    const activeQuotations = quotations.filter((q) => q.status !== "canceled");
    const analyzedCount = activeQuotations.filter((q) => q.status === "analyzed").length;
    const errorCount = activeQuotations.filter((q) => q.status === "error").length;
    const processingCount = activeQuotations.filter((q) => q.status === "processing").length;

    // Check if there are enough analyzed quotations
    if (analyzedCount === 0) {
      alert("Please wait for at least one quotation to be analyzed before closing.");
      return;
    }

    if (processingCount > 0) {
      const confirmContinue = window.confirm(
        `${processingCount} quotation(s) are still processing. Close now anyway?`
      );
      if (!confirmContinue) return;
    }

    setIsClosingSession(true);

    try {
      const baseReqText = session.baseRequirements?.extractedText || "";

      // Get ID token for Firebase auth
      const idToken = await getIdToken(user);

      const response = await fetch("/api/adjudicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.uid,
          sessionId,
          baseRequirementsText: baseReqText,
          idToken,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Adjudication failed");
      }

      const result = await response.json();
      console.log("Adjudication complete:", result);

      // Navigate to report page which will show the adjudication results
      alert(
        `Session closed! Best vendor: ${result.data.bestVendor.vendorName}\nRedirecting to report...`
      );
      router.push(`/session/${sessionId}/report`);
    } catch (error) {
      console.error("Error closing session:", error);
      alert(
        `Error closing session: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    } finally {
      setIsClosingSession(false);
    }
  };

  if (loading) {
    return (
      <div className="w-full text-zinc-900 dark:text-zinc-50 font-sans antialiased animate-pulse">
        <div className="w-full flex flex-col gap-6">
          {/* Header Skeleton */}
          <div className="h-24 bg-white/80 dark:bg-zinc-900/80 border border-zinc-200 dark:border-white/10 rounded-xl flex items-center justify-between p-5">
            <div className="space-y-2.5 w-1/3">
              <div className="h-6 bg-zinc-300 dark:bg-zinc-850 rounded w-3/4 animate-pulse" />
              <div className="h-3 bg-zinc-200 dark:bg-zinc-900 rounded w-1/2" />
            </div>
            <div className="h-10 bg-zinc-300 dark:bg-zinc-850 rounded w-24 animate-pulse" />
          </div>

          {/* Two Column Workspace Grid Skeleton */}
          <div className="flex flex-col lg:grid lg:grid-cols-3 gap-6 w-full">
            <div className="col-span-1 h-[320px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5" />
            <div className="col-span-2 h-[450px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-xl p-5" />
          </div>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="h-full w-full min-h-[400px] flex items-center justify-center font-sans text-zinc-900 dark:text-zinc-50 select-none">
        <div className="text-center flex flex-col items-center gap-4 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl p-10 max-w-sm">
          <svg className="w-10 h-10 text-zinc-300 dark:text-zinc-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <h2 className="text-sm font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider">Session Not Found</h2>
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1 uppercase tracking-widest leading-normal">This procurement workstation path is invalid or has been deleted.</p>
          </div>
          <button 
            onClick={() => router.push("/dashboard")} 
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-[10px] font-bold uppercase tracking-wider active:scale-95 duration-150 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-950 focus-visible:ring-blue-600 cursor-pointer shadow-sm"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full text-zinc-900 dark:text-zinc-50 font-sans antialiased">
      <div className="w-full flex flex-col gap-6">
        
        {/* Header */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-5 w-full bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md border border-zinc-200 dark:border-white/10 p-5 rounded-xl shadow-sm">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 truncate uppercase" title={session.title}>
              {session.title}
            </h1>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap text-xs text-zinc-400 dark:text-zinc-500 font-medium select-none">
              <span className="font-mono leading-none tracking-tight">ID: {sessionId.substring(0, 10)}...</span>
              <span className="h-1 w-1 bg-zinc-300 dark:bg-zinc-700 rounded-full" />
              <span className="inline-flex items-center gap-0.5 rounded-md px-2.5 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-bold uppercase tracking-wider text-[9px] leading-none">
                {session.status}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2.5 flex-wrap w-full lg:w-auto">
            <button
              onClick={handleCloseSession}
              disabled={isClosingSession || quotations.length === 0 || session.status === "closed"}
              className={`px-4 py-2.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all select-none cursor-pointer inline-flex w-auto items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-950 focus-visible:ring-red-650 ${
                isClosingSession || quotations.length === 0 || session.status === "closed"
                  ? "bg-zinc-200 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-650 cursor-not-allowed border border-transparent opacity-60"
                  : "bg-red-600 hover:bg-red-700 text-white shadow-sm active:scale-95 duration-150"
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              {session.status === "closed" ? "Session Closed" : isClosingSession ? "Closing..." : "Close Session"}
            </button>

            <Link
              href={`/session/${sessionId}/report`}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-md text-xs font-bold uppercase tracking-wider shadow-sm inline-flex w-auto items-center justify-center gap-1.5 transition-all active:scale-95 duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-955 focus-visible:ring-blue-600"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              View Report
            </Link>

            <button
              onClick={() => router.push("/dashboard")}
              className="px-4 py-2.5 rounded-md text-xs font-bold uppercase border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300 transition-all shadow-sm cursor-pointer active:scale-95 duration-150 inline-flex w-auto items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-955 focus-visible:ring-blue-600"
            >
              Back
            </button>
          </div>
        </div>

        {/* Two Column Layout */}
        <div className="flex flex-col lg:grid lg:grid-cols-3 gap-6 w-full">
          {/* Left: Base Requirements */}
          <div className="col-span-1 w-full">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 rounded-xl shadow-sm text-zinc-900 dark:text-zinc-100 flex flex-col gap-5">
              <h2 className="text-sm font-extrabold uppercase tracking-widest text-zinc-400 dark:text-zinc-500 select-none">
                1. Base Requirements
              </h2>

              {session.baseRequirements ? (
                <div className="space-y-4">
                  <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 text-zinc-900 dark:text-zinc-100">
                    <div className="flex items-center gap-2 mb-2 text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest select-none">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      SPECIFICATION UPLOADED
                    </div>
                    <p className="text-xs font-bold truncate" title={session.baseRequirements.fileName}>
                      {session.baseRequirements.fileName}
                    </p>
                    <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-2 font-mono leading-none">
                      Date: {new Date(session.baseRequirements.uploadedAt).toLocaleDateString("en-GB")}
                    </p>
                  </div>

                  {/* Target Currency Dropdown */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-455 dark:text-zinc-500 block select-none">
                      TARGET CURRENCY: {quotations.length > 0 ? "(LOCKED)" : "(EDITABLE)"}
                    </label>
                    <select
                      value={targetCurrency}
                      onChange={(e) => quotations.length === 0 && setTargetCurrency(e.target.value)}
                      disabled={quotations.length > 0}
                      className={`w-full border rounded-md text-xs font-bold p-3 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-950 focus-visible:ring-blue-600 ${
                        quotations.length > 0
                          ? "bg-zinc-100 dark:bg-zinc-850 border-zinc-200 dark:border-zinc-750 text-zinc-500 dark:text-zinc-400 cursor-not-allowed opacity-75"
                          : "bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200 border-zinc-200 dark:border-zinc-800 cursor-pointer"
                      }`}
                    >
                      <option value="USD">USD (US Dollar)</option>
                      <option value="INR">INR (Indian Rupee)</option>
                      <option value="EUR">EUR (Euro)</option>
                      <option value="GBP">GBP (British Pound)</option>
                      <option value="JPY">JPY (Japanese Yen)</option>
                      <option value="CAD">CAD (Canadian Dollar)</option>
                      <option value="AUD">AUD (Australian Dollar)</option>
                    </select>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div
                    onDragEnter={handleBaseReqDrag}
                    onDragLeave={handleBaseReqDrag}
                    onDragOver={handleBaseReqDrag}
                    onDrop={handleBaseReqDrop}
                    className={`border border-dashed min-h-[220px] rounded-xl flex flex-col items-center justify-center gap-3 text-center cursor-pointer transition-all ${
                      baseReqDragActive
                        ? "border-blue-600 bg-blue-600/5 text-blue-600 dark:text-blue-400"
                        : "border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/20 hover:border-zinc-300 dark:hover:border-zinc-700 text-zinc-400 dark:text-zinc-500"
                    }`}
                    onClick={() => baseReqInputRef.current?.click()}
                  >
                    <div className="p-3 rounded-full bg-zinc-100 dark:bg-zinc-900 text-blue-600 dark:text-blue-400">
                      <svg className="w-6 h-6 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                    </div>
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                      DROP SPECIFICATION FILE
                    </span>
                    <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
                      PDF, TXT, JSON (Max 10MB)
                    </span>
                  </div>

                  <input
                    ref={baseReqInputRef}
                    type="file"
                    onChange={(e) => handleBaseReqFile(e.target.files)}
                    accept=".pdf,.txt,.json,.jpg,.jpeg,.png"
                    className="hidden"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Center/Right: Quotation Upload & List */}
          <div className="col-span-1 lg:col-span-2 w-full flex flex-col gap-6">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 p-5 rounded-xl shadow-sm flex flex-col gap-6">
              <h2 className="text-sm font-extrabold uppercase tracking-widest text-zinc-400 dark:text-zinc-500 select-none">
                2. Vendor Quotations
              </h2>

              <div
                onDragEnter={handleQuoteDrag}
                onDragLeave={handleQuoteDrag}
                onDragOver={handleQuoteDrag}
                onDrop={handleQuoteDrop}
                className={`border border-dashed min-h-[220px] rounded-xl flex flex-col items-center justify-center gap-3 text-center cursor-pointer transition-all ${
                  quoteDragActive
                    ? "border-blue-600 bg-blue-600/5"
                    : "border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/20 hover:border-zinc-300 dark:hover:border-zinc-700"
                }`}
                onClick={() => quoteInputRef.current?.click()}
              >
                <div className="p-3 rounded-full bg-zinc-100 dark:bg-zinc-900 text-blue-600 dark:text-blue-400">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-350">
                  DROP VENDOR QUOTATIONS HERE
                </span>
                <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
                  Multiple files accepted | PDF, JPG, PNG, TXT
                </span>
              </div>

              <input
                ref={quoteInputRef}
                type="file"
                onChange={(e) => handleQuotationFile(e.target.files)}
                accept=".pdf,.jpg,.jpeg,.png,.txt"
                multiple
                className="hidden"
              />

              {/* Processing Queue and Status Checklist */}
              <div className="bg-zinc-50/80 dark:bg-zinc-950/30 border border-zinc-150 dark:border-zinc-850 p-4 rounded-lg">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4 select-none">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    ANALYSIS QUEUE ({quotations.filter((q) => q.status !== "canceled").length})
                  </h3>
                  
                  <div className="flex flex-wrap gap-2 text-[9px] font-bold">
                    <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-md border border-emerald-500/30 leading-none">
                      ANALYZED: {quotations.filter((q) => q.status === "analyzed").length}
                    </span>
                    <span className="bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-md border border-amber-500/30 leading-none">
                      PROCESSING: {quotations.filter((q) => q.status === "processing").length}
                    </span>
                    <span className="bg-rose-500/10 text-rose-600 dark:text-rose-455 px-2 py-0.5 rounded-md border border-rose-500/30 leading-none">
                      ERRORS: {quotations.filter((q) => q.status === "error").length}
                    </span>
                    <span className="bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-400 px-2 py-0.5 rounded-md border border-zinc-200/30 dark:border-zinc-700/30 leading-none">
                      CANCELED: {quotations.filter((q) => q.status === "canceled").length}
                    </span>
                  </div>
                </div>

                {/* Upload Progress Bar indicators */}
                {Object.entries(uploadProgress).length > 0 && (
                  <div className="mb-4 space-y-2">
                    {Object.entries(uploadProgress).map(([fileKey, data]) => (
                      <div key={fileKey} className="border border-zinc-200 dark:border-zinc-850 bg-white dark:bg-zinc-900 rounded-lg p-3">
                        <div className="flex justify-between items-center mb-1.5">
                          <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 truncate" title={fileKey.split("_")[0]}>{fileKey.split("_")[0]}</p>
                          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider leading-none ${
                            data.status === "complete" ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/30" :
                            data.status === "error" ? "bg-rose-500/10 text-rose-600 border border-rose-500/30" : "bg-amber-500/10 text-amber-600 border border-amber-500/30"
                          }`}>
                            {data.status}
                          </span>
                        </div>
                        <div className="w-full bg-zinc-100 dark:bg-zinc-955 rounded-md h-1.5 overflow-hidden">
                          <div
                            className="bg-blue-600 h-full rounded-md transition-all duration-300"
                            style={{ width: `${data.progress}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {quotations.length === 0 ? (
                  <div className="border border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg p-8 text-center text-zinc-400 dark:text-zinc-500 text-xs font-semibold select-none flex flex-col items-center gap-2">
                    <svg className="w-6 h-6 text-zinc-300 dark:text-zinc-700 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span>No vendor quotations uploaded yet</span>
                    <span className="text-[10px] opacity-60">Drop vendor quotation files in the zone above to begin analysis</span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {quotations.map((quote) => (
                      <div
                        key={quote.id}
                        tabIndex={0}
                        className={`border rounded-lg p-4 transition-all hover:bg-zinc-100/40 dark:hover:bg-zinc-850/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-950 focus-visible:ring-blue-600 ${
                          quote.status === "analyzed"
                            ? "border-emerald-200 dark:border-emerald-900/60 bg-emerald-500/5"
                            : quote.status === "error"
                            ? "border-rose-200 dark:border-rose-900/60 bg-rose-500/5"
                            : quote.status === "canceled"
                            ? "border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-955/20 text-zinc-400"
                            : "border-zinc-200 dark:border-zinc-850 bg-white dark:bg-zinc-900"
                        }`}
                      >
                        <div className="flex justify-between items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-zinc-850 dark:text-zinc-200 truncate uppercase" title={quote.vendorName}>
                              {quote.vendorName}
                            </p>
                            <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 font-mono mt-0.5 leading-none">
                              ID: {quote.id.substring(0, 8)}
                            </p>
                          </div>
                          
                          <div className="flex gap-2 items-center flex-shrink-0 select-none">
                            <span
                              className={`text-[9px] font-bold uppercase px-2.5 py-0.5 rounded-md border leading-none ${
                                quote.status === "processing"
                                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 animate-pulse"
                                  : quote.status === "analyzed"
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                                  : quote.status === "canceled"
                                  ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200/30 dark:border-zinc-700/30"
                                  : "bg-rose-500/10 text-rose-600 dark:text-rose-455 border-rose-500/30"
                              }`}
                            >
                              {quote.status}
                            </span>
                            
                            {(quote.status === "processing" || quote.status === "error") && (
                              <button
                                onClick={() => handleCancelQuotation(quote.id, quote.vendorName)}
                                className="text-rose-600 hover:text-white dark:text-rose-400 hover:bg-rose-650 rounded-md p-1 transition-all active:scale-95 duration-150 flex items-center justify-center cursor-pointer border border-zinc-200 dark:border-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-950 focus-visible:ring-blue-600"
                                title="Cancel and remove from processing"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>

                        {quote.errorMessage && (
                          <div className="mt-3 p-3 rounded-md border border-rose-200 dark:border-rose-900/50 bg-rose-50/50 dark:bg-rose-950/20 text-[11px] font-medium text-rose-600 dark:text-rose-400 leading-normal">
                            {quote.errorMessage}
                          </div>
                        )}

                        {quote.parsedData && (
                          <div className="text-[11px] font-medium mt-3 border-t border-zinc-100 dark:border-zinc-800/80 pt-3 flex flex-wrap gap-x-6 gap-y-1.5 select-none text-zinc-400 dark:text-zinc-500">
                            <p className="flex items-center gap-1.5">
                              <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block sm:inline">Compliance:</span> 
                              <span className="font-bold text-zinc-900 dark:text-zinc-500 font-mono leading-none">{quote.parsedData.complianceScore}%</span>
                            </p>
                            {quote.parsedData.totalCost !== undefined && quote.parsedData.totalCost !== null && (
                              <p className="flex items-center gap-1.5">
                                <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block sm:inline">Total Cost:</span> 
                                <span className="font-bold text-zinc-900 dark:text-zinc-555 font-mono leading-none">
                                  {quote.finalJsonReport?.currency || targetCurrency} {quote.parsedData.totalCost.toLocaleString()}
                                </span>
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Informative Guidance Footer Callout */}
        <div className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 p-5 rounded-xl shadow-sm flex gap-4 items-start select-none">
          <div className="p-2 bg-blue-50 dark:bg-blue-950/30 rounded-md text-blue-600 dark:text-blue-400 flex-shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-zinc-850 dark:text-zinc-200 uppercase tracking-wider">WORKSPACE INSTRUCTIONS</h4>
            <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 leading-relaxed">
              Upload the base requirements file first to set technical guidelines. Add multiple vendor quotations; the multi-stage AI parser automatically unifies, processes, and extracts metadata sequentially. When all processing completes, click "Close Session" to build the compliance matrix report and final adjudication recommendation.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
