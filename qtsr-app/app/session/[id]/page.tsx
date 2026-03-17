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
      <div className="min-h-screen bg-[#FFFDD0] flex items-center justify-center">
        <p className="text-xl font-bold">LOADING WORKSPACE...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-[#FFFDD0] flex items-center justify-center">
        <p className="text-xl font-bold">SESSION NOT FOUND</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFFDD0] text-black font-mono p-4 md:p-8 lg:p-12 overflow-x-hidden">
      <div className="max-w-[1600px] mx-auto flex flex-col gap-8 md:gap-12">
        {/* Header - Responsive Layout */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 w-full">
          <div className="bg-white border-8 border-black p-6 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] flex-1 w-full">
            <h1 className="text-4xl font-black uppercase tracking-tighter">
              {session.title}
            </h1>
            <p className="text-sm font-bold mt-2">SESSION ID: {sessionId}</p>
            <p className="text-sm font-bold mt-1">STATUS: {session.status}</p>
          </div>

          {/* Action Buttons - Wrap on smaller screens */}
          <div className="flex gap-3 flex-wrap justify-start md:justify-end w-full md:w-auto">
            <button
              onClick={handleCloseSession}
              disabled={isClosingSession || quotations.length === 0 || session.status === "closed"}
              className={`px-4 md:px-6 py-3 font-black uppercase border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] transition-all text-sm md:text-base whitespace-nowrap ${
                isClosingSession || quotations.length === 0 || session.status === "closed"
                  ? "bg-gray-400 opacity-50 cursor-not-allowed"
                  : "bg-red-500 text-white hover:translate-x-1 hover:translate-y-1 hover:shadow-none"
              }`}
            >
              {session.status === "closed" ? "✓ SESSION CLOSED" : isClosingSession ? "CLOSING..." : "CLOSE SESSION"}
            </button>

            <Link
              href={`/session/${sessionId}/report`}
              className="bg-black text-white px-4 md:px-6 py-3 font-black uppercase border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all text-center text-sm md:text-base whitespace-nowrap"
            >
              VIEW REPORT
            </Link>

            <button
              onClick={() => router.push("/dashboard")}
              className="px-4 md:px-6 py-3 font-black uppercase border-4 border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all text-sm md:text-base whitespace-nowrap"
            >
              BACK
            </button>
          </div>
        </div>

        {/* Two Column Layout */}
        <div className="flex flex-col lg:grid lg:grid-cols-3 gap-4 md:gap-6 lg:gap-8 w-full">
          {/* Left: Base Requirements */}
          <div className="col-span-1 w-full">
            <div className="bg-[#2D5A3D] border-4 border-black p-4 md:p-6 lg:p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] text-white">
              <h2 className="text-xl font-black uppercase mb-4 tracking-tight">
                1. BASE REQUIREMENTS
              </h2>

              {session.baseRequirements ? (
                <>
                  <div className="bg-yellow-300 border-4 border-black p-4 text-black mb-4">
                    <p className="font-black text-sm uppercase mb-2">
                      ✓ UPLOADED
                    </p>
                    <p className="text-sm font-bold break-all">
                      {session.baseRequirements.fileName}
                    </p>
                    <p className="text-xs font-bold mt-2 opacity-70">
                      {new Date(
                        session.baseRequirements.uploadedAt
                      ).toLocaleDateString()}
                    </p>
                  </div>

                  {/* Target Currency Dropdown - Fixed as INR */}
                  <div className="mb-4">
                    <label className="text-white font-black text-sm uppercase block mb-2">
                      TARGET CURRENCY: {quotations.length > 0 ? "(LOCKED)" : "(EDITABLE)"}
                    </label>
                    <select
                      value={targetCurrency}
                      onChange={(e) => quotations.length === 0 && setTargetCurrency(e.target.value)}
                      disabled={quotations.length > 0}
                      className={`w-full border-4 border-black text-black font-black uppercase p-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] ${
                        quotations.length > 0
                          ? "bg-gray-300 cursor-not-allowed opacity-75"
                          : "bg-white cursor-pointer"
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
                </>
              ) : (
                <>
                  <div
                    onDragEnter={handleBaseReqDrag}
                    onDragLeave={handleBaseReqDrag}
                    onDragOver={handleBaseReqDrag}
                    onDrop={handleBaseReqDrop}
                    className={`border-4 border-dashed min-h-[200px] md:min-h-[250px] flex flex-col items-center justify-center gap-4 text-center cursor-pointer transition-all ${
                      baseReqDragActive
                        ? "bg-yellow-300 text-black"
                        : "bg-white text-black"
                    }`}
                    onClick={() =>
                      baseReqInputRef.current?.click()
                    }
                  >
                    <span className="text-xl md:text-2xl font-black uppercase">
                      DROP FILE HERE
                    </span>
                    <span className="text-sm font-bold">
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
                </>
              )}
            </div>
          </div>

          {/* Center: Quotation Upload */}
          <div className="col-span-1 lg:col-span-2 w-full">
            <div className="bg-white border-4 border-black p-4 md:p-6 lg:p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
              <h2 className="text-xl font-black uppercase mb-4 tracking-tight">
                2. VENDOR QUOTATIONS
              </h2>

              <div
                onDragEnter={handleQuoteDrag}
                onDragLeave={handleQuoteDrag}
                onDragOver={handleQuoteDrag}
                onDrop={handleQuoteDrop}
                className={`border-4 border-dashed min-h-[250px] md:min-h-[300px] lg:min-h-[40vh] flex flex-col items-center justify-center gap-4 text-center cursor-pointer transition-all mb-6 ${
                  quoteDragActive
                    ? "bg-yellow-300"
                    : "bg-gray-50"
                }`}
                onClick={() =>
                  quoteInputRef.current?.click()
                }
              >
                <span className="text-xl md:text-2xl lg:text-3xl font-black uppercase">
                  DROP QUOTATIONS HERE
                </span>
                <span className="text-sm md:text-base font-bold">
                  OR CLICK TO SELECT FILES
                </span>
                <span className="text-xs md:text-sm font-bold opacity-70">
                  Multiple files accepted | PDF, Images, TXT
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

              {/* Processing Queue */}
              <div className="bg-gray-100 border-4 border-black p-4">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-black uppercase text-sm">
                    PROCESSING QUEUE ({quotations.filter((q) => q.status !== "canceled").length})
                  </h3>
                  <div className="flex gap-4 text-xs font-bold">
                    <span className="bg-green-300 px-2 py-1 border-2 border-black">
                      ✓ {quotations.filter((q) => q.status === "analyzed").length}
                    </span>
                    <span className="bg-yellow-300 px-2 py-1 border-2 border-black">
                      ⧖ {quotations.filter((q) => q.status === "processing").length}
                    </span>
                    <span className="bg-red-300 px-2 py-1 border-2 border-black">
                      ✕ {quotations.filter((q) => q.status === "error").length}
                    </span>
                    <span className="bg-gray-400 px-2 py-1 border-2 border-black">
                      ⊖ {quotations.filter((q) => q.status === "canceled").length}
                    </span>
                  </div>
                </div>

                {/* Upload Progress Bars */}
                {Object.entries(uploadProgress).length > 0 && (
                  <div className="mb-4 space-y-2">
                    {Object.entries(uploadProgress).map(([fileKey, data]) => (
                      <div key={fileKey} className="border-2 border-black bg-white p-2">
                        <div className="flex justify-between items-center mb-1">
                          <p className="text-xs font-bold truncate">{fileKey.split("_")[0]}</p>
                          <span className={`text-xs font-black px-1 border border-black ${
                            data.status === "complete" ? "bg-green-300" :
                            data.status === "error" ? "bg-red-300" : "bg-yellow-300"
                          }`}>
                            {data.status.toUpperCase()}
                          </span>
                        </div>
                        <div className="w-full bg-gray-300 border-2 border-black h-3">
                          <div
                            className="bg-black h-full transition-all"
                            style={{ width: `${data.progress}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {quotations.length === 0 ? (
                  <p className="text-sm font-bold opacity-70">
                    NO QUOTATIONS UPLOADED YET
                  </p>
                ) : (
                  <div className="space-y-3">
                    {quotations.map((quote) => (
                      <div
                        key={quote.id}
                        className={`border-4 border-black p-3 ${
                          quote.status === "analyzed"
                            ? "bg-green-300"
                            : quote.status === "error"
                            ? "bg-red-300"
                            : quote.status === "canceled"
                            ? "bg-gray-300"
                            : "bg-white"
                        }`}
                      >
                        <div className="flex justify-between items-start gap-2">
                          <div className="flex-1">
                            <p className="font-black text-sm uppercase">
                              {quote.vendorName}
                            </p>
                            <p className="text-xs font-bold mt-1 opacity-70">
                              ID: {quote.id.substring(0, 8)}
                            </p>
                          </div>
                          <div className="flex gap-2 items-start">
                            <span
                              className={`text-xs font-black uppercase px-2 py-1 border-2 border-black whitespace-nowrap ${
                                quote.status === "processing"
                                  ? "bg-yellow-400"
                                  : quote.status === "analyzed"
                                  ? "bg-green-300"
                                  : quote.status === "canceled"
                                  ? "bg-gray-400"
                                  : "bg-red-300"
                              }`}
                            >
                              {quote.status}
                            </span>
                            {(quote.status === "processing" || quote.status === "error") && (
                              <button
                                onClick={() => handleCancelQuotation(quote.id, quote.vendorName)}
                                className="bg-red-500 hover:bg-red-700 text-white font-black border-2 border-black p-1 w-7 h-7 flex items-center justify-center transition-all text-sm"
                                title="Cancel and remove from processing"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        </div>

                        {quote.errorMessage && (
                          <p className="text-xs font-bold mt-2 text-red-700">
                            Error: {quote.errorMessage}
                          </p>
                        )}

                        {quote.parsedData && (
                          <div className="text-xs font-bold mt-2 space-y-1">
                            <p>
                              Score: {quote.parsedData.complianceScore}%
                            </p>
                            {quote.parsedData.totalCost !== undefined && quote.parsedData.totalCost !== null && (
                              <p>
                                Cost: {quote.finalJsonReport?.currency || targetCurrency} {quote.parsedData.totalCost.toLocaleString()}
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

        {/* Info Box - Disclaimer */}
        <div className="w-full bg-white border-4 border-black p-4 md:p-6 lg:p-8 text-center space-y-3 md:space-y-4">
          <p className="font-bold text-sm md:text-base">
            UPLOAD BASE REQUIREMENTS FIRST, THEN ADD VENDOR QUOTATIONS
          </p>
          <p className="text-xs md:text-sm font-bold mt-2 opacity-70">
            AI EXTRACTION RUNS AUTOMATICALLY (BATCHED: 5 CONCURRENT) | PROCESSING 30-60 SECONDS PER FILE
          </p>
          <p className="text-xs md:text-sm font-bold mt-2 opacity-70">
            WHEN READY, CLICK "CLOSE SESSION" TO GENERATE FINAL ADJUDICATION AND VENDOR RANKING
          </p>
        </div>
      </div>
    </div>
  );
}
