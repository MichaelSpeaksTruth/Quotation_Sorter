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
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
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

      alert("Base requirements uploaded successfully!");
    } catch (error) {
      console.error("Error processing base requirements:", error);
      alert("Error processing file");
    }
  };

  // Handle quotation file upload with parallel processing (batch 5 at a time)
  const handleQuotationFile = async (files: FileList | null) => {
    if (!files || !user) return;

    const fileArray = Array.from(files);
    const maxConcurrent = 5; // Batch limit to avoid timeouts
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

    console.log(`Starting batch upload: ${filesToProcess.length} files (${maxConcurrent} concurrent)`);

    // Process files in batches
    for (let i = 0; i < filesToProcess.length; i += maxConcurrent) {
      const batch = filesToProcess.slice(i, i + maxConcurrent);
      const batchPromises = batch.map((file) => processQuotationFile(file));

      await Promise.all(batchPromises).catch((err) => {
        console.error("Batch processing error:", err);
      });

      // Wait a bit between batches to avoid overwhelming the backend
      if (i + maxConcurrent < filesToProcess.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
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

      // Trigger extraction pipeline
      if (!user) throw new Error("User not authenticated");
      const baseReqText = session?.baseRequirements?.extractedText || "";

      fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.uid,
          sessionId,
          quoteId,
          fileUrl: base64,
          baseRequirementsText: baseReqText,
        }),
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`API error: ${response.statusText}`);
          }
          setUploadProgress((prev) => ({
            ...prev,
            [fileKey]: { status: "complete", progress: 100 },
          }));
          uploadQueueRef.current.delete(quoteId);
        })
        .catch((err) => {
          console.error("Extraction API error:", err);
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

    const analyzedCount = quotations.filter((q) => q.status === "analyzed").length;
    const errorCount = quotations.filter((q) => q.status === "error").length;
    const processingCount = quotations.filter((q) => q.status === "processing").length;

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

      const response = await fetch("/api/adjudicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.uid,
          sessionId,
          baseRequirementsText: baseReqText,
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
    <div className="min-h-screen bg-[#FFFDD0] font-mono text-black overflow-x-hidden">
      <div className="w-full px-4 md:px-8 lg:px-12 max-w-[1600px] mx-auto py-4 md:py-8">
        {/* Header */}
        <div className="flex justify-between items-start">
          <div className="bg-white border-8 border-black p-6 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] flex-1">
            <h1 className="text-4xl font-black uppercase tracking-tighter">
              {session.title}
            </h1>
            <p className="text-sm font-bold mt-2">SESSION ID: {sessionId}</p>
            <p className="text-sm font-bold mt-1">STATUS: {session.status}</p>
          </div>

          <div className="flex gap-2 ml-4 flex-col">
            <button
              onClick={handleCloseSession}
              disabled={isClosingSession || quotations.length === 0}
              className={`px-6 py-3 font-black uppercase border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] transition-all ${
                isClosingSession || quotations.length === 0
                  ? "bg-gray-400 opacity-50 cursor-not-allowed"
                  : "bg-red-500 text-white hover:translate-x-1 hover:translate-y-1 hover:shadow-none"
              }`}
            >
              {isClosingSession ? "CLOSING..." : "CLOSE SESSION"}
            </button>

            <Link
              href={`/session/${sessionId}/report`}
              className="bg-black text-white px-6 py-3 font-black uppercase border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all text-center"
            >
              VIEW REPORT
            </Link>

            <button
              onClick={() => router.push("/dashboard")}
              className="px-6 py-3 font-black uppercase border-4 border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all"
            >
              BACK
            </button>
          </div>
        </div>

        {/* Two Column Layout */}
        <div className="flex flex-col lg:grid lg:grid-cols-3 gap-4 md:gap-6 lg:gap-8">
          {/* Left: Base Requirements */}
          <div className="col-span-1 w-full">
            <div className="bg-[#2D5A3D] border-4 border-black p-4 md:p-6 lg:p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] text-white">
              <h2 className="text-xl font-black uppercase mb-4 tracking-tight">
                1. BASE REQUIREMENTS
              </h2>

              {session.baseRequirements ? (
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
              ) : (
                <>
                  <div
                    onDragEnter={handleBaseReqDrag}
                    onDragLeave={handleBaseReqDrag}
                    onDragOver={handleBaseReqDrag}
                    onDrop={handleBaseReqDrop}
                    className={`border-4 border-dashed p-4 md:p-6 text-center cursor-pointer transition-all min-h-[200px] md:min-h-[250px] flex items-center justify-center ${
                      baseReqDragActive
                        ? "bg-yellow-300 text-black"
                        : "bg-white text-black"
                    }`}
                    onClick={() =>
                      baseReqInputRef.current?.click()
                    }
                  >
                    <p className="font-black uppercase text-sm">
                      DROP FILE HERE
                    </p>
                    <p className="text-xs font-bold mt-2">
                      PDF, TXT, JSON (Max 10MB)
                    </p>
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
                className={`border-4 border-dashed p-4 md:p-6 lg:p-8 text-center cursor-pointer transition-all mb-6 min-h-[250px] md:min-h-[300px] lg:min-h-[40vh] flex items-center justify-center ${
                  quoteDragActive
                    ? "bg-yellow-300"
                    : "bg-gray-50"
                }`}
                onClick={() =>
                  quoteInputRef.current?.click()
                }
              >
                <p className="font-black uppercase text-lg">
                  DROP QUOTATIONS HERE
                </p>
                <p className="text-sm font-bold mt-2">
                  OR CLICK TO SELECT FILES
                </p>
                <p className="text-xs font-bold mt-1 opacity-70">
                  Multiple files accepted | PDF, Images, TXT
                </p>
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
                    PROCESSING QUEUE ({quotations.length})
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
                            : "bg-white"
                        }`}
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-black text-sm uppercase">
                              {quote.vendorName}
                            </p>
                            <p className="text-xs font-bold mt-1 opacity-70">
                              ID: {quote.id.substring(0, 8)}
                            </p>
                          </div>
                          <span
                            className={`text-xs font-black uppercase px-2 py-1 border-2 border-black ${
                              quote.status === "processing"
                                ? "bg-yellow-400"
                                : quote.status === "analyzed"
                                ? "bg-green-300"
                                : "bg-red-300"
                            }`}
                          >
                            {quote.status}
                          </span>
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
                            <p>
                              Cost: ${quote.parsedData.totalCost}
                            </p>
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

        {/* Info Box */}
        <div className="bg-white border-4 border-black p-4 md:p-6 lg:p-8 text-center space-y-2 md:space-y-3">
          <p className="font-bold text-sm md:text-base">
            UPLOAD BASE REQUIREMENTS FIRST, THEN ADD VENDOR QUOTATIONS
          </p>
          <p className="text-xs font-bold mt-2 opacity-70">
            AI EXTRACTION RUNS AUTOMATICALLY (BATCHED: 5 CONCURRENT) | PROCESSING 30-60 SECONDS PER FILE
          </p>
          <p className="text-xs font-bold mt-2 opacity-70">
            WHEN READY, CLICK "CLOSE SESSION" TO GENERATE FINAL ADJUDICATION AND VENDOR RANKING
          </p>
        </div>
      </div>
    </div>
  );
}
