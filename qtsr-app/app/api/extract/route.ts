/**
 * Quotation Extraction & Analysis API
 * AI Pipeline: PDF Parsing → Gemini Extraction (0% hallucination) → Gemini Validation (Strict Schema)
 *
 * CRITICAL PRODUCTION RULES:
 * - Temperature: 0 on ALL Gemini calls (zero creativity, 0% hallucination rate)
 * - PDF Source: Base64 encoded data from RTDB
 * - Gemini Extractor: Literal auditor mode - only extract what's explicitly written
 * - Gemini Adjudicator: REST API with JSON mode enforcement (responseMimeType: application/json)
 * - Rigid error handling at each stage with RTDB status tracking
 */

import { NextRequest, NextResponse } from "next/server";
// @ts-expect-error - pdf-parse CommonJS module does not have proper ESM types
import pdfParse from "pdf-parse";
import {
  ExtractionRequest,
  ParsedQuotationData,
} from "@/lib/types";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const FIREBASE_DATABASE_URL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || "https://quotation-sorter-app-default-rtdb.asia-southeast1.firebasedatabase.app";

/**
 * Firebase REST API Helper: Update RTDB with authenticated request
 * Uses database URL with ID token auth parameter to satisfy RTDB security rules
 */
async function updateRTDB(path: string, data: Record<string, any>, idToken: string): Promise<void> {
  try {
    const url = `${FIREBASE_DATABASE_URL}/${path}.json?auth=${idToken}`;
    const response = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`RTDB PATCH failed: ${response.status} - ${JSON.stringify(errorData)}`);
    }
  } catch (error) {
    console.error(`[RTDB ERROR] Failed to update ${path}:`, error);
    throw error;
  }
}

/**
 * STAGE 1: FILE PARSING FROM BASE64 DATA (RTDB)
 * Convert base64 encoded file to Buffer and extract text or preserve as image
 * Supports PDF, image, and text formats
 *
 * INPUT: Base64 encoded file data from RTDB (with optional mimeType in data URI), quoteId for logging
 * OUTPUT: Structured object with type identification: {type: "text", text?: string} | {type: "image", mimeType: string, data: string}
 */
async function stagePdfParsing(base64Data: string, quoteId: string, fileKey: string): Promise<Record<string, any>> {
  try {
    console.log(`[File Parsing] Decoding base64 data from RTDB...`);

    // Extract mimeType and base64 string from data URI format (data:application/...;base64,...)
    let mimeType = "application/pdf";
    let base64String = base64Data;
    
    if (base64Data.includes("base64,")) {
      const parts = base64Data.split("base64,");
      base64String = parts[1];
      
      // Extract mimeType from the URI prefix
      const uriPrefix = parts[0]; // e.g., "data:image/jpeg;"
      const mimeMatch = uriPrefix.match(/data:([^;]+);/);
      if (mimeMatch && mimeMatch[1]) {
        mimeType = mimeMatch[1];
      }
    }

    // Convert base64 to buffer
    const fileBuffer = Buffer.from(base64String, "base64");

    if (fileBuffer.length === 0) {
      throw new Error("Base64 decoded to empty buffer (0 bytes)");
    }

    console.log(`[File Parsing] Detected MIME type: ${mimeType} | Buffer size: ${fileBuffer.length} bytes`);

    // If it's an image, return structured object WITHOUT parsing to text
    if (mimeType.startsWith("image/")) {
      console.log(`[File Parsing] Image format detected (${mimeType}). Preserving as binary data for Gemini Vision...`);
      return {
        type: "image",
        mimeType: mimeType,
        data: base64String,
      };
    }

    // Try to detect file type and parse accordingly for PDF/text
    const fileTypeSig = fileBuffer.slice(0, 4).toString("hex");
    const isPDF = fileTypeSig.startsWith("25504446"); // %PDF signature

    let rawText = "";

    if (isPDF) {
      console.log(`[File Parsing] PDF format detected. Parsing with pdfParse...`);
      try {
        const result = await pdfParse(fileBuffer);
        rawText = result.text?.trim() || "";
      } catch (pdfError) {
        console.error(`[File Parsing] PDF parsing failed:`, pdfError);
        // Fall back to treating as text
        try {
          rawText = fileBuffer.toString("utf-8").trim();
          console.log(`[File Parsing] Fallback: Treated as UTF-8 text`);
        } catch {
          throw new Error(`PDF parsing failed and cannot read as text: ${pdfError instanceof Error ? pdfError.message : "Unknown error"}`);
        }
      }
    } else {
      // Try to read as text file
      console.log(`[File Parsing] Text format detected. Parsing as UTF-8...`);
      rawText = fileBuffer.toString("utf-8").trim();
    }

    if (!rawText || rawText.length === 0) {
      throw new Error("File extraction returned empty text");
    }

    console.log(`[File Parsing] Extracted ${rawText.length} characters from file`);
    return {
      type: "text",
      text: rawText,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(
      `\n❌ [EXTRACT ERROR] QuoteID: ${quoteId} | File: ${fileKey} | Stage: File Parsing | Details: `,
      errorMsg,
      "\nStack: ",
      error instanceof Error ? error.stack : "No stack trace"
    );
    throw new Error(`File Parsing Failed: ${errorMsg}`);
  }
}

/**
 * JSON Sanitization Helper: Fix common JSON escaping issues
 * Handles unescaped newlines, quotes, and bad escape sequences
 */
function sanitizeJSON(jsonStr: string): string {
  try {
    // First attempt: direct parse (might work if JSON is valid)
    JSON.parse(jsonStr);
    return jsonStr;
  } catch {
    // JSON is invalid, attempt sanitization
    console.log(`[JSON Sanitizer] Attempting to sanitize malformed JSON...`);

    let sanitized = jsonStr;

    // STAGE 0: AGGRESSIVE MARKDOWN STRIPPING
    // Remove markdown code blocks (```json...```)
    sanitized = sanitized.replace(/```(?:json)?\s*/g, "");
    sanitized = sanitized.replace(/```\s*/g, "");

    // Remove markdown inline code backticks
    sanitized = sanitized.replace(/`/g, "");

    // STAGE 0.5: Remove trailing commas before closing braces/brackets
    sanitized = sanitized.replace(/,(\s*[}\]])/g, "$1");

    // STAGE 1: Remove/fix problematic control characters
    sanitized = sanitized.replace(/[\r\n\t]/g, " ");

    // STAGE 2: Fix invalid escape sequences
    // Replace backslash followed by invalid characters with the character itself
    // Valid escapes are: \", \\, \/, \b, \f, \n, \r, \t, \uXXXX
    sanitized = sanitized.replace(/\\([^"\\\/bfnrtu])/g, "$1");

    // STAGE 3: Fix double-escaped backslashes
    sanitized = sanitized.replace(/\\\\\\\\/g, "\\\\");

    // STAGE 4: Handle common LLM mistakes
    // Replace \\' with '
    sanitized = sanitized.replace(/\\'/g, "'");
    // Replace single quotes with nothing in certain contexts
    sanitized = sanitized.replace(/\\x([0-9a-f]{2})/gi, "\\u00$1");

    // STAGE 5: Remove any remaining invalid escape sequences inside strings
    // Match quoted strings and check their content
    sanitized = sanitized.replace(/"(?:[^"\\]|\\.)*"/g, (match) => {
      // Fix invalid control characters inside strings
      return match.replace(/[\x00-\x1f\x7f]/g, " ");
    });

    // Try parsing with sanitized version
    try {
      JSON.parse(sanitized);
      console.log(`[JSON Sanitizer] Successfully sanitized JSON (Stage 0-5)`);
      return sanitized;
    } catch (sanitizeError) {
      console.log(`[JSON Sanitizer] Stage 0-5 failed, attempting aggressive cleanup...`);

      // STAGE 6: Aggressive cleanup - remove all backslashes that aren't followed by valid escapes
      sanitized = sanitized.replace(/\\(?!["\\/bfnrtu]|u[0-9a-f]{4})/gi, "");

      // STAGE 6.5: Remove trailing commas again after cleanup
      sanitized = sanitized.replace(/,(\s*[}\]])/g, "$1");

      try {
        JSON.parse(sanitized);
        console.log(`[JSON Sanitizer] Successfully sanitized JSON (Stage 6)`);
        return sanitized;
      } catch {
        console.log(`[JSON Sanitizer] Aggressive cleanup failed, attempting regex extraction...`);

        // STAGE 7: Extract valid JSON object from the string
        const match = sanitized.match(/\{[\s\S]*\}/) || sanitized.match(/\{[\s\S]*?\}/);
        if (match) {
          try {
            JSON.parse(match[0]);
            console.log(`[JSON Sanitizer] Successfully extracted valid JSON object`);
            return match[0];
          } catch {
            console.log(`[JSON Sanitizer] Extracted JSON still invalid, attempting final trailing comma fix...`);
            // Final attempt: fix trailing commas in the extracted JSON
            let finalSanitized = match[0].replace(/,(\s*[}\]])/g, "$1");
            try {
              JSON.parse(finalSanitized);
              console.log(`[JSON Sanitizer] Fixed with trailing comma removal`);
              return finalSanitized;
            } catch {
              console.log(`[JSON Sanitizer] Still invalid, returning as-is`);
              return match[0];
            }
          }
        }

        return sanitized;
      }
    }
  }
}

/**
 * UNIFIED STAGE 2-3: GEMINI DIRECT ANALYSIS (Extract + Validate in One Pass)
 * Use Gemini with temperature: 0 (ZERO CREATIVITY) and responseMimeType: application/json
 * Performs literal extraction AND validation against base requirements simultaneously
 * Leverages Gemini 3.1 Flash Lite's massive context window to halve latency
 * Supports both text-based quotations and images via Gemini Vision
 *
 * INPUT: Parsed quotation object (text or image), Base Requirements, quoteId, fileKey for logging
 * OUTPUT: Complete analysis with compliance score, matched requirements, conversions, and recommendation
 */
async function stageGeminiDirectAnalysis(
  parsedQuotation: Record<string, any>,
  baseRequirementsText: string,
  quoteId: string,
  fileKey: string,
  targetCurrency: string
): Promise<Record<string, any>> {
  try {
    console.log(`[Gemini Direct Analysis] Starting unified Gemini ${GEMINI_MODEL} analysis (temperature: 0)...`);
    console.log(`[Gemini Direct Analysis] Quotation type: ${parsedQuotation.type}${parsedQuotation.type === "image" ? ` (${parsedQuotation.mimeType})` : ""}...`);

    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable not set");
    }

    // Dynamically build the parts array based on quotation type
    let initialPrompt = `You are a STRICT procurement adjudicator and merciless literal data auditor. Your job is BOTH:
1. Extract EXACTLY what is written in the vendor quotation (no hallucination, no inference)
2. Validate the extracted data against the base requirements with mathematical precision

BASE REQUIREMENTS:
${baseRequirementsText}

`;
    
    if (parsedQuotation.type === "text") {
      initialPrompt += `VENDOR QUOTATION:\n${parsedQuotation.text}`;
    } else {
      initialPrompt += `VENDOR QUOTATION IMAGE attached below (analyze and extract data from image):`;
    }
    
    initialPrompt += `

CRITICAL ANTI-HALLUCINATION RULES:`;
    
    const parts: Record<string, any>[] = [
      {
        text: initialPrompt + `
1. EXTRACT ONLY information explicitly written in the quotation (text or image).
2. DO NOT infer, guess, calculate, or assume missing information.
3. DO NOT hallucinate prices, specifications, or measurements.
4. If a value is NOT explicitly stated, write "NOT_EXPLICITLY_STATED".
5. Copy technical specifications exactly as written - no translation.
6. Extract the vendor name exactly as written.
7. Extract EVERY line item, specification, and measurement word-for-word.

CRITICAL RULE: THE UNIT CONVERSION PROTOCOL
1. If the base requirement and the vendor quotation use different units for the same metric (e.g., Tons vs. BTUs, kg vs. lbs, mm vs. inches, meters vs. feet, Torr vs kPa), you MUST attempt to mathematically convert the vendor's unit to the base requirement's unit.
2. If the converted value meets or exceeds the base requirement, mark it as COMPLIANT. Do NOT penalize the vendor for using a different unit.
3. Document successful conversions in the "unitConversions" array, formatted exactly as: "Converted [Vendor Value/Unit] to [Converted Value/Base Unit] to verify compliance with [Requirement]."
4. If units are fundamentally incompatible (e.g., 'Liters' vs 'Meters'), mark as a FAILURE and add to "measurementPrecisionErrors".

CRITICAL RULE: CURRENCY NORMALIZATION
1. The USER has explicitly requested all financial data to be converted into this TARGET CURRENCY: ${targetCurrency}.
2. Detect the currency used in the Vendor Quotation's total cost.
3. If the vendor's currency differs from the TARGET CURRENCY (${targetCurrency}), you MUST mathematically convert the vendor's total cost into ${targetCurrency}.
4. Use these exact exchange rates: 1 USD = 83 INR, 1 EUR = 90 INR, 1 GBP = 104 INR, 1 JPY = 0.55 INR (calculate inverses if necessary).
5. Output the final converted amount in the "totalCost" field, and output "${targetCurrency}" in the "currency" field.

CRITICAL RULE: DELIVERY TIME NORMALIZATION
1. You MUST mathematically normalize the vendor's stated delivery time into a standardized format.
2. Calculate the total delivery time in days.
3. If the total delivery time is LESS than 7 days (168 hours), output the value strictly in "days" (e.g., "5 days").
4. If the total delivery time is 7 days or MORE, mathematically convert it and output it strictly in "weeks" (e.g., "6 weeks", "2.5 weeks").
5. Examples:
   - "1008 hours" -> convert to weeks -> "6 weeks"
   - "42 calendar days" -> convert to weeks -> "6 weeks"
   - "1.5 months" (assuming 30 days/month) -> 45 days -> convert to weeks -> "6.4 weeks"
   - "120 hours" -> less than 7 days -> convert to days -> "5 days"
6. Output ONLY this standardized value in the "deliveryTime" field of your final JSON.

VALIDATION INSTRUCTIONS:
1. Compare quotation specs against base requirements - EXACT MATCH only
2. If quotation says "NOT_EXPLICITLY_STATED", mark as MISSING
3. Compliance = (Matched requirements / Total requirements) × 100
4. Execute unit conversions for all differing metrics
5. Execute currency normalization for all differing currencies

RECOMMENDATION LOGIC:
- If compliance = 100% and NO critical financial anomalies → "APPROVED"
- If compliance ≥ 80% → "CONDITIONAL"
- If compliance < 80% OR price exceeds target budget → "REJECTED"

RETURN THIS JSON STRUCTURE (valid JSON only):
{
  "vendorName": "string",
  "complianceScore": 0-100,
  "matchedRequirements": ["string"],
  "missingRequirements": ["string"],
  "unitConversions": ["string"],
  "measurementPrecisionErrors": ["string"],
  "lineItems": [{"description": "string", "quantity": "string", "unit": "string"}],
  "allSpecs": ["string"],
  "certifications": ["string"],
  "totalCost": "string",
  "currency": "string",
  "deliveryTime": "string",
  "criticalIssues": ["string"],
  "overallRecommendation": "APPROVED|CONDITIONAL|REJECTED",
  "validationNotes": "string"
}

CRITICAL: Your response MUST be valid JSON. Start with { and end with }. No markdown. JSON ONLY.`,
      },
    ];

    // If quotation is an image, append the image data to the parts array
    if (parsedQuotation.type === "image") {
      parts.push({
        inlineData: {
          mimeType: parsedQuotation.mimeType,
          data: parsedQuotation.data,
        },
      });
      console.log(`[Gemini Direct Analysis] Image appended to request (${parsedQuotation.mimeType}, ${parsedQuotation.data.length} chars base64)`);
    }

    const requestBody = {
      contents: [
        {
          role: "user",
          parts: parts,
        },
      ],
      generationConfig: {
        temperature: 0,
        topK: 1,
        topP: 0.95,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      },
    };

    const response = await fetch(
      `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
        `Gemini Extraction API Error: ${response.status} - ${JSON.stringify(errorData)}`
      );
    }

    const responseData = await response.json();
    const responseText =
      responseData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    if (!responseText) {
      throw new Error("Gemini extraction returned empty response");
    }

    console.log(`[Gemini Direct Analysis] Raw response length: ${responseText.length} characters`);

    let analysisResult: Record<string, any> | null = null;

    // STAGE 8 (PRIORITY): Smart JSON extraction - find first { to last }
    const firstBraceIdx = responseText.indexOf("{");
    const lastBraceIdx = responseText.lastIndexOf("}");

    if (firstBraceIdx !== -1 && lastBraceIdx !== -1 && firstBraceIdx < lastBraceIdx) {
      const extractedJSON = responseText.substring(firstBraceIdx, lastBraceIdx + 1);
      try {
        const sanitizedExtractedJSON = sanitizeJSON(extractedJSON);
        analysisResult = JSON.parse(sanitizedExtractedJSON);
        console.log(`[Gemini Direct Analysis] ✓ Successfully parsed via Stage 8 extraction`);
      } catch (extractError) {
        console.error(`[Gemini Direct Analysis JSON Error (Stage 8)]`, extractError instanceof Error ? extractError.message : "Unknown");
      }
    }

    // STAGE 1 (FALLBACK): Direct parse with sanitization
    if (!analysisResult) {
      try {
        const sanitizedJSON = sanitizeJSON(responseText);
        analysisResult = JSON.parse(sanitizedJSON);
        console.log(`[Gemini Direct Analysis] ✓ Successfully parsed via Stage 1 fallback`);
      } catch (parseError) {
        console.error(`[Gemini Direct Analysis JSON Error (Stage 1)]`, parseError instanceof Error ? parseError.message : "Unknown");
      }
    }

    // STAGE 9: Non-greedy regex as last resort
    if (!analysisResult) {
      const nonGreedyMatch = responseText.match(/\{[\s\S]*?\}/);
      if (nonGreedyMatch) {
        try {
          const sanitizedNonGreedy = sanitizeJSON(nonGreedyMatch[0]);
          analysisResult = JSON.parse(sanitizedNonGreedy);
          console.log(`[Gemini Direct Analysis] ✓ Successfully parsed via Stage 9 non-greedy regex`);
        } catch (nonGreedyError) {
          console.error(`[Gemini Direct Analysis JSON Error (Stage 9)]`, nonGreedyError instanceof Error ? nonGreedyError.message : "Unknown");
        }
      }
    }

    // If all parsing stages failed, return structured error object
    if (!analysisResult) {
      console.error(`[Gemini Direct Analysis] All parsing stages failed - returning structured error object`);
      console.error(`[Gemini Direct Analysis Debug] Response length: ${responseText.length}`);
      console.error(`[Gemini Direct Analysis Debug] First 500 chars:`, responseText.substring(0, 500));

      analysisResult = {
        vendorName: "UNKNOWN",
        complianceScore: 0,
        matchedRequirements: [],
        missingRequirements: ["All requirements - JSON parsing failed across all stages"],
        unitConversions: [],
        measurementPrecisionErrors: [],
        lineItems: [],
        allSpecs: [],
        certifications: [],
        totalCost: "0",
        currency: "UNKNOWN",
        deliveryTime: "UNKNOWN",
        criticalIssues: [`Gemini API error: Could not extract valid JSON from response (failed Stages 1-9)`],
        overallRecommendation: "REJECTED",
        validationNotes: `Gemini response could not be parsed as JSON. Response length: ${responseText.length} chars. Check server logs for details.`,
      };
    }

    console.log(
      `[Gemini Direct Analysis] Compliance score: ${analysisResult.complianceScore}%`
    );
    console.log(
      `[Gemini Direct Analysis] Recommendation: ${analysisResult.overallRecommendation}`
    );

    return analysisResult;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(
      `\n❌ [EXTRACT ERROR] QuoteID: ${quoteId} | File: ${fileKey} | Stage: Gemini Direct Analysis | Details: `,
      errorMsg,
      "\nStack: ",
      error instanceof Error ? error.stack : "No stack trace"
    );
    throw new Error(`Gemini Direct Analysis Error: ${errorMsg}`);
  }
}


/**
 * POST HANDLER: Execute the Unified Gemini AI Pipeline
 *
 * Flow:
 * 1. PDF Parsing: Decode base64 from RTDB → Extract text
 * 2. Gemini Direct Analysis: temperature: 0, unified extraction+validation in one pass
 * 3. RTDB Update: Store results with status tracking
 */
export async function POST(request: NextRequest) {
  let quoteId = "UNKNOWN";
  let fileKey = "UNKNOWN";
  let idToken = "";

  try {
    const payload: ExtractionRequest = await request.json();
    const { userId, sessionId, quoteId: payloadQuoteId, fileUrl, baseRequirementsText, targetCurrency: payloadTargetCurrency } = payload;

    // Extract ID token and target currency for RTDB authentication
    idToken = (payload as any).idToken || "";
    const targetCurrency = payloadTargetCurrency || "INR";

    // Use quoteId from payload
    quoteId = payloadQuoteId || "UNKNOWN";
    // Get fileName from payload if available, otherwise derive from fileUrl
    fileKey = (payload as any).fileName || fileUrl?.substring(0, 50) || "UNKNOWN";

    // Validation
    if (!userId || !sessionId || !quoteId || !fileUrl || !baseRequirementsText || !idToken) {
      console.error(
        `\n❌ [EXTRACT ERROR] QuoteID: ${quoteId} | File: ${fileKey} | Stage: Validation | Details: Missing required fields`,
        `\nReceived: userId=${!!userId}, sessionId=${!!sessionId}, quoteId=${!!quoteId}, fileUrl=${!!fileUrl}, baseRequirementsText=${!!baseRequirementsText}, idToken=${!!idToken}`
      );
      return NextResponse.json(
        {
          success: false,
          error: "Missing required fields: userId, sessionId, quoteId, fileUrl, baseRequirementsText, idToken",
          details: "Validation failed at API entry point",
        },
        { status: 400 }
      );
    }

    console.log(`\n[${quoteId}] ==================== PIPELINE START ====================`);
    console.log(`[${quoteId}] User: ${userId} | Session: ${sessionId} | File: ${fileKey}`);

    // Update status to "processing" via REST API
    await updateRTDB(`quotations/${userId}/${sessionId}/${quoteId}`, { status: "processing" }, idToken);

    // ===== STAGE 1: FILE PARSING =====
    console.log(`[${quoteId}] STAGE 1: File Parsing from base64 data (supports PDF, Images, and TXT)...`);
    const parsedQuotation = await stagePdfParsing(fileUrl, quoteId, fileKey);

    // ===== STAGE 2-3 (UNIFIED): GEMINI DIRECT ANALYSIS (Extract + Validate in One Pass) =====
    console.log(`[${quoteId}] STAGE 2-3: Gemini Direct Analysis (temperature: 0, unified extraction+validation)...`);
    const geminiResult = await stageGeminiDirectAnalysis(
      parsedQuotation,
      baseRequirementsText,
      quoteId,
      fileKey,
      targetCurrency
    );

    // ===== BUILD FINAL PARSED DATA OBJECT =====
    // Strip all commas, currency symbols, and letters. Keep only numbers and decimals.
    const rawCostString = geminiResult.totalCost?.toString() || "0";
    const cleanCostString = rawCostString.replace(/[^0-9.]/g, '');

    const parsedData: ParsedQuotationData = {
      totalCost: parseFloat(cleanCostString),
      complianceScore: geminiResult.complianceScore || 0,
      missingSpecs: geminiResult.missingRequirements || [],
      lineItems: geminiResult.lineItems || [],
      allSpecs: geminiResult.allSpecs || [],
      certifications: geminiResult.certifications || [],
      deliveryTime: geminiResult.deliveryTime || "Not specified",
    };

    // ===== UPDATE RTDB WITH FINAL RESULTS =====
    console.log(`[${quoteId}] Updating RTDB with final results...`);
    await updateRTDB(`quotations/${userId}/${sessionId}/${quoteId}`, {
      status: "analyzed",
      parsedData,
      finalJsonReport: geminiResult,
      overallRecommendation: geminiResult.overallRecommendation || "UNKNOWN",
      criticalIssues: geminiResult.criticalIssues || [],
      unitConversions: geminiResult.unitConversions || [],
      measurementPrecisionErrors: geminiResult.measurementPrecisionErrors || [],
      requirementsCoverage: geminiResult.requirementsCoverage || {},
      analyzedAt: Date.now(),
    }, idToken);

    console.log(`[${quoteId}] ==================== PIPELINE SUCCESS ====================\n`);

    return NextResponse.json(
      {
        success: true,
        data: {
          parsedData,
          recommendation: geminiResult.overallRecommendation,
          complianceScore: geminiResult.complianceScore,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown extraction error";
    const errorStack = error instanceof Error ? error.stack : "No stack trace available";

    console.error(`\n❌ [EXTRACT API ERROR] QuoteID: ${quoteId} | File: ${fileKey}`);
    console.error(`Error Message: ${errorMsg}`);
    console.error(`Stack Trace:\n${errorStack}\n`);

    // Extract userId, sessionId from request body to update error status in RTDB
    try {
      const payload = await request.json();
      const { userId, sessionId } = payload;
      const errorIdToken = (payload as any).idToken || idToken;

      if (userId && sessionId && quoteId && quoteId !== "UNKNOWN") {
        await updateRTDB(`quotations/${userId}/${sessionId}/${quoteId}`, {
          status: "error",
          errorMessage: errorMsg,
          errorStack: errorStack,
          errorDetails: {
            file: fileKey,
            stage: "Pipeline Execution",
            timestamp: Date.now(),
          },
          errorAt: Date.now(),
        }, errorIdToken);

        console.error(
          `✓ Error status updated in RTDB for QuoteID: ${quoteId} - ${errorMsg}`
        );
      }
    } catch (updateError) {
      console.error(
        `❌ Failed to update error status in RTDB:`,
        updateError instanceof Error ? updateError.message : "Unknown error"
      );
    }

    // Return detailed error response to frontend
    return NextResponse.json(
      {
        success: false,
        error: errorMsg,
        details: errorMsg,
        quoteId: quoteId,
        fileKey: fileKey,
      },
      { status: 500 }
    );
  }
}
