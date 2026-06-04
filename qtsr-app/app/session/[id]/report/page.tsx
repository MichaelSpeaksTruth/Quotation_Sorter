"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { auth, rtdb } from "@/lib/firebase";
import { ref, onValue } from "firebase/database";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { Session, Quotation } from "@/lib/types";
import { analyzePrecision } from "@/lib/measurementValidation";

const formatSpecKey = (key: string) => {
  const mapping: Record<string, string> = {
    vendorName: "Vendor Name",
    surface_roughness_microns: "Surface Roughness (microns)",
    target_budget_usd: "Target Budget (USD)",
    chord_length_mm: "Chord Length (mm)",
    span_mm: "Span (mm)",
    internal_coolant_pressure_kpa: "Internal Coolant Pressure (kPa)",
    quantity: "Quantity",
    unit: "Unit",
    certifications: "Certifications"
  };
  return mapping[key] || key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
};

export default function ReportPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;

  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [baseReqs, setBaseReqs] = useState<string[]>([]);
  const [currentTime, setCurrentTime] = useState<string>("");

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

  // Real-time clock for open sessions
  useEffect(() => {
    if (session?.status === "open") {
      const updateClock = () => {
        const now = new Date();
        const day = String(now.getDate()).padStart(2, "0");
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const year = now.getFullYear();
        const hours = String(now.getHours()).padStart(2, "0");
        const minutes = String(now.getMinutes()).padStart(2, "0");
        const seconds = String(now.getSeconds()).padStart(2, "0");
        setCurrentTime(`${day}/${month}/${year} ${hours}:${minutes}:${seconds}`);
      };

      updateClock(); // Set immediately
      const interval = setInterval(updateClock, 1000); // Update every second
      return () => clearInterval(interval);
    }
  }, [session?.status]);

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

          // Extract base requirements text into array
          if (data.baseRequirements?.extractedText) {
            const reqText = data.baseRequirements.extractedText;
            const reqs = reqText
              .split("\n")
              .filter((line: string) => line.trim().length > 0)
              .slice(0, 20); // Limit to first 20 lines
            setBaseReqs(reqs);
          }
        }
      },
      (error) => {
        console.error("Error loading session:", error);
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
          const quoteList: Quotation[] = Object.entries(data)
            .map(([id, value]) => ({
              id,
              sessionId,
              ...(value as Omit<Quotation, "id" | "sessionId">),
            }))
            .filter((q) => q.status === "analyzed");

          setQuotations(
            quoteList.sort((a, b) => b.uploadedAt - a.uploadedAt)
          );
        }
        setLoading(false);
      },
      (error) => {
        console.error("Error loading quotations:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [sessionId, user]);

  const getRecommendationColor = (rec: string) => {
    switch (rec?.toUpperCase()) {
      case "APPROVED":
      case "HIGHLY_RECOMMENDED":
      case "PASS":
        return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25";
      case "CONDITIONAL":
      case "RECOMMENDED":
        return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25";
      case "REJECTED":
      case "WARNING":
      case "FAIL":
        return "bg-rose-500/10 text-rose-600 dark:text-rose-500 border border-rose-500/25";
      default:
        return "bg-zinc-500/10 text-zinc-400 dark:text-zinc-400 border border-zinc-500/25";
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 font-sans text-zinc-900 dark:text-zinc-50">
        <div className="relative w-12 h-12 flex items-center justify-center">
          <span className="absolute w-full h-full border-4 border-zinc-200 dark:border-zinc-800 rounded-full" />
          <span className="absolute w-full h-full border-4 border-t-blue-600 dark:border-t-blue-500 rounded-full animate-spin" />
        </div>
        <p className="text-xs font-mono font-bold tracking-widest text-zinc-400 dark:text-zinc-500 uppercase animate-pulse">
          Loading Compliance Report...
        </p>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-6 text-zinc-900 dark:text-zinc-50 font-sans antialiased">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 w-full border-b border-zinc-200 dark:border-zinc-800 pb-5 print:pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold uppercase tracking-tight text-zinc-900 dark:text-zinc-50">
            Compliance Report
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 font-mono uppercase leading-none">
            Session: <span className="text-zinc-900 dark:text-zinc-100 font-bold font-sans">{session?.title}</span>
          </p>
        </div>

        <button
          onClick={() => router.push(`/session/${sessionId}`)}
          className="inline-flex w-auto items-center gap-2 px-4 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-semibold rounded-md transition-all shadow-sm text-xs tracking-wider uppercase cursor-pointer active:scale-95 duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-950 focus-visible:ring-blue-600 print:hidden"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Workspace
        </button>
      </div>

      {/* Base Requirements Section */}
      <div className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm">
        <h2 className="text-xs font-bold tracking-widest text-zinc-400 dark:text-zinc-500 uppercase mb-3 select-none">
          Base Requirements
        </h2>

        {baseReqs.length > 0 ? (
          (() => {
            const rawText = session?.baseRequirements?.extractedText || "";
            const isJson = rawText.trim().startsWith("{") || rawText.trim().startsWith("[");
            if (isJson) {
              return (
                <div className="relative rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-950">
                  <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 font-mono text-[9px] uppercase font-bold tracking-widest text-zinc-400 dark:text-zinc-500 select-none">
                    <span>baseline_specification.json</span>
                    <span className="text-blue-600 dark:text-blue-400">Read Only</span>
                  </div>
                  <pre className="font-mono text-[11px] text-zinc-600 dark:text-zinc-300 p-4 overflow-auto max-h-48 scrollbar-thin leading-relaxed">
                    <code>{rawText}</code>
                  </pre>
                </div>
              );
            }
            return (
              <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-3.5 bg-zinc-50/50 dark:bg-zinc-950/30 max-h-32 overflow-y-auto">
                <ul className="space-y-1.5">
                  {baseReqs.map((req, idx) => (
                    <li key={idx} className="text-xs text-zinc-600 dark:text-zinc-300 font-medium flex gap-2">
                      <span className="text-blue-600 dark:text-blue-400 font-bold select-none">•</span>
                      <span>{req}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()
        ) : (
          <div className="border border-amber-200 bg-amber-500/5 text-amber-700 dark:text-amber-400 rounded-lg p-3 text-xs font-medium uppercase tracking-tight">
            No base requirements uploaded
          </div>
        )}
      </div>

      {/* Comparison Matrix */}
      {quotations.length > 0 ? (
        <div className="w-full overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/50 font-mono text-[10px] tracking-wider uppercase text-zinc-400 dark:text-zinc-500 select-none">
                <th className="p-3.5 font-bold">Vendor</th>
                <th className="p-3.5 font-bold">Total Cost</th>
                <th className="p-3.5 font-bold text-center">Compliance</th>
                <th className="p-3.5 font-bold">Matched Specs</th>
                <th className="p-3.5 font-bold">Missing Specs</th>
                <th className="p-3.5 font-bold">Delivery</th>
                <th className="p-3.5 font-bold text-center">Recommendation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {quotations.map((quote) => {
                const report = quote.finalJsonReport;
                const matched = report?.matchedRequirements || [];
                const missing = report?.missingRequirements || [];
                const recommendation = report?.overallRecommendation || "N/A";
                const score = quote.parsedData?.complianceScore || 0;

                return (
                  <tr 
                    key={quote.id} 
                    className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors"
                  >
                    <td className="p-3.5 font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-tight whitespace-nowrap">
                      {quote.vendorName}
                    </td>
                    <td className="p-3.5 font-mono text-xs font-bold text-zinc-700 dark:text-zinc-300">
                      {quote.finalJsonReport?.currency || "INR"} {quote.parsedData?.totalCost?.toLocaleString() || "0"}
                    </td>
                    <td className="p-3.5 text-center whitespace-nowrap">
                      <span
                        className={`font-mono text-xs font-bold px-2 py-0.5 rounded-md border ${
                          score >= 80
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                            : score >= 50
                            ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                            : "bg-rose-500/10 text-rose-600 dark:text-rose-500 border border-rose-500/20"
                        }`}
                      >
                        {score}%
                      </span>
                    </td>
                    <td className="p-3.5 max-w-[280px]">
                      <div className="flex flex-wrap gap-1 max-w-full">
                        {matched.length > 0 ? (
                          <>
                            {matched.slice(0, 4).map((spec: string, idx: number) => (
                              <span key={idx} className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/15 px-2 py-0.5 rounded truncate max-w-full" title={spec}>
                                {spec}
                              </span>
                            ))}
                            {matched.length > 4 && (
                              <span className="text-[9px] font-mono font-bold text-zinc-400 px-1.5 py-0.5 select-none bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded">
                                +{matched.length - 4} more
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-[11px] text-zinc-400 select-none">—</span>
                        )}
                      </div>
                    </td>
                    <td className="p-3.5 max-w-[280px]">
                      <div className="flex flex-wrap gap-1 max-w-full">
                        {missing.length > 0 ? (
                          <>
                            {missing.slice(0, 4).map((spec: string, idx: number) => (
                              <span key={idx} className="text-[10px] bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/15 px-2 py-0.5 rounded truncate max-w-full" title={spec}>
                                {spec}
                              </span>
                            ))}
                            {missing.length > 4 && (
                              <span className="text-[9px] font-mono font-bold text-zinc-400 px-1.5 py-0.5 select-none bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded">
                                +{missing.length - 4} more
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-[11px] text-zinc-400 select-none">—</span>
                        )}
                      </div>
                    </td>
                    <td className="p-3.5 text-zinc-600 dark:text-zinc-400 font-medium whitespace-nowrap">
                      {report?.deliveryTime || "N/A"}
                    </td>
                    <td className="p-3.5 text-center whitespace-nowrap">
                      <span className={`px-2.5 py-1 rounded-md text-[9px] font-bold tracking-widest uppercase inline-flex border leading-none ${getRecommendationColor(recommendation)}`}>
                        {recommendation}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-xl p-10 text-center shadow-sm">
          <p className="font-mono text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">
            No Analyzed Quotations Yet
          </p>
          <p className="text-xs text-zinc-500 mt-2">
            Upload vendor quotations inside the session workspace to begin analysis.
          </p>
        </div>
      )}

      {/* Detailed Reports */}
      {quotations.length > 0 && (
        <div className="space-y-6 mt-2 print:mt-4">
          <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500 select-none">
            Detailed Quotation Analysis
          </h2>

          {quotations.map((quote) => {
            const report = quote.finalJsonReport;

            return (
              <div
                key={quote.id}
                className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm flex flex-col gap-5 print:break-inside-avoid print:bg-white"
              >
                <div className="flex justify-between items-center pb-3 border-b border-zinc-200 dark:border-zinc-800">
                  <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50 uppercase tracking-tight">
                    {quote.vendorName}
                  </h3>
                  <span className={`px-2.5 py-1 rounded-md text-[9px] font-bold tracking-widest uppercase inline-flex border leading-none ${getRecommendationColor(report?.overallRecommendation)}`}>
                    {report?.overallRecommendation || "N/A"}
                  </span>
                </div>

                {/* Precision Validation Section */}
                {(() => {
                  const precisionAnalysis = analyzePrecision(report || {});
                  const precisionStatus = quote.finalJsonReport?.precisionValidation || "UNKNOWN";
                  const hasPrecisionIssues = precisionAnalysis.criticalIssues > 0;
                  
                  return (
                    <div
                      className={`border rounded-lg p-4 transition-all ${
                        hasPrecisionIssues
                          ? "border-rose-500/25 bg-rose-500/5 text-rose-900 dark:text-rose-100"
                          : "border-emerald-500/25 bg-emerald-500/5 text-emerald-900 dark:text-emerald-100"
                      }`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500 leading-none">
                          Measurement Precision Validation
                        </p>
                        <span
                          className={`px-2 py-0.5 text-[9px] font-mono font-bold leading-none uppercase rounded border ${
                            precisionStatus === "PASS"
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                              : precisionStatus === "FAIL"
                              ? "bg-rose-500/10 text-rose-600 dark:text-rose-500 border-rose-500/20"
                              : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                          }`}
                        >
                          {precisionStatus}
                        </span>
                      </div>

                      <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 leading-relaxed">
                        {precisionAnalysis.summary}
                      </p>

                      {precisionAnalysis.totalIssues > 0 && (
                        <div className="space-y-2 mt-3 border-t border-zinc-200/50 dark:border-zinc-800 pt-3">
                          {precisionAnalysis.issues.map((issue, idx) => (
                            <div
                              key={idx}
                              className="text-xs font-mono border-l-2 border-zinc-300 dark:border-zinc-700 pl-3 py-0.5"
                            >
                              <p className="uppercase tracking-wide font-bold text-zinc-800 dark:text-zinc-200 text-[10px]">
                                [{issue.severity}] {issue.type}
                              </p>
                              <p className="text-zinc-400 dark:text-zinc-400 mt-0.5 text-xs">{issue.description}</p>
                              {issue.requirement !== "See measurementPrecisionErrors" && (
                                <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5 leading-none">
                                  Req: {issue.requirement} | Vendor: {issue.vendor}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {precisionAnalysis.totalIssues === 0 && (
                        <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400/80 mt-1 leading-none">
                          All measurements meet requirements within tolerance.
                        </p>
                      )}
                    </div>
                  );
                })()}

                {/* Key Metrics Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="border border-zinc-200 dark:border-zinc-800 p-3 rounded-lg bg-zinc-50/50 dark:bg-zinc-950/20">
                    <p className="text-[10px] font-mono font-bold tracking-wider text-zinc-400 dark:text-zinc-500 uppercase mb-1">
                      Total Cost
                    </p>
                    <p className="text-sm font-bold font-mono leading-none text-zinc-800 dark:text-zinc-200">
                      {quote.finalJsonReport?.currency || "INR"} {quote.parsedData?.totalCost?.toLocaleString() || "0"}
                    </p>
                  </div>

                  <div className="border border-zinc-200 dark:border-zinc-800 p-3 rounded-lg bg-zinc-50/50 dark:bg-zinc-950/20">
                    <p className="text-[10px] font-mono font-bold tracking-wider text-zinc-400 dark:text-zinc-500 uppercase mb-1">
                      Compliance Score
                    </p>
                    <p className="text-sm font-bold font-mono leading-none text-zinc-800 dark:text-zinc-200">
                      {quote.parsedData?.complianceScore || 0}%
                    </p>
                  </div>

                  <div className="border border-zinc-200 dark:border-zinc-800 p-3 rounded-lg bg-zinc-50/50 dark:bg-zinc-950/20">
                    <p className="text-[10px] font-mono font-bold tracking-wider text-zinc-400 dark:text-zinc-500 uppercase mb-1">
                      Delivery
                    </p>
                    <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 truncate">
                      {report?.deliveryTime || "Not specified"}
                    </p>
                  </div>

                  <div className="border border-zinc-200 dark:border-zinc-800 p-3 rounded-lg bg-zinc-50/50 dark:bg-zinc-950/20">
                    <p className="text-[10px] font-mono font-bold tracking-wider text-zinc-400 dark:text-zinc-500 uppercase mb-1">
                      Certifications
                    </p>
                    <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 truncate" title={report?.certifications?.join(", ") || "None listed"}>
                      {report?.certifications?.length
                        ? report.certifications.join(", ")
                        : "None listed"}
                    </p>
                  </div>
                </div>

                {/* Critical Issues Alert Box */}
                {report?.criticalIssues && report.criticalIssues.length > 0 && (
                  <div className="border border-rose-500/25 bg-rose-500/5 rounded-lg p-3 text-rose-900 dark:text-rose-200">
                    <p className="text-[10px] font-mono font-bold uppercase tracking-wider mb-2 text-rose-600 dark:text-rose-400">
                      ⚠ Critical Issues Identified
                    </p>
                    <ul className="space-y-1 text-xs font-semibold">
                      {report.criticalIssues.map((issue: string, idx: number) => (
                        <li key={idx} className="flex gap-1.5 items-start">
                          <span className="text-rose-500 font-bold select-none">•</span>
                          <span>{issue}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Validator Notes Box */}
                {report?.validationNotes && (
                  <div className="border border-zinc-200 dark:border-zinc-800 p-3 rounded-lg bg-zinc-50/30 dark:bg-zinc-950/10 text-xs">
                    <p className="text-[10px] font-mono font-bold tracking-wider text-zinc-400 dark:text-zinc-500 uppercase mb-1">
                      Validator Notes
                    </p>
                    <p className="font-medium text-zinc-600 dark:text-zinc-300 leading-relaxed">
                      {report.validationNotes}
                    </p>
                  </div>
                )}

                {/* AI Audit & Conversion Logs */}
                <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl bg-zinc-50/50 dark:bg-zinc-950/10 p-4">
                  <h4 className="text-xs font-mono font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500 pb-2 border-b border-zinc-200 dark:border-zinc-800 mb-3 select-none">
                    🔬 AI Audit & Conversion Logs
                  </h4>

                  {/* Unit Conversions */}
                  {report?.unitConversions && report.unitConversions.length > 0 ? (
                    <div className="mb-4">
                      <p className="text-[10px] font-mono font-bold tracking-wider text-emerald-600 dark:text-emerald-400 uppercase mb-2">
                        ✓ Successful Conversions ({report.unitConversions.length})
                      </p>
                      <div className="space-y-1.5">
                        {report.unitConversions.map(
                          (conversion: string, idx: number) => (
                            <div
                              key={idx}
                              className="bg-emerald-500/5 border border-emerald-500/20 p-2.5 rounded-md font-mono text-xs text-emerald-800 dark:text-emerald-300 leading-tight"
                            >
                              <span className="font-bold mr-1.5">✔ PASS:</span>
                              {conversion}
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="mb-4 bg-zinc-100/50 dark:bg-zinc-900/30 border border-zinc-200/50 dark:border-zinc-800 p-2.5 rounded-md font-mono text-xs text-zinc-400 select-none">
                      — No unit conversions required
                    </div>
                  )}

                  {/* Measurement Precision Errors */}
                  {report?.measurementPrecisionErrors &&
                  report.measurementPrecisionErrors.length > 0 ? (
                    <div>
                      <p className="text-[10px] font-mono font-bold tracking-wider text-rose-600 dark:text-rose-400 uppercase mb-2">
                        ⚠ Critical Dealbreakers ({report.measurementPrecisionErrors.length})
                      </p>
                      <div className="space-y-1.5">
                        {report.measurementPrecisionErrors.map(
                          (error: string, idx: number) => (
                            <div
                              key={idx}
                              className="bg-rose-500/5 border border-rose-500/20 p-2.5 rounded-md font-mono text-xs text-rose-700 dark:text-rose-300 leading-tight font-semibold"
                            >
                              <span className="font-bold mr-1.5">✗ FAIL:</span>
                              {error}
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="bg-emerald-500/5 border border-emerald-500/10 p-2.5 rounded-md font-mono text-xs text-emerald-600/70 dark:text-emerald-400/70 select-none">
                      — No measurement precision errors detected
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Adjudication Results */}
      {session?.status === "closed" && session?.adjudicationResult && (
        <div className="space-y-6 mt-2 print:mt-4 print:break-inside-avoid">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 md:p-6 shadow-sm flex flex-col gap-6">
            <div>
              <h2 className="text-lg md:text-xl font-bold uppercase tracking-tight text-zinc-900 dark:text-zinc-50">
                Final Adjudication & Vendor Ranking
              </h2>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1 font-mono uppercase leading-none select-none">
                Closed Session Executive Review
              </p>
            </div>

            {/* Best Vendor Highlight */}
            {session.adjudicationResult.bestVendor && (
              <div className="relative border border-emerald-500/25 bg-emerald-500/5 dark:bg-emerald-500/2 rounded-xl p-5 shadow-sm overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 dark:bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />
                
                <div className="flex items-center gap-1.5 text-[9px] font-mono font-bold tracking-widest text-emerald-600 dark:text-emerald-400 uppercase mb-2">
                  <span>🏆 Recommended Prime Vendor</span>
                </div>
                <p className="text-lg md:text-xl font-bold uppercase tracking-tight text-zinc-900 dark:text-zinc-50">
                  {session.adjudicationResult.bestVendor.vendorName}
                </p>
                
                <div className="flex items-baseline gap-1 mt-2 mb-3">
                  <span className="text-[9px] font-mono font-bold tracking-wider text-zinc-400 dark:text-zinc-500 uppercase">Composite Score:</span>
                  <span className="text-base font-mono font-bold leading-none text-emerald-600 dark:text-emerald-400 ml-1">
                    {session.adjudicationResult.bestVendor.overallScore}
                  </span>
                  <span className="text-[9px] font-mono leading-none text-zinc-400">/100</span>
                </div>

                <p className="text-xs sm:text-sm font-medium text-zinc-600 dark:text-zinc-300 leading-relaxed border-t border-zinc-200/50 dark:border-zinc-800 pt-3">
                  {session.adjudicationResult.bestVendor.rationale}
                </p>
              </div>
            )}

            {/* Vendor Ranking Table */}
            {session.adjudicationResult.ranking && session.adjudicationResult.ranking.length > 0 && (
              <div className="space-y-3 mt-2">
                <p className="text-[10px] font-mono font-bold tracking-widest text-zinc-400 dark:text-zinc-500 uppercase select-none">
                  Comparative Adjudication Ranking Matrix
                </p>
                <div className="flex flex-col gap-4">
                  {session.adjudicationResult.ranking.map((vendor: any, idx: number) => {
                    const recColor = 
                      vendor.recommendation === "HIGHLY_RECOMMENDED"
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                        : vendor.recommendation === "RECOMMENDED"
                        ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                        : vendor.recommendation === "CONDITIONAL"
                        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                        : "bg-rose-500/10 text-rose-600 dark:text-rose-500 border border-rose-500/20";

                    return (
                      <div
                        key={idx}
                        className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 bg-white dark:bg-zinc-950/40 shadow-sm flex flex-col gap-4"
                      >
                        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                          <div>
                            <p className="text-[10px] font-mono font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider leading-none select-none">
                              Rank #{vendor.rank}
                            </p>
                            <p className="text-base font-bold uppercase tracking-tight text-zinc-900 dark:text-zinc-100 mt-1">
                              {vendor.vendorName}
                            </p>
                          </div>
                          
                          <div className="flex items-center gap-3 self-stretch sm:self-auto justify-between select-none">
                            <div className="flex items-baseline">
                              <span className="text-base font-mono font-bold leading-none text-zinc-800 dark:text-zinc-200">
                                {vendor.overallScore}
                              </span>
                              <span className="text-[9px] font-mono leading-none text-zinc-400">/100</span>
                            </div>
                            <span className={`px-2.5 py-1 rounded-md text-[9px] font-bold tracking-widest uppercase border leading-none ${recColor}`}>
                              {vendor.recommendation}
                            </span>
                          </div>
                        </div>

                        {/* Score Breakdown Grid */}
                        <div className="grid grid-cols-4 gap-2 bg-zinc-50/50 dark:bg-zinc-950/30 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 text-center">
                          <div>
                            <p className="text-[9px] font-mono font-bold tracking-tight text-zinc-400 dark:text-zinc-500 uppercase">Compliance</p>
                            <p className="text-sm font-bold font-mono leading-none mt-1 text-zinc-800 dark:text-zinc-200">
                              {vendor.scoringBreakdown.compliance}
                            </p>
                          </div>
                          <div>
                            <p className="text-[9px] font-mono font-bold tracking-tight text-zinc-400 dark:text-zinc-500 uppercase">Cost</p>
                            <p className="text-sm font-bold font-mono leading-none mt-1 text-zinc-800 dark:text-zinc-200">
                              {vendor.scoringBreakdown.cost}
                            </p>
                          </div>
                          <div>
                            <p className="text-[9px] font-mono font-bold tracking-tight text-zinc-400 dark:text-zinc-500 uppercase">Precision</p>
                            <p className="text-sm font-bold font-mono leading-none mt-1 text-zinc-800 dark:text-zinc-200">
                              {vendor.scoringBreakdown.precision}
                            </p>
                          </div>
                          <div>
                            <p className="text-[9px] font-mono font-bold tracking-tight text-zinc-400 dark:text-zinc-500 uppercase">Delivery</p>
                            <p className="text-sm font-bold font-mono leading-none mt-1 text-zinc-800 dark:text-zinc-200">
                              {vendor.scoringBreakdown.delivery}
                            </p>
                          </div>
                        </div>

                        <p className="text-xs sm:text-sm font-medium text-zinc-600 dark:text-zinc-300 leading-relaxed">
                          {vendor.rationale}
                        </p>

                        {vendor.criticalGaps && vendor.criticalGaps.length > 0 && (
                          <div className="border border-rose-500/20 bg-rose-500/5 rounded-lg p-2.5">
                            <p className="text-[9px] font-mono font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400 mb-1">
                              Critical Gaps Identified:
                            </p>
                            <ul className="text-xs text-rose-800 dark:text-rose-300 font-semibold space-y-0.5">
                              {vendor.criticalGaps.map((gap: string, gapIdx: number) => (
                                <li key={gapIdx} className="flex gap-1 items-start">
                                  <span className="text-rose-500 font-bold select-none">•</span>
                                  <span>{gap}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Comparative Analysis Graphs placeholder */}
            {session.adjudicationResult && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                {/* Cost Analysis */}
                {session.adjudicationResult.costAnalysis && (
                  <div className="border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl bg-white dark:bg-zinc-950/20">
                    <p className="text-[9px] font-mono font-bold tracking-widest text-zinc-400 dark:text-zinc-500 uppercase mb-3 border-b border-zinc-200 dark:border-zinc-800 pb-1.5">
                      Cost Matrix Analysis
                    </p>
                    <div className="space-y-2 text-xs font-semibold">
                      <div className="flex justify-between items-center">
                        <span className="text-zinc-500">Lowest Quote:</span>
                        <span className="font-mono leading-none text-zinc-800 dark:text-zinc-200">
                          {session.adjudicationResult.costAnalysis.lowestCost?.vendor}{" "}
                          ({session.adjudicationResult.costAnalysis.lowestCost?.cost?.toLocaleString()})
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-zinc-500">Average Quote:</span>
                        <span className="font-mono leading-none text-zinc-800 dark:text-zinc-200">
                          INR {session.adjudicationResult.costAnalysis.averageCost?.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-zinc-500">Highest Quote:</span>
                        <span className="font-mono leading-none text-zinc-800 dark:text-zinc-200">
                          {session.adjudicationResult.costAnalysis.highestCost?.vendor}{" "}
                          ({session.adjudicationResult.costAnalysis.highestCost?.cost?.toLocaleString()})
                        </span>
                      </div>
                      <div className="flex justify-between items-center border-t border-zinc-200 dark:border-zinc-800 pt-2 mt-2">
                        <span className="text-zinc-500 font-bold">Total Spread:</span>
                        <span className="font-mono leading-none text-amber-600 dark:text-amber-400 font-bold">
                          {session.adjudicationResult.costAnalysis.costDifferencePercent}%
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Compliance Analysis */}
                {session.adjudicationResult.complianceAnalysis && (
                  <div className="border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl bg-white dark:bg-zinc-950/20">
                    <p className="text-[9px] font-mono font-bold tracking-widest text-zinc-400 dark:text-zinc-500 uppercase mb-3 border-b border-zinc-200 dark:border-zinc-800 pb-1.5 select-none">
                      Compliance Tiers
                    </p>
                    <div className="space-y-3.5 text-xs">
                      {session.adjudicationResult.complianceAnalysis.fullCompliance?.length > 0 && (
                        <div className="flex flex-col gap-1.5 border-b border-zinc-200 dark:border-zinc-800/40 pb-2">
                          <span className="text-emerald-600 dark:text-emerald-400 font-mono text-[9px] font-bold uppercase tracking-wider">Full Compliance</span>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {session.adjudicationResult.complianceAnalysis.fullCompliance.map((vendor: string, vidx: number) => (
                              <span key={vidx} className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/15 px-2 py-0.5 rounded text-[10px] font-bold tracking-tight">{vendor}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {session.adjudicationResult.complianceAnalysis.partialCompliance?.length > 0 && (
                        <div className="flex flex-col gap-1.5 border-b border-zinc-200 dark:border-zinc-800/40 pb-2">
                          <span className="text-amber-600 dark:text-amber-400 font-mono text-[9px] font-bold uppercase tracking-wider">Partial Compliance</span>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {session.adjudicationResult.complianceAnalysis.partialCompliance.map((vendor: string, vidx: number) => (
                              <span key={vidx} className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/15 px-2 py-0.5 rounded text-[10px] font-bold tracking-tight">{vendor}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {session.adjudicationResult.complianceAnalysis.nonCompliant?.length > 0 && (
                        <div className="flex flex-col gap-1.5 border-b border-zinc-200 dark:border-zinc-800/40 pb-2">
                          <span className="text-rose-600 dark:text-rose-400 font-mono text-[9px] font-bold uppercase tracking-wider">Non-compliant</span>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {session.adjudicationResult.complianceAnalysis.nonCompliant.map((vendor: string, vidx: number) => (
                              <span key={vidx} className="bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/15 px-2 py-0.5 rounded text-[10px] font-bold tracking-tight">{vendor}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="flex justify-between items-center pt-2 select-none">
                        <span className="text-zinc-500 font-medium">Average Compliance:</span>
                        <span className="font-mono leading-none text-zinc-900 dark:text-zinc-100 font-extrabold text-sm">
                          {session.adjudicationResult.complianceAnalysis.averageComplianceScore}%
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Adjudication Notes */}
            {session.adjudicationResult.adjudicationNotes && (
              <div className="border border-zinc-200 dark:border-zinc-800 p-4 rounded-lg bg-zinc-50/50 dark:bg-zinc-950/20 text-xs mt-2">
                <p className="text-[10px] font-mono font-bold tracking-wider text-zinc-400 dark:text-zinc-500 uppercase mb-2 select-none">
                  Executive Summary & Notes
                </p>
                <p className="font-medium text-zinc-600 dark:text-zinc-300 leading-relaxed">
                  {session.adjudicationResult.adjudicationNotes}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Disclaimer Box */}
      <div
        className="border border-rose-500/25 bg-rose-500/5 rounded-xl p-5 md:p-6 shadow-sm"
        role="alert"
      >
        <div className="flex items-center gap-2 mb-3 select-none">
          <span className="text-rose-600 dark:text-rose-400 text-lg">⚠</span>
          <h3 className="text-sm font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
            Critical Compliance & AI Disclaimer
          </h3>
        </div>

        <div className="space-y-3.5 text-zinc-400 dark:text-zinc-400 font-medium text-xs leading-relaxed">
          <p>
            This analysis is algorithmically generated by large language models (LLM) incorporating a multi-stage precision validation pipeline.
          </p>

          <p>
            While rigorous, this assessment may contain algorithmic inaccuracies, omissions, or misinterpretations of complex technical parameters.
          </p>

          <p>
            Mandatory review by a qualified procurement officer and contractual legal counsel is required before committing to any vendor engagement or agreement.
          </p>

          <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-3.5 text-rose-600 dark:text-rose-400 font-bold text-xs select-none shadow-sm leading-relaxed">
            ⚠ WARNING: Do not under any circumstances rely solely on this report for commercial decision-making.
          </div>

          <p className="text-[9px] font-mono uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mt-3.5 select-none font-bold">
            FINAL ADJUDICATION AUTHORITY: PROCUREMENT OFFICER OF RECORD
          </p>
        </div>
      </div>

      {/* Export/Print Footer */}
      <div className="flex flex-col items-center justify-center gap-4 mt-8 pb-8 w-full border-t border-zinc-200 dark:border-zinc-800 pt-8 print:hidden select-none">
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2.5 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-md text-xs uppercase tracking-wider transition-all shadow-sm cursor-pointer active:scale-95 duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-950 focus-visible:ring-blue-600"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          Print Audit Report
        </button>

        <p className="text-[10px] font-mono font-bold leading-none text-zinc-400 dark:text-zinc-500 mt-2 select-none">
          {session?.status === "closed" && session?.adjudicatedAt ? (
            <>
              Report generated: {new Date(session.adjudicatedAt).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric"
              })} {new Date(session.adjudicatedAt).toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false
              })}
            </>
          ) : (
            <>
              SYS_CLOCK // {currentTime || "SYNCING..."}
            </>
          )}
        </p>
      </div>
    </div>
  );
}
