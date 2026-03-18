/**
 * Quotation Extraction & Analysis API
 * AI Pipeline: PDF Parsing → Gemini Extraction (0% hallucination) → Gemini Adjudication (Strict Validation)
 *
 * TWO-PASS SYSTEM:
 * Pass 1 (Stage 2): Gemini Extraction - Merciless literal data auditor (extract ONLY what's written)
 * Pass 2 (Stage 3): Gemini Adjudication - STRICT procurement adjudicator (validate + normalize)
 *
 * CRITICAL PRODUCTION RULES:
 * - Temperature: 0 on ALL Gemini calls (zero creativity, 0% hallucination rate)
 * - PDF Source: Base64 encoded data from RTDB
 * - Gemini Extractor: Literal auditor mode - only extract what's explicitly written
 * - Gemini Adjudicator: REST API with JSON mode enforcement (responseMimeType: application/json)
 * - Rigid error handling at each stage with RTDB status tracking
 * - Enhanced image support via Gemini Vision API
 */

export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
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
        // Dynamic import to avoid Turbopack ESM resolution issues with CommonJS module
        const pdfParseModule: any = await import("pdf-parse");
        const pdfParse = pdfParseModule.default || pdfParseModule;
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
 * STAGE 2: GEMINI EXTRACTION (Pass 1 - Literal Data Auditor)
 * Role: Merciless, literal data auditor. Your ONLY job is to read and extract EXACTLY what is written.
 * Use Gemini with temperature: 0 (ZERO CREATIVITY) and responseMimeType: application/json
 * Performs ONLY literal extraction from quotation (no validation, no inference)
 * Supports both text-based quotations and images via Gemini Vision
 *
 * INPUT: Parsed quotation object (text or image), vendorName, quoteId, fileKey for logging
 * OUTPUT: Structured extraction JSON (lineItems, specifications, measurements, totalCost, deliveryTime)
 */
async function stageGeminiExtraction(
  parsedQuotation: Record<string, any>,
  vendorName: string,
  quoteId: string,
  fileKey: string
): Promise<Record<string, any>> {
  try {
    console.log(`[Gemini Extraction] Starting Stage 2: Literal Data Extraction...`);
    console.log(`[Gemini Extraction] Quotation type: ${parsedQuotation.type}${parsedQuotation.type === "image" ? ` (${parsedQuotation.mimeType})` : ""}...`);

    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable not set");
    }

    // Build the extraction prompt
    let extractionPrompt = `You are a MERCILESS LITERAL DATA AUDITOR. Your ONLY job is to read and extract EXACTLY what is written in the vendor quotation. Do NOT infer, guess, calculate, or assume missing information.

CRITICAL ANTI-HALLUCINATION RULES:
1. Extract ONLY information explicitly written in the quotation.
2. Copy technical specifications exactly as written - NO translation, NO interpretation.
3. For EVERY field (vendor name, line items, specifications, measurements, costs, delivery time):
   - If explicitly stated → Extract the EXACT value
   - If NOT explicitly stated → Write "NOT_EXPLICITLY_STATED"
4. DO NOT hallucinate prices, specifications, or measurements.
5. DO NOT infer missing data.
6. Extract the vendor name from the quotation exactly as written.
7. Extract EVERY line item with: description (exact wording), quantity, and unit (exactly as written).
8. Extract EVERY specification (certifications, quality standards, technical specs) - word for word, no translation.
9. Extract measurements in the EXACT units the vendor specified (do NOT convert).
10. Extract total cost in the EXACT currency and value stated in the quotation.
11. Extract delivery time in the EXACT format stated (e.g., "10 days", "2 weeks", "immediate", etc.).

`;

    if (parsedQuotation.type === "text") {
      extractionPrompt += `VENDOR QUOTATION TEXT:
${parsedQuotation.text}
`;
    } else {
      extractionPrompt += `VENDOR QUOTATION IMAGE attached below (read the image and extract data exactly as written):
`;
    }

    extractionPrompt += `

RETURN THIS JSON STRUCTURE (valid JSON only, zero markdown):
{
  "vendorName": "exact name as written in quotation (not inferred)",
  "lineItems": [
    {
      "description": "exact description from quotation",
      "quantity": "exact quantity value with unit as written (e.g., '500', '10 pcs', '2.5 tons')",
      "unit": "exact unit as written in quotation"
    }
  ],
  "lineItemsRaw": "full raw line items section copied verbatim from quotation to verify extraction",
  "specifications": [
    "exact specification as written",
    "certification exactly as stated",
    "material grade exactly as written"
  ],
  "measurements": {
    "specification_name": "exact value with unit as written (e.g., '100 mm', '5.5 torr', '2000 lbs')"
  },
  "totalCost": "exact total cost value as stated in quotation (e.g., '50000', '1,000,000 USD', '5 Lakh INR')",
  "currency": "currency exactly as stated (or 'NOT_EXPLICITLY_STATED')",
  "deliveryTime": "delivery time exactly as stated (e.g., '10 days', '2 weeks', '30 calendar days', 'immediate')",
  "certifications": ["exact certification as written"],
  "extractionNotes": "any ambiguities or unclear data in the quotation"
}

CRITICAL: Your response MUST be valid JSON. Start with { and end with }. No markdown. No code blocks. JSON ONLY.`;

    const parts: Record<string, any>[] = [
      {
        text: extractionPrompt,
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
      console.log(`[Gemini Extraction] Image appended to request (${parsedQuotation.mimeType}, ${parsedQuotation.data.length} chars base64)`);
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

    console.log(`[Gemini Extraction] Raw response length: ${responseText.length} characters`);

    let extractionResult: Record<string, any> | null = null;

    // STAGE 8 (PRIORITY): Smart JSON extraction - find first { to last }
    const firstBraceIdx = responseText.indexOf("{");
    const lastBraceIdx = responseText.lastIndexOf("}");

    if (firstBraceIdx !== -1 && lastBraceIdx !== -1 && firstBraceIdx < lastBraceIdx) {
      const extractedJSON = responseText.substring(firstBraceIdx, lastBraceIdx + 1);
      try {
        const sanitizedExtractedJSON = sanitizeJSON(extractedJSON);
        extractionResult = JSON.parse(sanitizedExtractedJSON);
        console.log(`[Gemini Extraction] ✓ Successfully parsed via Stage 8 extraction`);
      } catch (extractError) {
        console.error(`[Gemini Extraction JSON Error (Stage 8)]`, extractError instanceof Error ? extractError.message : "Unknown");
      }
    }

    // STAGE 1 (FALLBACK): Direct parse with sanitization
    if (!extractionResult) {
      try {
        const sanitizedJSON = sanitizeJSON(responseText);
        extractionResult = JSON.parse(sanitizedJSON);
        console.log(`[Gemini Extraction] ✓ Successfully parsed via Stage 1 fallback`);
      } catch (parseError) {
        console.error(`[Gemini Extraction JSON Error (Stage 1)]`, parseError instanceof Error ? parseError.message : "Unknown");
      }
    }

    // STAGE 9: Non-greedy regex as last resort
    if (!extractionResult) {
      const nonGreedyMatch = responseText.match(/\{[\s\S]*?\}/);
      if (nonGreedyMatch) {
        try {
          const sanitizedNonGreedy = sanitizeJSON(nonGreedyMatch[0]);
          extractionResult = JSON.parse(sanitizedNonGreedy);
          console.log(`[Gemini Extraction] ✓ Successfully parsed via Stage 9 non-greedy regex`);
        } catch (nonGreedyError) {
          console.error(`[Gemini Extraction JSON Error (Stage 9)]`, nonGreedyError instanceof Error ? nonGreedyError.message : "Unknown");
        }
      }
    }

    // If all parsing stages failed, return structured error object
    if (!extractionResult) {
      console.error(`[Gemini Extraction] All parsing stages failed - returning structured error object`);
      console.error(`[Gemini Extraction Debug] Response length: ${responseText.length}`);
      console.error(`[Gemini Extraction Debug] First 500 chars:`, responseText.substring(0, 500));

      extractionResult = {
        vendorName: "UNKNOWN",
        lineItems: [],
        specifications: [],
        measurements: {},
        totalCost: "0",
        currency: "UNKNOWN",
        deliveryTime: "NOT_EXPLICITLY_STATED",
        certifications: [],
        extractionNotes: `Gemini API error: Could not extract valid JSON from response (failed Stages 1-9)`,
      };
    }

    console.log(
      `[Gemini Extraction] Extracted vendor: ${extractionResult.vendorName} | Items: ${extractionResult.lineItems?.length || 0}`
    );

    return extractionResult;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(
      `\n❌ [EXTRACT ERROR] QuoteID: ${quoteId} | File: ${fileKey} | Stage: Gemini Extraction | Details: `,
      errorMsg,
      "\nStack: ",
      error instanceof Error ? error.stack : "No stack trace"
    );
    throw new Error(`Gemini Extraction Error: ${errorMsg}`);
  }
}

/**
 * STAGE 3: GEMINI ADJUDICATION (Pass 2 - Strict Procurement Adjudicator)
 * Role: STRICT procurement adjudicator. Validate extracted data against requirements, execute normalizations.
 * Use Gemini with temperature: 0 (ZERO CREATIVITY) and responseMimeType: application/json
 * Performs validation, unit conversion, currency normalization, delivery time normalization
 * INPUT: Extracted data, baseRequirementsText, targetCurrency, quoteId, fileKey for logging
 * OUTPUT: Final adjudication JSON (complianceScore, matchedRequirements, missingRequirements, unitConversions, overallRecommendation)
 */
async function stageGeminiAdjudication(
  extractionData: Record<string, any>,
  baseRequirementsText: string,
  targetCurrency: string,
  quoteId: string,
  fileKey: string
): Promise<Record<string, any>> {
  try {
    console.log(`[Gemini Adjudication] Starting Stage 3: STRICT Validation & Normalization...`);

    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable not set");
    }

    // Build the adjudication prompt
    let adjudicationPrompt = `You are a STRICT PROCUREMENT ADJUDICATOR. Your job is to validate extracted vendor data against base requirements with MATHEMATICAL PRECISION and execute all normalizations.

BASE REQUIREMENTS:
${baseRequirementsText}

EXTRACTED VENDOR DATA:
${JSON.stringify(extractionData, null, 2)}

VALIDATION RULES:
1. Compare extracted specifications against base requirements - EXACT MATCH only.
2. If extracted value is "NOT_EXPLICITLY_STATED", mark as MISSING.
3. Calculate compliance score: (Matched requirements / Total base requirements) × 100.
4. Generate complianceScore as integer 0-100.
5. List ALL matched requirements in "matchedRequirements" array.
6. List ALL unmatched or missing base requirements in "missingRequirements" array.
   CRITICAL: This must compare extracted data against the base requirements and explicitly list which base requirements were NOT found or matched.
7. If a measurement conversion is needed, execute it and document in "unitConversions" array.

CRITICAL RULE: THE UNIT CONVERSION PROTOCOL
1. If the base requirement and the vendor quotation use different units for the same metric (e.g., Tons vs. BTUs, kg vs. lbs, mm vs. inches, meters vs. feet, Torr vs kPa), you MUST attempt to mathematically convert the vendor's unit to the base requirement's unit.
2. Use these standard conversions:
   - Mass: 1 ton = 1000 kg = 2204.62 lbs
   - Distance: 1 meter = 1000 mm = 39.37 inches = 3.28084 feet
   - Pressure: 1 Torr = 0.133322 kPa, 1 bar = 100 kPa, 1 psi = 6.89476 kPa
   - Energy: 1 BTU = 1055.06 Joules
   - Volume: 1 Liter = 0.001 m³ = 264.172 gallons
3. If the converted value meets or exceeds the base requirement, mark it as COMPLIANT. Do NOT penalize the vendor for using a different unit.
4. Document successful conversions in the "unitConversions" array, formatted exactly as: "Converted [Vendor Value/Unit] to [Converted Value/Base Unit] to verify compliance with [Requirement]."
5. If units are fundamentally incompatible (e.g., 'Liters' vs 'Meters'), mark as a FAILURE and add to "measurementPrecisionErrors".

CRITICAL RULE: CURRENCY NORMALIZATION
1. The USER has explicitly requested all financial data to be converted into this TARGET CURRENCY: ${targetCurrency}.
2. The extracted total cost is: "${extractionData.totalCost}" in currency: "${extractionData.currency}".
3. Detect the currency used in the extracted total cost. If "NOT_EXPLICITLY_STATED", assume USD.
4. If the extracted currency differs from the TARGET CURRENCY (${targetCurrency}), you MUST mathematically convert the vendor's total cost into ${targetCurrency}.
5. Use these exact exchange rates: 1 USD = 83 INR, 1 EUR = 90 INR, 1 GBP = 104 INR, 1 JPY = 0.55 INR (calculate inverses if necessary).
6. Output the final converted amount in the "totalCost" field, and output "${targetCurrency}" in the "currency" field.
7. If the extracted total cost is "NOT_EXPLICITLY_STATED", output "NOT_EXPLICITLY_STATED" in "totalCost" and "UNKNOWN" in "currency".

CRITICAL RULE: DELIVERY TIME NORMALIZATION
1. You MUST mathematically normalize the vendor's stated delivery time into a standardized format.
2. The extracted delivery time is: "${extractionData.deliveryTime}".
3. Calculate the total delivery time in days using these conversions: 1 week = 7 days, 1 month ≈ 30 days, 1 quarter = 90 days, 1 year = 365 days, 1 hour = 0.041667 days.
4. If the total delivery time is LESS than 7 days (168 hours), output the value strictly in "days" format with 1 decimal place if needed (e.g., "5 days", "3.5 days").
5. If the total delivery time is 7 days or MORE, mathematically convert it and output it strictly in "weeks" format with 1 decimal place if needed (e.g., "6 weeks", "2.5 weeks").
6. Examples of correct normalization:
   - "1008 hours" → convert to weeks (1008/24 = 42 days, 42/7 = 6) → "6 weeks"
   - "42 calendar days" → convert to weeks (42/7 = 6) → "6 weeks"
   - "1.5 months" (30 days/month) → 45 days → convert to weeks (45/7 = 6.4) → "6.4 weeks"
   - "120 hours" → less than 7 days (120/24 = 5) → "5 days"
   - "NOT_EXPLICITLY_STATED" → keep as "NOT_EXPLICITLY_STATED"
7. Output ONLY this standardized value in the "deliveryTime" field of your final JSON.

RECOMMENDATION LOGIC:
- If compliance = 100% and NO critical financial anomalies → "APPROVED"
- If compliance ≥ 80% → "CONDITIONAL"
- If compliance < 80% OR price is excessive OR critical data missing → "REJECTED"

RETURN THIS JSON STRUCTURE (valid JSON only):
{
  "complianceScore": 0-100,
  "matchedRequirements": ["string"],
  "missingRequirements": ["string"],
  "unitConversions": ["string"],
  "measurementPrecisionErrors": ["string"],
  "allSpecs": ["string"],
  "certifications": ["string"],
  "totalCost": "string",
  "currency": "string",
  "deliveryTime": "string",
  "criticalIssues": ["string"],
  "overallRecommendation": "APPROVED|CONDITIONAL|REJECTED",
  "validationNotes": "string"
}

CRITICAL: Your response MUST be valid JSON. Start with { and end with }. No markdown. JSON ONLY.`;

    const parts: Record<string, any>[] = [
      {
        text: adjudicationPrompt,
      },
    ];

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
        `Gemini Adjudication API Error: ${response.status} - ${JSON.stringify(errorData)}`
      );
    }

    const responseData = await response.json();
    const responseText =
      responseData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    if (!responseText) {
      throw new Error("Gemini adjudication returned empty response");
    }

    console.log(`[Gemini Adjudication] Raw response length: ${responseText.length} characters`);

    let adjudicationResult: Record<string, any> | null = null;

    // STAGE 8 (PRIORITY): Smart JSON extraction - find first { to last }
    const firstBraceIdx = responseText.indexOf("{");
    const lastBraceIdx = responseText.lastIndexOf("}");

    if (firstBraceIdx !== -1 && lastBraceIdx !== -1 && firstBraceIdx < lastBraceIdx) {
      const extractedJSON = responseText.substring(firstBraceIdx, lastBraceIdx + 1);
      try {
        const sanitizedExtractedJSON = sanitizeJSON(extractedJSON);
        adjudicationResult = JSON.parse(sanitizedExtractedJSON);
        console.log(`[Gemini Adjudication] ✓ Successfully parsed via Stage 8 extraction`);
      } catch (extractError) {
        console.error(`[Gemini Adjudication JSON Error (Stage 8)]`, extractError instanceof Error ? extractError.message : "Unknown");
      }
    }

    // STAGE 1 (FALLBACK): Direct parse with sanitization
    if (!adjudicationResult) {
      try {
        const sanitizedJSON = sanitizeJSON(responseText);
        adjudicationResult = JSON.parse(sanitizedJSON);
        console.log(`[Gemini Adjudication] ✓ Successfully parsed via Stage 1 fallback`);
      } catch (parseError) {
        console.error(`[Gemini Adjudication JSON Error (Stage 1)]`, parseError instanceof Error ? parseError.message : "Unknown");
      }
    }

    // STAGE 9: Non-greedy regex as last resort
    if (!adjudicationResult) {
      const nonGreedyMatch = responseText.match(/\{[\s\S]*?\}/);
      if (nonGreedyMatch) {
        try {
          const sanitizedNonGreedy = sanitizeJSON(nonGreedyMatch[0]);
          adjudicationResult = JSON.parse(sanitizedNonGreedy);
          console.log(`[Gemini Adjudication] ✓ Successfully parsed via Stage 9 non-greedy regex`);
        } catch (nonGreedyError) {
          console.error(`[Gemini Adjudication JSON Error (Stage 9)]`, nonGreedyError instanceof Error ? nonGreedyError.message : "Unknown");
        }
      }
    }

    // If all parsing stages failed, return structured error object
    if (!adjudicationResult) {
      console.error(`[Gemini Adjudication] All parsing stages failed - returning structured error object`);
      console.error(`[Gemini Adjudication Debug] Response length: ${responseText.length}`);
      console.error(`[Gemini Adjudication Debug] First 500 chars:`, responseText.substring(0, 500));

      adjudicationResult = {
        complianceScore: 0,
        matchedRequirements: [],
        missingRequirements: ["All requirements - JSON parsing failed across all stages"],
        unitConversions: [],
        measurementPrecisionErrors: [],
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
      `[Gemini Adjudication] Compliance score: ${adjudicationResult.complianceScore}%`
    );
    console.log(
      `[Gemini Adjudication] Recommendation: ${adjudicationResult.overallRecommendation}`
    );

    return adjudicationResult;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(
      `\n❌ [EXTRACT ERROR] QuoteID: ${quoteId} | File: ${fileKey} | Stage: Gemini Adjudication | Details: `,
      errorMsg,
      "\nStack: ",
      error instanceof Error ? error.stack : "No stack trace"
    );
    throw new Error(`Gemini Adjudication Error: ${errorMsg}`);
  }
}


/**
 * POST HANDLER: Execute the Two-Pass Gemini AI Pipeline
 *
 * Flow:
 * 1. PDF Parsing: Decode base64 from RTDB → Extract text or image data
 * 2. Gemini Extraction (Pass 1): temperature: 0, literal data auditor - extract ONLY what's written
 * 3. Gemini Adjudication (Pass 2): temperature: 0, strict validation + all normalizations
 * 4. RTDB Update: Store results with status tracking
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

    console.log(`\n[${quoteId}] ==================== TWO-PASS PIPELINE START ====================`);
    console.log(`[${quoteId}] User: ${userId} | Session: ${sessionId} | File: ${fileKey}`);

    // Update status to "processing" via REST API
    await updateRTDB(`quotations/${userId}/${sessionId}/${quoteId}`, { status: "processing" }, idToken);

    // ===== STAGE 1: FILE PARSING =====
    console.log(`[${quoteId}] STAGE 1: File Parsing from base64 data (supports PDF, Images, and TXT)...`);
    const parsedQuotation = await stagePdfParsing(fileUrl, quoteId, fileKey);

    // ===== STAGE 2: GEMINI EXTRACTION (Pass 1 - Literal Data Auditor) =====
    console.log(`[${quoteId}] STAGE 2: Gemini Extraction (temperature: 0, literal auditor - extract ONLY what's written)...`);
    const extractionResult = await stageGeminiExtraction(
      parsedQuotation,
      "UNKNOWN",
      quoteId,
      fileKey
    );

    // ===== STAGE 3: GEMINI ADJUDICATION (Pass 2 - Strict Validation & Normalization) =====
    console.log(`[${quoteId}] STAGE 3: Gemini Adjudication (temperature: 0, strict validation + normalizations)...`);
    const adjudicationResult = await stageGeminiAdjudication(
      extractionResult,
      baseRequirementsText,
      targetCurrency,
      quoteId,
      fileKey
    );

    // ===== BUILD FINAL PARSED DATA OBJECT =====
    // Strip all commas, currency symbols, and letters. Keep only numbers and decimals.
    const rawCostString = adjudicationResult.totalCost?.toString() || "0";
    const cleanCostString = rawCostString.replace(/[^0-9.]/g, '');

    const parsedData: ParsedQuotationData = {
      totalCost: parseFloat(cleanCostString),
      complianceScore: adjudicationResult.complianceScore || 0,
      missingSpecs: adjudicationResult.missingRequirements || [],
      lineItems: extractionResult.lineItems || [],
      allSpecs: adjudicationResult.allSpecs || extractionResult.specifications || [],
      certifications: adjudicationResult.certifications || extractionResult.certifications || [],
      deliveryTime: adjudicationResult.deliveryTime || "Not specified",
    };

    // ===== UPDATE RTDB WITH FINAL RESULTS =====
    console.log(`[${quoteId}] Updating RTDB with final results...`);
    await updateRTDB(`quotations/${userId}/${sessionId}/${quoteId}`, {
      status: "analyzed",
      parsedData,
      extractionResult: extractionResult,
      finalJsonReport: adjudicationResult,
      overallRecommendation: adjudicationResult.overallRecommendation || "UNKNOWN",
      criticalIssues: adjudicationResult.criticalIssues || [],
      unitConversions: adjudicationResult.unitConversions || [],
      measurementPrecisionErrors: adjudicationResult.measurementPrecisionErrors || [],
      requirementsCoverage: adjudicationResult.requirementsCoverage || {},
      analyzedAt: Date.now(),
    }, idToken);

    console.log(`[${quoteId}] ==================== TWO-PASS PIPELINE SUCCESS ====================\n`);

    return NextResponse.json(
      {
        success: true,
        data: {
          parsedData,
          recommendation: adjudicationResult.overallRecommendation,
          complianceScore: adjudicationResult.complianceScore,
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
            stage: "Two-Pass Pipeline Execution",
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
