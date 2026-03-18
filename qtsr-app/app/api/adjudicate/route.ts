/**
 * Adjudication Route - Final Comparative Analysis
 * 
 * ROLE: Map-Reduce Reduce Phase
 * - Fetches all processed quotation JSON data from RTDB
 * - Sends lightweight JSON array to Gemini (single pass, no individual processing)
 * - Generates final comparative analysis
 * - Determines best vendor(s) and scoring
 * - ONLY called when user clicks "Close Session"
 * - Handles 30+ quotations efficiently by using compressed JSON input
 * 
 * PRODUCTION HARDENING:
 * - REQUIREMENT 1: Session completion validation before adjudication
 * - REQUIREMENT 2: Token limit compression (quotation data)
 * - REQUIREMENT 3: Cost anomaly detection (Z-score statistical analysis)
 * - REQUIREMENT 4: Anomaly-aware Gemini prompt injection
 */

import { NextRequest, NextResponse } from "next/server";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const FIREBASE_DATABASE_URL =
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ||
  "https://quotation-sorter-app-default-rtdb.asia-southeast1.firebasedatabase.app";

interface AdjudicationRequest {
  userId: string;
  sessionId: string;
  baseRequirementsText: string;
  idToken: string;
}

interface SessionCompletionStatus {
  isComplete: boolean;
  analyzedCount: number;
  processingCount: number;
  errorCount: number;
  details: string;
}

interface CompressedQuotationSummary {
  vendorName: string;
  complianceScore: number;
  totalCost: number;
  deliveryTime: string;
  precisionValidation: "PASS" | "FAIL" | "UNKNOWN";
  matchedRequirements: string[];
  missingRequirements: string[];
  certificationCount: number;
  unitConversionCount: number;
  measurementErrorCount: number;
}

interface ProcessedQuotation {
  vendorName: string;
  complianceScore: number;
  totalCost: number;
  matchedRequirements: string[];
  missingRequirements: string[];
  certifications: string[];
  deliveryTime: string;
  precisionValidation: "PASS" | "FAIL" | "UNKNOWN";
  unitConversions: string[];
  measurementPrecisionErrors: string[];
  unitMismatches: string[];
}

interface AdjudicationResult {
  sessionId: string;
  totalVendors: number;
  baseRequirements: string;
  quotationSummary: ProcessedQuotation[];
  ranking: Array<{
    rank: number;
    vendorName: string;
    overallScore: number;
    scoringBreakdown: {
      compliance: number;
      cost: number;
      precision: number;
      delivery: number;
    };
    recommendation: "HIGHLY_RECOMMENDED" | "RECOMMENDED" | "CONDITIONAL" | "NOT_RECOMMENDED";
    rationale: string;
    criticalGaps: string[];
  }>;
  bestVendor: {
    vendorName: string;
    overallScore: number;
    recommendation: string;
    rationale: string;
  };
  costAnalysis: {
    lowestCost: { vendor: string; cost: number };
    averageCost: number;
    highestCost: { vendor: string; cost: number };
    costDifferencePercent: number;
  };
  complianceAnalysis: {
    fullCompliance: string[];
    partialCompliance: string[];
    nonCompliant: string[];
    averageComplianceScore: number;
  };
  precisionAnalysis: {
    precisionPass: string[];
    precisionFail: string[];
    precisionUnknown: string[];
  };
  deliveryAnalysis: {
    bestDelivery: string;
    worstDelivery: string;
    averageDeliveryDays: number | string;
  };
  adjudicationNotes: string;
  generatedAt: number;
}

/**
 * Firebase REST API Helper: Fetch data from RTDB with authenticated request
 */
async function fetchFromRTDB(path: string, idToken: string): Promise<any> {
  const url = `${FIREBASE_DATABASE_URL}/${path}.json?auth=${idToken}`;
  const response = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`RTDB GET failed: ${response.status} - ${JSON.stringify(errorData)}`);
  }

  return await response.json();
}

async function updateRTDB(
  path: string,
  updates: Record<string, any>,
  idToken: string
): Promise<void> {
  const url = `${FIREBASE_DATABASE_URL}/${path}.json?auth=${idToken}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`RTDB PATCH failed: ${response.status} - ${JSON.stringify(errorData)}`);
  }
}

/**
 * REQUIREMENT 1: Session Completion Validation
 * Queries RTDB and checks if all uploads are complete before adjudication
 * Returns 409 Conflict if session is not ready
 */
async function validateSessionCompletion(
  userId: string,
  sessionId: string,
  idToken: string
): Promise<SessionCompletionStatus> {
  try {
    const data = await fetchFromRTDB(`quotations/${userId}/${sessionId}`, idToken);

    if (!data) {
      return {
        isComplete: false,
        analyzedCount: 0,
        processingCount: 0,
        errorCount: 0,
        details: "No quotations found in session",
      };
    }

    let analyzedCount = 0;
    let processingCount = 0;
    let errorCount = 0;

    for (const quoteData of Object.values(data)) {
      const quote = quoteData as any;
      if (quote.status === "analyzed") analyzedCount++;
      else if (quote.status === "processing") processingCount++;
      else if (quote.status === "error") errorCount++;
    }

    // Session is complete if:
    // 1. No items are currently processing
    // 2. At least one item has been analyzed
    const isComplete = processingCount === 0 && analyzedCount > 0;

    return {
      isComplete,
      analyzedCount,
      processingCount,
      errorCount,
      details: `${analyzedCount} analyzed, ${processingCount} processing, ${errorCount} errors`,
    };
  } catch (error) {
    throw new Error(
      `Session validation failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * REQUIREMENT 2: Token Limit Compression
 * Builds compressed quotation summary to fit within Gemini 32k token limit
 * Slices arrays and converts counts to integers
 */
function buildCompressedQuotationSummary(
  quotations: Map<string, any>
): CompressedQuotationSummary[] {
  const summary: CompressedQuotationSummary[] = [];

  for (const quote of quotations.values()) {
    const report = quote.finalJsonReport;

    // Slice matched/missing requirements to max 5 items each
    const matchedRequirements = (report.matchedRequirements || []).slice(0, 5);
    const missingRequirements = (report.missingRequirements || []).slice(0, 5);

    summary.push({
      vendorName: report.vendorName || quote.vendorName,
      complianceScore: report.complianceScore || 0,
      totalCost: report.totalCost || 0,
      deliveryTime: report.deliveryTime || "Not specified",
      precisionValidation: quote.precisionValidation,
      matchedRequirements,
      missingRequirements,
      // Convert arrays to counts to save tokens
      certificationCount: (report.certifications || []).length,
      unitConversionCount: (quote.unitConversions || []).length,
      measurementErrorCount: (quote.measurementPrecisionErrors || []).length,
    });
  }

  return summary;
}

/**
 * REQUIREMENT 3: Algorithmic Cost Anomaly Detection
 * Uses statistical Z-score analysis to detect anomalous costs
 * Flags vendors with mathematically suspicious pricing (likely typos)
 */
function detectCostAnomalies(
  compressedSummary: CompressedQuotationSummary[]
): string[] {
  const anomalyFlags: string[] = [];

  // Extract valid costs (> 0)
  const validCosts = compressedSummary
    .filter((q) => q.totalCost > 0)
    .map((q) => q.totalCost);

  if (validCosts.length < 3) {
    console.log(
      "[Anomaly Detection] Insufficient data for Z-score analysis (< 3 vendors)"
    );
    return anomalyFlags;
  }

  // Calculate mean
  const mean = validCosts.reduce((a, b) => a + b, 0) / validCosts.length;

  // Calculate standard deviation
  const variance =
    validCosts.reduce((sum, cost) => sum + Math.pow(cost - mean, 2), 0) /
    validCosts.length;
  const stdDev = Math.sqrt(variance);

  // Handle case where all costs are identical (stdDev = 0)
  if (stdDev === 0) {
    console.log("[Anomaly Detection] All costs are identical (no deviation)");
    return anomalyFlags;
  }

  // Calculate Z-scores and detect anomalies
  for (const quotation of compressedSummary) {
    if (quotation.totalCost <= 0) continue;

    const zScore = Math.abs((quotation.totalCost - mean) / stdDev);

    // Flag if Z-score > 2.0 (approximately 95th percentile threshold)
    if (zScore > 2.0) {
      const direction =
        quotation.totalCost < mean ? "anomalously cheap" : "anomalously expensive";
      anomalyFlags.push(
        `⚠️ ANOMALY: Vendor "${quotation.vendorName}" cost is mathematically anomalous (Z-Score: ${zScore.toFixed(2)}, Cost: ₹${quotation.totalCost.toLocaleString()}). Highly likely a typo. (${direction})`
      );
    }
  }

  console.log(
    `[Anomaly Detection] Found ${anomalyFlags.length} cost anomalies out of ${compressedSummary.length} vendors`
  );
  return anomalyFlags;
}

/**
 * STAGE: Final Adjudication with Gemini
 * Generate comprehensive comparative analysis and vendor ranking
 * INCLUDES anomaly flags in prompt for informed decision-making
 */
async function fetchProcessedQuotations(
  userId: string,
  sessionId: string,
  idToken: string
): Promise<Map<string, any>> {
  const data = await fetchFromRTDB(`quotations/${userId}/${sessionId}`, idToken);

  if (!data) {
    throw new Error(`No quotations found for session ${sessionId}`);
  }

  const processed = new Map();

  for (const [quoteId, quoteData] of Object.entries(data)) {
    const quote = quoteData as any;

    // Only include analyzed (completed) quotations
    if (quote.status === "analyzed" && quote.finalJsonReport) {
      processed.set(quoteId, {
        quoteId,
        vendorName: quote.vendorName,
        status: quote.status,
        finalJsonReport: quote.finalJsonReport,
        precisionValidation: quote.precisionValidation,
        unitConversions: quote.unitConversions || [],
        measurementPrecisionErrors: quote.measurementPrecisionErrors || [],
        unitMismatches: quote.unitMismatches || [],
        uploadedAt: quote.uploadedAt,
      });
    }
  }

  if (processed.size === 0) {
    throw new Error(
      "No analyzed quotations found. Please wait for all uploads to complete."
    );
  }

  return processed;
}

/**
 * Build lightweight summary for Gemini (removes verbose fields)
 */
function buildQuotationSummary(quotations: Map<string, any>): ProcessedQuotation[] {
  const summary: ProcessedQuotation[] = [];

  for (const quote of quotations.values()) {
    const report = quote.finalJsonReport;
    summary.push({
      vendorName: report.vendorName || quote.vendorName,
      complianceScore: report.complianceScore || 0,
      totalCost: report.totalCost || 0,
      matchedRequirements: report.matchedRequirements || [],
      missingRequirements: report.missingRequirements || [],
      certifications: report.certifications || [],
      deliveryTime: report.deliveryTime || "Not specified",
      precisionValidation: quote.precisionValidation,
      unitConversions: quote.unitConversions,
      measurementPrecisionErrors: quote.measurementPrecisionErrors,
      unitMismatches: quote.unitMismatches,
    });
  }

  return summary;
}

/**
 * Helper: Sanitize JSON string to fix common formatting issues
 */
function sanitizeAdjudicationJSON(jsonStr: string): string {
  let sanitized = jsonStr;
  
  // Remove markdown code blocks
  sanitized = sanitized.replace(/```(?:json)?\s*/g, "");
  sanitized = sanitized.replace(/```\s*/g, "");
  sanitized = sanitized.replace(/`/g, "");
  
  // Remove trailing commas before closing braces/brackets
  sanitized = sanitized.replace(/,(\s*[}\]])/g, "$1");
  
  // Fix control characters
  sanitized = sanitized.replace(/[\r\n\t]/g, " ");
  
  // Fix invalid escape sequences
  sanitized = sanitized.replace(/\\([^"\\\/bfnrtu])/g, "$1");
  sanitized = sanitized.replace(/\\x([0-9a-f]{2})/gi, "\\u00$1");
  
  // Fix control characters inside strings
  sanitized = sanitized.replace(/"(?:[^"\\]|\\.)*"/g, (match) => {
    return match.replace(/[\x00-\x1f\x7f]/g, " ");
  });
  
  return sanitized;
}

/**
 * Helper: Parse JSON from Gemini response with multi-stage fallback
 * If parsing fails, returns error object instead of throwing
 */
function parseAdjudicationJSON(responseText: string): Record<string, any> {
  console.log(`[Adjudication JSON Parse] Response length: ${responseText.length}`);
  console.log(`[Adjudication JSON Parse] First 300 chars: ${responseText.substring(0, 300)}`);
  console.log(`[Adjudication JSON Parse] Contains '{': ${responseText.includes("{")} | Contains '}': ${responseText.includes("}")}`);

  // STAGE 8 (PRIORITY): Extract from first { to last }
  const firstBrace = responseText.indexOf("{");
  const lastBrace = responseText.lastIndexOf("}");
  
  if (firstBrace !== -1 && lastBrace !== -1 && firstBrace < lastBrace) {
    const extracted = responseText.substring(firstBrace, lastBrace + 1);
    console.log(`[Adjudication JSON] Stage 8 extraction: ${extracted.length} chars`);
    try {
      const sanitized = sanitizeAdjudicationJSON(extracted);
      return JSON.parse(sanitized);
    } catch (extractError) {
      console.error(`[Adjudication JSON] Stage 8 extraction parse failed:`, extractError instanceof Error ? extractError.message : "Unknown");
    }
  }

  // STAGE 1 (FALLBACK): Try direct parse with sanitization
  try {
    const sanitized = sanitizeAdjudicationJSON(responseText);
    return JSON.parse(sanitized);
  } catch (parseError) {
    console.error(`[Adjudication JSON] Stage 1 direct parse failed:`, parseError instanceof Error ? parseError.message : "Unknown");
  }

  // STAGE 9: Non-greedy regex extraction
  const match = responseText.match(/\{[\s\S]*?\}/);
  if (match) {
    console.log(`[Adjudication JSON] Stage 9 regex match: ${match[0].length} chars`);
    try {
      const sanitized = sanitizeAdjudicationJSON(match[0]);
      return JSON.parse(sanitized);
    } catch (regexError) {
      console.error(`[Adjudication JSON] Stage 9 regex parse failed:`, regexError instanceof Error ? regexError.message : "Unknown");
    }
  }

  // All stages failed - log full response and return error object
  console.error(`[Adjudication JSON] All parsing stages failed`);
  console.error(`[Adjudication JSON] Response contains {: ${responseText.includes("{")} | }`);
  console.error(`[Adjudication JSON] Last 500 chars:`, responseText.substring(Math.max(0, responseText.length - 500)));

  return {
    error: true,
    reason: "Gemini returned unparseable JSON - fallback error object",
    rawResponseLength: responseText.length,
    firstChars: responseText.substring(0, 200),
    ranking: [],
    bestVendor: {
      vendorName: "ERROR",
      overallScore: 0,
      recommendation: "ADJUDICATION_FAILED",
      rationale: "System could not parse Gemini response",
    },
    costAnalysis: {
      lowestCost: { vendor: "N/A", cost: 0 },
      averageCost: 0,
      highestCost: { vendor: "N/A", cost: 0 },
      costDifferencePercent: 0,
    },
    complianceAnalysis: {
      fullCompliance: [],
      partialCompliance: [],
      nonCompliant: [],
      averageComplianceScore: 0,
    },
    precisionAnalysis: {
      precisionPass: [],
      precisionFail: [],
      precisionUnknown: [],
    },
    deliveryAnalysis: {
      bestDelivery: "Unknown",
      worstDelivery: "Unknown",
      averageDeliveryDays: "Unknown",
    },
    adjudicationNotes: "Gemini response could not be parsed. Manual review recommended.",
  };
}

/**
 * STAGE: Final Adjudication with Gemini
 * Generate comprehensive comparative analysis and vendor ranking
 * REQUIREMENT 4: Inject cost anomalies and strict financial rules
 */
async function performAdjudication(
  quotationSummary: ProcessedQuotation[],
  baseRequirementsText: string,
  sessionId: string,
  anomalyFlags: string[]
): Promise<Record<string, any>> {
  try {
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable not set");
    }

    // Build compressed summary for token efficiency
    const compressedData: CompressedQuotationSummary[] = quotationSummary.map((q) => ({
      vendorName: q.vendorName,
      complianceScore: q.complianceScore,
      totalCost: q.totalCost,
      deliveryTime: q.deliveryTime,
      precisionValidation: q.precisionValidation,
      matchedRequirements: q.matchedRequirements.slice(0, 5),
      missingRequirements: q.missingRequirements.slice(0, 5),
      certificationCount: q.certifications.length,
      unitConversionCount: q.unitConversions.length,
      measurementErrorCount: q.measurementPrecisionErrors.length,
    }));

    // Build anomaly section for prompt
    let anomalySectionText = "";
    if (anomalyFlags.length > 0) {
      anomalySectionText = `

FLAGGED COST ANOMALIES (Statistical Analysis - Do NOT Ignore):
${anomalyFlags.join("\n")}

CRITICAL FINANCE RULE: Review the FLAGGED COST ANOMALIES above. If a vendor is flagged as anomalously cheap (e.g., missing zeroes, Z-Score > 2.0), you MUST NOT crown them the Best Vendor. You must treat their bid as a critical error/typo, tank their Cost Score to 0, and rank them as CONDITIONAL or NOT_RECOMMENDED. Do not give them the benefit of the doubt.`;
    }

    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `You are a PROCUREMENT ADJUDICATOR analyzing ${compressedData.length} vendor quotations for procurement decision.

BASE REQUIREMENTS:
${baseRequirementsText}

PROCESSED QUOTATIONS (${compressedData.length} vendors - COMPRESSED FOR TOKEN EFFICIENCY):
${JSON.stringify(compressedData, null, 2)}
${anomalySectionText}

YOUR CRITICAL TASKS:
1. Analyze all vendors across 4 dimensions:
   - COMPLIANCE: How well do they meet requirements? (0-100)
   - COST: Value for money analysis with budget optimization (0-100)
   - PRECISION: Measurement accuracy and unit compliance (0-100)
   - DELIVERY: Timeline feasibility and risk (0-100)

2. Calculate OVERALL SCORE = (Compliance×40% + Cost×30% + Precision×20% + Delivery×10%)

3. Generate RANKING with:
   - Percentage breakdown for each vendor
   - Recommendation level (HIGHLY_RECOMMENDED | RECOMMENDED | CONDITIONAL | NOT_RECOMMENDED)
   - Clear rationale for each ranking
   - Critical gaps or deal-breakers

4. Identify BEST VENDOR with comprehensive justification

5. Provide COMPARATIVE ANALYSIS:
   - Cost analysis (lowest, average, highest)
   - Compliance tiers
   - Precision validation summary
   - Delivery timeline comparison

STRICT RULES:
- Precision failures (precisionValidation=FAIL) are deal-breakers → NOT_RECOMMENDED
- Any item with measurementErrorCount > 0 indicates fundamental unit misunderstanding. This is severe. Reduce precision score to 0.
- Missing critical requirements → automatic CONDITIONAL or NOT_RECOMMENDED
- Be EXTREMELY objective and data-driven
- No hallucinations or speculation
- IF anomaly flags exist above, NEVER give a flagged vendor the best ranking

OUTPUT ONLY valid JSON:
{
  "ranking": [
    {
      "rank": 1,
      "vendorName": "string",
      "overallScore": 0-100,
      "scoringBreakdown": {
        "compliance": 0-100,
        "cost": 0-100,
        "precision": 0-100,
        "delivery": 0-100
      },
      "recommendation": "HIGHLY_RECOMMENDED|RECOMMENDED|CONDITIONAL|NOT_RECOMMENDED",
      "rationale": "detailed explanation",
      "criticalGaps": ["list of issues"]
    }
  ],
  "bestVendor": {
    "vendorName": "string",
    "overallScore": 0-100,
    "recommendation": "string",
    "rationale": "comprehensive justification why this vendor is best"
  },
  "costAnalysis": {
    "lowestCost": {"vendor": "name", "cost": number},
    "averageCost": number,
    "highestCost": {"vendor": "name", "cost": number},
    "costDifferencePercent": number
  },
  "complianceAnalysis": {
    "fullCompliance": ["vendors"],
    "partialCompliance": ["vendors"],
    "nonCompliant": ["vendors"],
    "averageComplianceScore": number
  },
  "precisionAnalysis": {
    "precisionPass": ["vendors with PASS"],
    "precisionFail": ["vendors with FAIL"],
    "precisionUnknown": ["vendors with UNKNOWN"]
  },
  "deliveryAnalysis": {
    "bestDelivery": "fastest timeline or vendor",
    "worstDelivery": "slowest timeline or vendor",
    "averageDeliveryDays": "parsed average or 'Unknown'"
  },
  "adjudicationNotes": "executive summary of procurement decision"
}

CRITICAL: Output ONLY valid JSON. No markdown or code blocks.`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        topK: 1,
        topP: 0.95,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
      },
    };

    const response = await fetch(
      `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
        `Gemini API Error: ${response.status} - ${JSON.stringify(errorData)}`
      );
    }

    const responseData = await response.json();
    const responseText =
      responseData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    if (!responseText) {
      throw new Error("Gemini returned empty response for adjudication");
    }

    // Use multi-stage JSON parsing with fallback
    const parsed = parseAdjudicationJSON(responseText);
    
    // If parsing returned an error object, still return it (frontend will handle the error flag)
    return parsed;
  } catch (error) {
    // Return error object instead of throwing - prevents broken JSON from reaching frontend
    console.error(`[Adjudication Error]`, error instanceof Error ? error.message : "Unknown error");
    return {
      error: true,
      reason: `Adjudication failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      ranking: [],
      bestVendor: {
        vendorName: "ERROR",
        overallScore: 0,
        recommendation: "ADJUDICATION_FAILED",
        rationale: "System encountered an error during adjudication",
      },
      costAnalysis: {
        lowestCost: { vendor: "N/A", cost: 0 },
        averageCost: 0,
        highestCost: { vendor: "N/A", cost: 0 },
        costDifferencePercent: 0,
      },
      complianceAnalysis: {
        fullCompliance: [],
        partialCompliance: [],
        nonCompliant: [],
        averageComplianceScore: 0,
      },
      precisionAnalysis: {
        precisionPass: [],
        precisionFail: [],
        precisionUnknown: [],
      },
      deliveryAnalysis: {
        bestDelivery: "Unknown",
        worstDelivery: "Unknown",
        averageDeliveryDays: "Unknown",
      },
      adjudicationNotes: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * POST Handler: Adjudicate session and close it
 * REQUIREMENT 1: Validates session completion before proceeding
 * REQUIREMENT 2: Uses compressed quotation summary for token efficiency
 * REQUIREMENT 3: Performs cost anomaly detection
 * REQUIREMENT 4: Injects anomalies into Gemini prompt
 */
export async function POST(request: NextRequest) {
  try {
    const payload: AdjudicationRequest = await request.json();
    const { userId, sessionId, baseRequirementsText, idToken } = payload;

    // Validation
    if (!userId || !sessionId || baseRequirementsText === undefined || !idToken) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required fields: userId, sessionId, baseRequirementsText, idToken",
        },
        { status: 400 }
      );
    }

    console.log(
      `[Adjudication] Starting for session ${sessionId} with ${userId}`
    );

    // ======= REQUIREMENT 1: SESSION COMPLETION VALIDATION =======
    console.log(`[Adjudication] REQUIREMENT 1: Validating session completion...`);
    const completionStatus = await validateSessionCompletion(userId, sessionId, idToken);

    if (!completionStatus.isComplete) {
      console.warn(
        `[Adjudication] Session not complete: ${completionStatus.details}`
      );
      return NextResponse.json(
        {
          success: false,
          error: "Session is not ready for adjudication",
          details: completionStatus.details,
          status: completionStatus,
        },
        { status: 409 } // Conflict status
      );
    }

    console.log(`[Adjudication] ✓ Session complete: ${completionStatus.details}`);

    // STEP 2: Fetch all processed quotations from RTDB
    console.log(`[Adjudication] Fetching processed quotations...`);
    const processedQuotations = await fetchProcessedQuotations(
      userId,
      sessionId,
      idToken
    );
    console.log(
      `[Adjudication] Found ${processedQuotations.size} processed quotations`
    );

    // REQUIREMENT 2: Build COMPRESSED summary for Gemini (token efficiency)
    console.log(
      `[Adjudication] REQUIREMENT 2: Building compressed quotation summary...`
    );
    const compressedSummary = buildCompressedQuotationSummary(processedQuotations);
    console.log(`[Adjudication] ✓ Compressed summary built for ${compressedSummary.length} vendors`);

    // REQUIREMENT 3: Detect cost anomalies (Z-score analysis)
    console.log(`[Adjudication] REQUIREMENT 3: Performing cost anomaly detection...`);
    const anomalyFlags = detectCostAnomalies(compressedSummary);
    if (anomalyFlags.length > 0) {
      console.warn(`[Adjudication] ⚠️ Found ${anomalyFlags.length} cost anomalies`);
      anomalyFlags.forEach((flag) => console.warn(`  ${flag}`));
    } else {
      console.log(`[Adjudication] ✓ No cost anomalies detected`);
    }

    // Build full summary for result storage
    const quotationSummary = buildQuotationSummary(processedQuotations);

    // REQUIREMENT 4: Perform adjudication with Gemini (pass anomalies)
    console.log(`[Adjudication] REQUIREMENT 4: Performing final adjudication with Gemini...`);
    const adjudicationResult = await performAdjudication(
      quotationSummary,
      baseRequirementsText,
      sessionId,
      anomalyFlags
    );

    // STEP 5: Build complete result with metadata
    const finalResult: AdjudicationResult = {
      sessionId,
      totalVendors: quotationSummary.length,
      baseRequirements: baseRequirementsText,
      quotationSummary,
      ranking: adjudicationResult.ranking || [],
      bestVendor: adjudicationResult.bestVendor,
      costAnalysis: adjudicationResult.costAnalysis,
      complianceAnalysis: adjudicationResult.complianceAnalysis,
      precisionAnalysis: adjudicationResult.precisionAnalysis,
      deliveryAnalysis: adjudicationResult.deliveryAnalysis,
      adjudicationNotes: adjudicationResult.adjudicationNotes,
      generatedAt: Date.now(),
    };

    // STEP 6: Update session in RTDB to "closed" with adjudication results
    console.log(`[Adjudication] Saving results to RTDB...`);
    await updateRTDB(`sessions/${userId}/${sessionId}`, {
      status: "closed" as const,
      adjudicationResult: finalResult,
      adjudicatedAt: Date.now(),
    }, idToken);

    console.log(`[Adjudication] ✓ Production Hardening Protocol Complete`);

    return NextResponse.json(
      {
        success: true,
        data: finalResult,
        message: `Adjudication complete for ${quotationSummary.length} vendors`,
        anomaliesDetected: anomalyFlags.length,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[Adjudication Error]", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Adjudication failed",
      },
      { status: 500 }
    );
  }
}
