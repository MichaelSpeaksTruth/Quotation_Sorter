"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { auth, rtdb } from "@/lib/firebase";
import { ref, get, onValue } from "firebase/database";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { Session, Quotation } from "@/lib/types";
import { analyzePrecision } from "@/lib/measurementValidation";

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
      }
    );

    return () => unsubscribe();
  }, [sessionId, user]);

  const getRecommendationColor = (rec: string) => {
    switch (rec?.toUpperCase()) {
      case "APPROVED":
        return "bg-green-400 border-4 border-black";
      case "CONDITIONAL":
        return "bg-yellow-400 border-4 border-black";
      case "REJECTED":
        return "bg-red-400 border-4 border-black";
      default:
        return "bg-gray-300 border-4 border-black";
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FFFDD0] flex items-center justify-center">
        <p className="text-xl font-bold">LOADING REPORT...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFFDD0] text-black font-mono p-4 md:p-8 lg:p-12 overflow-x-hidden">
      <div className="max-w-[1600px] mx-auto flex flex-col gap-6 md:gap-8">
        {/* Header - Responsive Layout */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 w-full">
          <div className="bg-white border-8 border-black p-6 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] flex-1 w-full">
            <h1 className="text-4xl font-black uppercase tracking-tighter">
              COMPLIANCE REPORT
            </h1>
            <p className="text-sm font-bold mt-2">
              SESSION: {session?.title}
            </p>
          </div>

          <button
            onClick={() => router.push(`/session/${sessionId}`)}
            className="px-4 md:px-6 py-3 font-black uppercase border-4 border-black bg-black text-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all text-sm md:text-base whitespace-nowrap"
          >
            BACK TO WORKSPACE
          </button>
        </div>

        {/* Base Requirements Section */}
        <div className="w-full bg-white border-4 border-black p-4 md:p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
          <h2 className="text-2xl font-black uppercase mb-4 tracking-tight">
            BASE REQUIREMENTS
          </h2>

          {baseReqs.length > 0 ? (
            <div className="border-2 border-black p-3 bg-gray-50 max-h-32 overflow-y-auto">
              <ul className="space-y-2">
                {baseReqs.map((req, idx) => (
                  <li key={idx} className="text-sm font-bold flex gap-2">
                    <span className="font-black">•</span>
                    <span>{req}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="border-2 border-black p-3 bg-yellow-200 font-bold text-sm">
              NO BASE REQUIREMENTS UPLOADED
            </div>
          )}
        </div>

        {/* Comparison Matrix */}
        {quotations.length > 0 ? (
          <div className="mt-4 mb-4 overflow-x-auto border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
            <table className="w-full border-collapse bg-white">
              <thead>
                <tr className="bg-black text-white">
                  <th className="border-2 border-black p-2 font-black uppercase text-left text-xs">
                    VENDOR
                  </th>
                  <th className="border-2 border-black p-2 font-black uppercase text-left text-xs">
                    TOTAL COST
                  </th>
                  <th className="border-2 border-black p-2 font-black uppercase text-center text-xs">
                    COMPLIANCE %
                  </th>
                  <th className="border-2 border-black p-2 font-black uppercase text-left text-xs">
                    MATCHED SPECS
                  </th>
                  <th className="border-2 border-black p-2 font-black uppercase text-left text-xs">
                    MISSING SPECS
                  </th>
                  <th className="border-2 border-black p-2 font-black uppercase text-left text-xs">
                    DELIVERY
                  </th>
                  <th className="border-2 border-black p-2 font-black uppercase text-center text-xs">
                    RECOMMENDATION
                  </th>
                </tr>
              </thead>
              <tbody>
                {quotations.map((quote) => {
                  const report = quote.finalJsonReport;
                  const matched = report?.matchedRequirements || [];
                  const missing = report?.missingRequirements || [];
                  const recommendation = report?.overallRecommendation || "N/A";

                  return (
                    <tr key={quote.id} className="border-b-2 border-black">
                      <td className="border-2 border-black p-2 font-black uppercase text-xs">
                        {quote.vendorName}
                      </td>
                      <td className="border-2 border-black p-2 font-bold text-xs">
                        {quote.finalJsonReport?.currency || "N/A"} {quote.parsedData?.totalCost?.toLocaleString() || "N/A"}
                      </td>
                      <td
                        className={`border-2 border-black p-2 font-black text-center text-xs ${
                          (quote.parsedData?.complianceScore || 0) >= 80
                            ? "bg-green-300"
                            : (quote.parsedData?.complianceScore || 0) >= 50
                            ? "bg-yellow-300"
                            : "bg-red-300"
                        }`}
                      >
                        {quote.parsedData?.complianceScore || 0}%
                      </td>
                      <td className="border-2 border-black p-2 font-bold text-xs">
                        <div className="bg-green-200 border-2 border-black p-1 max-h-12 overflow-y-auto">
                          {matched.length > 0 ? (
                            <ul className="space-y-1">
                              {matched.slice(0, 3).map((spec: string, idx: number) => (
                                <li key={idx} className="text-xs">
                                  ✓ {spec}
                                </li>
                              ))}
                              {matched.length > 3 && (
                                <li className="text-xs font-black">
                                  +{matched.length - 3} more
                                </li>
                              )}
                            </ul>
                          ) : (
                            <span className="text-xs opacity-50">—</span>
                          )}
                        </div>
                      </td>
                      <td className="border-2 border-black p-2 font-bold text-xs">
                        <div className="bg-red-200 border-2 border-black p-1 max-h-12 overflow-y-auto">
                          {missing.length > 0 ? (
                            <ul className="space-y-1">
                              {missing.slice(0, 3).map((spec: string, idx: number) => (
                                <li key={idx} className="text-xs">
                                  ✗ {spec}
                                </li>
                              ))}
                              {missing.length > 3 && (
                                <li className="text-xs font-black">
                                  +{missing.length - 3} more
                                </li>
                              )}
                            </ul>
                          ) : (
                            <span className="text-xs opacity-50">—</span>
                          )}
                        </div>
                      </td>
                      <td className="border-2 border-black p-2 font-bold text-xs">
                        {report?.deliveryTime || "N/A"}
                      </td>
                      <td
                        className={`border-2 border-black p-2 font-black uppercase text-center text-xs ${getRecommendationColor(
                          recommendation
                        )}`}
                      >
                        {recommendation}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="bg-white border-4 border-black p-8 text-center mb-6">
            <p className="font-black uppercase text-base">
              NO ANALYZED QUOTATIONS YET
            </p>
            <p className="text-sm font-bold mt-1">
              UPLOAD QUOTATIONS TO BEGIN ANALYSIS
            </p>
          </div>
        )}

        {/* Detailed Reports */}
        {quotations.length > 0 && (
          <div className="space-y-8 mt-8 mb-8">
            <h2 className="text-2xl font-black uppercase tracking-tight">
              DETAILED ANALYSIS
            </h2>

            {quotations.map((quote) => {
              const report = quote.finalJsonReport;

              return (
                <div
                  key={quote.id}
                  className="bg-white border-2 border-black p-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
                >
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="text-lg font-black uppercase">
                      {quote.vendorName}
                    </h3>
                    <span
                      className={`px-2 py-1 font-black uppercase text-xs ${getRecommendationColor(
                        report?.overallRecommendation
                      )}`}
                    >
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
                        className={`mb-4 border-2 ${
                          hasPrecisionIssues
                            ? "border-red-600 bg-red-100"
                            : "border-green-600 bg-green-100"
                        } p-4`}
                      >
                        <div className="flex justify-between items-start mb-3">
                          <p className="font-black uppercase text-sm">
                            MEASUREMENT PRECISION VALIDATION
                          </p>
                          <span
                            className={`px-3 py-1 text-xs font-black uppercase border-2 border-black ${
                              precisionStatus === "PASS"
                                ? "bg-green-300"
                                : precisionStatus === "FAIL"
                                ? "bg-red-400"
                                : "bg-yellow-300"
                            }`}
                          >
                            {precisionStatus}
                          </span>
                        </div>

                        <p className="font-bold text-sm mb-3">
                          {precisionAnalysis.summary}
                        </p>

                        {precisionAnalysis.totalIssues > 0 && (
                          <div className="space-y-2">
                            {precisionAnalysis.issues.map((issue, idx) => (
                              <div
                                key={idx}
                                className="text-xs font-bold border-l-4 border-black pl-2 py-1"
                              >
                                <p className="uppercase">
                                  [{issue.severity}] {issue.type}
                                </p>
                                <p className="opacity-90">{issue.description}</p>
                                {issue.requirement !== "See measurementPrecisionErrors" && (
                                  <p className="text-xs opacity-75 mt-1">
                                    Req: {issue.requirement} | Vendor: {issue.vendor}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {precisionAnalysis.totalIssues === 0 && (
                          <p className="text-sm font-bold opacity-80">
                            All measurements meet requirements within tolerance
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  <div className="grid grid-cols-2 gap-6 mb-6">
                    <div className="border-2 border-black p-2 bg-gray-50">
                      <p className="text-xs font-black uppercase mb-1">
                        Total Cost
                      </p>
                      <p className="text-lg font-black">
                        {quote.finalJsonReport?.currency || "N/A"} {quote.parsedData?.totalCost?.toLocaleString() || "N/A"}
                      </p>
                    </div>

                    <div className="border-2 border-black p-2 bg-gray-50">
                      <p className="text-xs font-black uppercase mb-1">
                        Compliance Score
                      </p>
                      <p className="text-lg font-black">
                        {quote.parsedData?.complianceScore || 0}%
                      </p>
                    </div>

                    <div className="border-2 border-black p-2 bg-gray-50">
                      <p className="text-xs font-black uppercase mb-1">
                        Delivery
                      </p>
                      <p className="font-bold text-xs">
                        {report?.deliveryTime || "Not specified"}
                      </p>
                    </div>

                    <div className="border-2 border-black p-2 bg-gray-50">
                      <p className="text-xs font-black uppercase mb-1">
                        Certifications
                      </p>
                      <p className="font-bold text-xs">
                        {report?.certifications?.length
                          ? report.certifications.join(", ")
                          : "None listed"}
                      </p>
                    </div>
                  </div>

                  {report?.criticalIssues?.length > 0 && (
                    <div className="mb-3 border-2 border-red-600 bg-red-100 p-2">
                      <p className="font-black uppercase text-xs mb-1">
                        Critical Issues
                      </p>
                      <ul className="space-y-0">
                        {report?.criticalIssues?.map((issue: string, idx: number) => (
                          <li key={idx} className="text-xs font-bold">
                            • {issue}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {report?.validationNotes && (
                    <div className="border-2 border-black p-2 bg-gray-50 mb-3">
                      <p className="text-xs font-black uppercase mb-1">
                        Validator Notes
                      </p>
                      <p className="font-bold text-xs">
                        {report.validationNotes}
                      </p>
                    </div>
                  )}

                  {/* AI AUDIT & CONVERSION LOG */}
                  <div className="border-2 border-black bg-white p-2 md:p-3 overflow-x-auto">
                    <h4 className="text-sm font-black uppercase mb-2 pb-1 border-b-2 border-black">
                      🔬 AI AUDIT & CONVERSION LOG
                    </h4>

                    {/* Unit Conversions */}
                    {report?.unitConversions && report.unitConversions.length > 0 ? (
                      <div className="mb-6">
                        <p className="font-black text-sm uppercase mb-3 text-green-700">
                          ✓ SUCCESSFUL CONVERSIONS ({report.unitConversions.length})
                        </p>
                        <div className="space-y-2">
                          {report.unitConversions.map(
                            (conversion: string, idx: number) => (
                              <div
                                key={idx}
                                className="bg-green-100 border-2 border-green-600 p-3 font-mono text-xs md:text-sm"
                              >
                                <span className="font-black text-green-700">✔ PASS:</span>{" "}
                                {conversion}
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="mb-6 bg-gray-100 border-2 border-gray-400 p-3 font-mono text-xs md:text-sm">
                        <span className="text-gray-600">— No unit conversions required</span>
                      </div>
                    )}

                    {/* Measurement Precision Errors */}
                    {report?.measurementPrecisionErrors &&
                    report.measurementPrecisionErrors.length > 0 ? (
                      <div>
                        <p className="font-black text-sm uppercase mb-3 text-white bg-red-600 p-2 border-2 border-red-800">
                          ⚠ CRITICAL DEALBREAKER ({report.measurementPrecisionErrors.length})
                        </p>
                        <div className="space-y-2">
                          {report.measurementPrecisionErrors.map(
                            (error: string, idx: number) => (
                              <div
                                key={idx}
                                className="bg-red-600 border-4 border-red-800 p-3 font-mono text-xs md:text-sm text-white font-black"
                              >
                                ✗ FAIL: {error}
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="bg-green-50 border-2 border-green-400 p-3 font-mono text-xs md:text-sm">
                        <span className="text-green-700 font-bold">
                          — No measurement precision errors detected
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Adjudication Results (if session is closed) */}
        {session?.status === "closed" && session?.adjudicationResult && (
          <div className="space-y-3 mt-6 mb-6">
            <div className="bg-[#2D5A3D] border-8 border-black p-4 md:p-8 lg:p-12 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] text-white">
              <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tighter mb-6">
                FINAL ADJUDICATION & VENDOR RANKING
              </h2>

              {/* Best Vendor Highlight */}
              {session.adjudicationResult.bestVendor && (
                <div className="bg-green-400 border-4 border-black text-black p-6 mb-6">
                  <p className="text-sm font-black uppercase mb-2">🏆 BEST VENDOR</p>
                  <p className="text-2xl font-black uppercase mb-2">
                    {session.adjudicationResult.bestVendor.vendorName}
                  </p>
                  <p className="text-xl font-black mb-2">
                    Overall Score: {session.adjudicationResult.bestVendor.overallScore}/100
                  </p>
                  <p className="font-bold text-sm">
                    {session.adjudicationResult.bestVendor.rationale}
                  </p>
                </div>
              )}

              {/* Vendor Ranking Table */}
              {session.adjudicationResult.ranking && session.adjudicationResult.ranking.length > 0 && (
                <div className="mb-8 overflow-x-auto">
                  <div className="text-white space-y-3">
                    {session.adjudicationResult.ranking.map(
                      (vendor: any, idx: number) => (
                        <div
                          key={idx}
                          className={`border-4 border-white p-4 ${
                            vendor.recommendation === "HIGHLY_RECOMMENDED"
                              ? "bg-green-700"
                              : vendor.recommendation === "RECOMMENDED"
                              ? "bg-blue-700"
                              : vendor.recommendation === "CONDITIONAL"
                              ? "bg-yellow-600"
                              : "bg-red-700"
                          }`}
                        >
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <p className="text-lg font-black uppercase">
                                Rank #{vendor.rank} - {vendor.vendorName}
                              </p>
                              <p className="text-2xl font-black">
                                {vendor.overallScore}/100
                              </p>
                            </div>
                            <span className="bg-white text-black px-3 py-1 font-black uppercase text-sm border-2 border-black">
                              {vendor.recommendation}
                            </span>
                          </div>

                          <div className="grid grid-cols-4 gap-2 mb-3 text-sm">
                            <div className="bg-black bg-opacity-30 p-2">
                              <p className="text-xs font-bold opacity-80">COMPLIANCE</p>
                              <p className="text-lg font-black">
                                {vendor.scoringBreakdown.compliance}
                              </p>
                            </div>
                            <div className="bg-black bg-opacity-30 p-2">
                              <p className="text-xs font-bold opacity-80">COST</p>
                              <p className="text-lg font-black">
                                {vendor.scoringBreakdown.cost}
                              </p>
                            </div>
                            <div className="bg-black bg-opacity-30 p-2">
                              <p className="text-xs font-bold opacity-80">PRECISION</p>
                              <p className="text-lg font-black">
                                {vendor.scoringBreakdown.precision}
                              </p>
                            </div>
                            <div className="bg-black bg-opacity-30 p-2">
                              <p className="text-xs font-bold opacity-80">DELIVERY</p>
                              <p className="text-lg font-black">
                                {vendor.scoringBreakdown.delivery}
                              </p>
                            </div>
                          </div>

                          <p className="font-bold text-sm mb-2">{vendor.rationale}</p>

                          {vendor.criticalGaps && vendor.criticalGaps.length > 0 && (
                            <div className="bg-red-900 bg-opacity-50 p-2 mt-2">
                              <p className="text-xs font-bold uppercase mb-1">Critical Gaps:</p>
                              <ul className="text-xs space-y-1">
                                {vendor.criticalGaps.map((gap: string, gapIdx: number) => (
                                  <li key={gapIdx}>• {gap}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}

              {/* Comparative Analysis */}
              {session.adjudicationResult && (
                <div className="grid grid-cols-2 gap-6">
                  {/* Cost Analysis */}
                  {session.adjudicationResult.costAnalysis && (
                    <div className="bg-black bg-opacity-30 border-2 border-white p-4">
                      <p className="text-sm font-black uppercase mb-3">Cost Analysis</p>
                      <div className="space-y-2 text-sm font-bold">
                        <p>
                          Lowest: {session.adjudicationResult.costAnalysis.lowestCost?.vendor}{" "}
                          (${session.adjudicationResult.costAnalysis.lowestCost?.cost?.toLocaleString()})
                        </p>
                        <p>Average: ${session.adjudicationResult.costAnalysis.averageCost?.toLocaleString()}</p>
                        <p>
                          Highest: {session.adjudicationResult.costAnalysis.highestCost?.vendor}{" "}
                          (${session.adjudicationResult.costAnalysis.highestCost?.cost?.toLocaleString()})
                        </p>
                        <p className="text-yellow-300 font-black">
                          Spread: {session.adjudicationResult.costAnalysis.costDifferencePercent}%
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Compliance Analysis */}
                  {session.adjudicationResult.complianceAnalysis && (
                    <div className="bg-black bg-opacity-30 border-2 border-white p-4">
                      <p className="text-sm font-black uppercase mb-3">Compliance Tiers</p>
                      <div className="space-y-2 text-sm font-bold">
                        {session.adjudicationResult.complianceAnalysis.fullCompliance?.length > 0 && (
                          <p className="text-green-300">
                            Full: {session.adjudicationResult.complianceAnalysis.fullCompliance.join(", ")}
                          </p>
                        )}
                        {session.adjudicationResult.complianceAnalysis.partialCompliance?.length > 0 && (
                          <p className="text-yellow-300">
                            Partial: {session.adjudicationResult.complianceAnalysis.partialCompliance.join(", ")}
                          </p>
                        )}
                        {session.adjudicationResult.complianceAnalysis.nonCompliant?.length > 0 && (
                          <p className="text-red-300">
                            Non-compliant: {session.adjudicationResult.complianceAnalysis.nonCompliant.join(", ")}
                          </p>
                        )}
                        <p>Average Score: {session.adjudicationResult.complianceAnalysis.averageComplianceScore}%</p>
                      </div>
                    </div>
                  )}

                  {/* Precision Analysis */}
                  {session.adjudicationResult.precisionAnalysis && (
                    <div className="bg-black bg-opacity-30 border-2 border-white p-4">
                      <p className="text-sm font-black uppercase mb-3">Measurement Precision</p>
                      <div className="space-y-2 text-sm font-bold">
                        {session.adjudicationResult.precisionAnalysis.precisionPass?.length > 0 && (
                          <p className="text-green-300">
                            Pass: {session.adjudicationResult.precisionAnalysis.precisionPass.join(", ")}
                          </p>
                        )}
                        {session.adjudicationResult.precisionAnalysis.precisionFail?.length > 0 && (
                          <p className="text-red-300">
                            Fail: {session.adjudicationResult.precisionAnalysis.precisionFail.join(", ")}
                          </p>
                        )}
                        {session.adjudicationResult.precisionAnalysis.precisionUnknown?.length > 0 && (
                          <p className="text-yellow-300">
                            Unknown: {session.adjudicationResult.precisionAnalysis.precisionUnknown.join(", ")}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Delivery Analysis */}
                  {session.adjudicationResult.deliveryAnalysis && (
                    <div className="bg-black bg-opacity-30 border-2 border-white p-4">
                      <p className="text-sm font-black uppercase mb-3">Delivery Timeline</p>
                      <div className="space-y-2 text-sm font-bold">
                        <p>Best: {session.adjudicationResult.deliveryAnalysis.bestDelivery}</p>
                        <p>Worst: {session.adjudicationResult.deliveryAnalysis.worstDelivery}</p>
                        <p>
                          Average:{" "}
                          {typeof session.adjudicationResult.deliveryAnalysis.averageDeliveryDays === "number"
                            ? `${session.adjudicationResult.deliveryAnalysis.averageDeliveryDays} days`
                            : session.adjudicationResult.deliveryAnalysis.averageDeliveryDays}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Adjudication Notes */}
              {session.adjudicationResult.adjudicationNotes && (
                <div className="mt-6 bg-black bg-opacity-30 border-2 border-white p-4">
                  <p className="text-sm font-black uppercase mb-2">Executive Summary</p>
                  <p className="font-bold">{session.adjudicationResult.adjudicationNotes}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Disclaimer Box */}
        <div
          className="border-4 border-black bg-red-400 p-6 md:p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]"
          role="alert"
        >
          <p className="text-2xl font-black uppercase mb-4 tracking-tighter">
            ⚠ CRITICAL DISCLAIMER
          </p>

          <div className="space-y-3 text-black font-bold text-base leading-relaxed">
            <p>
              THIS ANALYSIS IS ALGORITHMICALLY GENERATED BY LARGE LANGUAGE MODELS
              (LLM) WITH MULTI-STAGE VALIDATION PIPELINE.
            </p>

            <p>
              WHILE RIGOROUS, THIS ASSESSMENT MAY CONTAIN ERRORS, OMISSIONS, OR
              MISINTERPRETATIONS.
            </p>

            <p>
              HUMAN VERIFICATION, LEGAL REVIEW, AND PROCUREMENT OFFICER
              AUTHORIZATION ARE MANDATORY BEFORE ANY CONTRACT EXECUTION.
            </p>

            <p className="bg-white border-4 border-black p-3">
              DO NOT RELY SOLELY ON THIS REPORT FOR PROCUREMENT DECISIONS.
            </p>

            <p>
              FINAL ADJUDICATION AUTHORITY: PROCUREMENT OFFICER OF RECORD
            </p>
          </div>
        </div>

        {/* Export/Print Footer */}
        <div className="flex flex-col items-center justify-center gap-6 mt-12 pb-12 w-full border-t-4 border-black pt-8">
          <button
            onClick={() => window.print()}
            className="bg-black text-white px-8 py-4 font-black uppercase border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hover:bg-white hover:text-black hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all text-xl"
          >
            PRINT REPORT
          </button>

          <p className="text-sm font-bold opacity-70">
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
                LIVE CLOCK: {currentTime || "Loading..."}
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
