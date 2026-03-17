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
    <div className="min-h-screen bg-[#FFFDD0] font-mono text-black overflow-hidden">
      <div className="w-full px-4 md:px-8 lg:px-12 max-w-[1600px] mx-auto py-12 md:py-16 space-y-20 md:space-y-32">
        {/* Header */}
        <div className="flex justify-between items-start">
          <div className="bg-white border-8 border-black p-6 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]">
            <h1 className="text-4xl font-black uppercase tracking-tighter">
              COMPLIANCE REPORT
            </h1>
            <p className="text-sm font-bold mt-2">
              SESSION: {session?.title}
            </p>
          </div>

          <button
            onClick={() => router.push(`/session/${sessionId}`)}
            className="bg-black text-white px-6 py-3 font-black uppercase border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all"
          >
            BACK TO WORKSPACE
          </button>
        </div>

        {/* Base Requirements Section */}
        <div className="bg-white border-4 border-black p-4 md:p-6 lg:p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] mb-20">
          <h2 className="text-xl font-black uppercase mb-4 tracking-tight">
            BASE REQUIREMENTS
          </h2>

          {baseReqs.length > 0 ? (
            <div className="border-4 border-black p-4 bg-gray-50 max-h-48 overflow-y-auto">
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
            <div className="border-4 border-black p-4 bg-yellow-200 font-bold text-sm">
              NO BASE REQUIREMENTS UPLOADED
            </div>
          )}
        </div>

        {/* Comparison Matrix */}
        {quotations.length > 0 ? (
          <div className="mt-20 mb-20 overflow-x-auto border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
            <table className="w-full border-collapse bg-white">
              <thead>
                <tr className="bg-black text-white">
                  <th className="border-4 border-black p-4 font-black uppercase text-left text-sm">
                    VENDOR
                  </th>
                  <th className="border-4 border-black p-4 font-black uppercase text-left text-sm">
                    TOTAL COST
                  </th>
                  <th className="border-4 border-black p-4 font-black uppercase text-center text-sm">
                    COMPLIANCE %
                  </th>
                  <th className="border-4 border-black p-4 font-black uppercase text-left text-sm">
                    MATCHED SPECS
                  </th>
                  <th className="border-4 border-black p-4 font-black uppercase text-left text-sm">
                    MISSING SPECS
                  </th>
                  <th className="border-4 border-black p-4 font-black uppercase text-left text-sm">
                    DELIVERY
                  </th>
                  <th className="border-4 border-black p-4 font-black uppercase text-center text-sm">
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
                    <tr key={quote.id} className="border-b-4 border-black">
                      <td className="border-4 border-black p-4 font-black uppercase">
                        {quote.vendorName}
                      </td>
                      <td className="border-4 border-black p-4 font-bold">
                        ${quote.parsedData?.totalCost?.toLocaleString() || "N/A"}
                      </td>
                      <td
                        className={`border-4 border-black p-4 font-black text-center text-lg ${
                          (quote.parsedData?.complianceScore || 0) >= 80
                            ? "bg-green-300"
                            : (quote.parsedData?.complianceScore || 0) >= 50
                            ? "bg-yellow-300"
                            : "bg-red-300"
                        }`}
                      >
                        {quote.parsedData?.complianceScore || 0}%
                      </td>
                      <td className="border-4 border-black p-4 font-bold text-sm">
                        <div className="bg-green-200 border-2 border-black p-2 max-h-20 overflow-y-auto">
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
                      <td className="border-4 border-black p-4 font-bold text-sm">
                        <div className="bg-red-200 border-2 border-black p-2 max-h-20 overflow-y-auto">
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
                      <td className="border-4 border-black p-4 font-bold text-sm">
                        {report?.deliveryTime || "N/A"}
                      </td>
                      <td
                        className={`border-4 border-black p-4 font-black uppercase text-center text-sm ${getRecommendationColor(
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
          <div className="bg-white border-4 border-black p-8 text-center mb-24">
            <p className="font-black uppercase text-lg">
              NO ANALYZED QUOTATIONS YET
            </p>
            <p className="text-sm font-bold mt-2">
              UPLOAD QUOTATIONS TO BEGIN ANALYSIS
            </p>
          </div>
        )}

        {/* Detailed Reports */}
        {quotations.length > 0 && (
          <div className="space-y-20 mt-20 mb-24">
            <h2 className="text-2xl font-black uppercase tracking-tight">
              DETAILED ANALYSIS
            </h2>

            {quotations.map((quote) => {
              const report = quote.finalJsonReport;

              return (
                <div
                  key={quote.id}
                  className="bg-white border-4 border-black p-4 md:p-6 lg:p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]"
                >
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="text-xl font-black uppercase">
                      {quote.vendorName}
                    </h3>
                    <span
                      className={`px-4 py-2 font-black uppercase text-sm ${getRecommendationColor(
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
                        className={`mb-6 border-4 ${
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
                    <div className="border-4 border-black p-4 bg-gray-50">
                      <p className="text-sm font-black uppercase mb-2">
                        Total Cost
                      </p>
                      <p className="text-2xl font-black">
                        ${quote.parsedData?.totalCost?.toLocaleString() || "N/A"}
                      </p>
                    </div>

                    <div className="border-4 border-black p-4 bg-gray-50">
                      <p className="text-sm font-black uppercase mb-2">
                        Compliance Score
                      </p>
                      <p className="text-2xl font-black">
                        {quote.parsedData?.complianceScore || 0}%
                      </p>
                    </div>

                    <div className="border-4 border-black p-4 bg-gray-50">
                      <p className="text-sm font-black uppercase mb-2">
                        Delivery
                      </p>
                      <p className="font-bold">
                        {report?.deliveryTime || "Not specified"}
                      </p>
                    </div>

                    <div className="border-4 border-black p-4 bg-gray-50">
                      <p className="text-sm font-black uppercase mb-2">
                        Certifications
                      </p>
                      <p className="font-bold">
                        {report?.certifications?.length
                          ? report.certifications.join(", ")
                          : "None listed"}
                      </p>
                    </div>
                  </div>

                  {report?.criticalIssues?.length > 0 && (
                    <div className="mb-6 border-4 border-red-600 bg-red-100 p-4">
                      <p className="font-black uppercase text-sm mb-2">
                        Critical Issues
                      </p>
                      <ul className="space-y-1">
                        {report?.criticalIssues?.map((issue: string, idx: number) => (
                          <li key={idx} className="text-sm font-bold">
                            • {issue}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {report?.validationNotes && (
                    <div className="border-4 border-black p-4 bg-gray-50">
                      <p className="text-sm font-black uppercase mb-2">
                        Validator Notes
                      </p>
                      <p className="font-bold text-sm">
                        {report.validationNotes}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Adjudication Results (if session is closed) */}
        {session?.status === "closed" && session?.adjudicationResult && (
          <div className="space-y-6 mt-12 mb-12">
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
          className="border-8 border-black bg-red-400 p-8 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] mt-32 mb-20 pt-12"
          role="alert"
        >
          <p className="text-2xl font-black uppercase mb-4 tracking-tighter">
            ⚠ CRITICAL DISCLAIMER
          </p>

          <div className="space-y-4 text-black font-bold text-lg leading-tight">
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

        {/* Spacer - 2 lines */}
        <div className="h-16"></div>

        {/* Export/Print Footer */}
        <div className="mt-24 mb-16 pt-20 border-t-4 border-black text-center">
          <button
            onClick={() => window.print()}
            className="bg-black text-white px-8 py-4 font-black uppercase border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all text-lg mb-16"
          >
            PRINT REPORT
          </button>

          {/* Spacer - 2 lines */}
          <div className="h-16"></div>

          <p className="text-xs font-bold opacity-70 pt-16">
            Report generated: {new Date().toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}
