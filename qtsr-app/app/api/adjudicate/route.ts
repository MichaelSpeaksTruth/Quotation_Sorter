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
 */

import { NextRequest, NextResponse } from "next/server";
import { rtdb } from "@/lib/firebase";
import { ref, get, update } from "firebase/database";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

interface AdjudicationRequest {
  userId: string;
  sessionId: string;
  baseRequirementsText: string;
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
 * Fetch all processed quotations from RTDB for this session
 */
async function fetchProcessedQuotations(
  userId: string,
  sessionId: string
): Promise<Map<string, any>> {
  const quotationsRef = ref(rtdb, `quotations/${userId}/${sessionId}`);
  const snapshot = await get(quotationsRef);

  if (!snapshot.exists()) {
    throw new Error(`No quotations found for session ${sessionId}`);
  }

  const data = snapshot.val();
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
 * STAGE: Final Adjudication with Gemini
 * Generate comprehensive comparative analysis and vendor ranking
 */
async function performAdjudication(
  quotationSummary: ProcessedQuotation[],
  baseRequirementsText: string,
  sessionId: string
): Promise<Record<string, any>> {
  try {
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable not set");
    }

    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `You are a PROCUREMENT ADJUDICATOR analyzing ${quotationSummary.length} vendor quotations for procurement decision.

BASE REQUIREMENTS:
${baseRequirementsText}

PROCESSED QUOTATIONS (${quotationSummary.length} vendors):
${JSON.stringify(quotationSummary, null, 2)}

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
- Any item listed in 'measurementPrecisionErrors' indicates a fundamental misunderstanding of the requirement by the vendor. This is a severe penalty. Reduce the precision score to 0.
- Missing critical requirements → automatic CONDITIONAL or NOT_RECOMMENDED
- Be EXTREMELY objective and data-driven
- No hallucinations or speculation

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

    return JSON.parse(responseText);
  } catch (error) {
    throw new Error(
      `Adjudication failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * POST Handler: Adjudicate session and close it
 */
export async function POST(request: NextRequest) {
  try {
    const payload: AdjudicationRequest = await request.json();
    const { userId, sessionId, baseRequirementsText } = payload;

    // Validation
    if (!userId || !sessionId || !baseRequirementsText) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required fields: userId, sessionId, baseRequirementsText",
        },
        { status: 400 }
      );
    }

    console.log(
      `[Adjudication] Starting for session ${sessionId} with ${userId}`
    );

    // STEP 1: Fetch all processed quotations from RTDB
    console.log(`[Adjudication] Fetching processed quotations...`);
    const processedQuotations = await fetchProcessedQuotations(
      userId,
      sessionId
    );
    console.log(
      `[Adjudication] Found ${processedQuotations.size} processed quotations`
    );

    // STEP 2: Build lightweight summary for Gemini
    const quotationSummary = buildQuotationSummary(processedQuotations);
    console.log(`[Adjudication] Built summary for ${quotationSummary.length} vendors`);

    // STEP 3: Perform adjudication with Gemini
    console.log(`[Adjudication] Performing final adjudication with Gemini...`);
    const adjudicationResult = await performAdjudication(
      quotationSummary,
      baseRequirementsText,
      sessionId
    );

    // STEP 4: Build complete result with metadata
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

    // STEP 5: Update session in RTDB to "closed" with adjudication results
    console.log(`[Adjudication] Saving results to RTDB...`);
    const sessionRef = ref(rtdb, `sessions/${userId}/${sessionId}`);
    await update(sessionRef, {
      status: "closed" as const,
      adjudicationResult: finalResult,
      adjudicatedAt: Date.now(),
    });

    return NextResponse.json(
      {
        success: true,
        data: finalResult,
        message: `Adjudication complete for ${quotationSummary.length} vendors`,
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
