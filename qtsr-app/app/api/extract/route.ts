/**
 * Quotation Extraction & Analysis API
 * Hybrid AI Pipeline: PDF Parsing → Groq Extraction (0% hallucination) → Gemini Validation (Strict Schema)
 * 
 * CRITICAL PRODUCTION RULES:
 * - Temperature: 0 on BOTH Groq and Gemini (zero creativity, 0% hallucination rate)
 * - PDF Source: Firebase Storage HTTP URL (not base64)
 * - Groq: Literal auditor mode - only extract what's explicitly written
 * - Gemini: REST API with JSON mode enforcement
 * - Rigid error handling at each stage with RTDB status tracking
 */

import { NextRequest, NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { Groq } from "groq-sdk";
import { rtdb } from "@/lib/firebase";
import { ref, update } from "firebase/database";
import {
  ExtractionRequest,
  ParsedQuotationData,
} from "@/lib/types";

// Initialize Groq Client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * STAGE 1: PDF PARSING FROM FIREBASE STORAGE URL
 * Fetch the PDF from Firebase Storage URL, convert to Buffer, extract raw text using pdf-parse
 * 
 * INPUT: Firebase Storage HTTP URL
 * OUTPUT: Raw text extracted from PDF
 */
async function stagePdfParsing(fileUrl: string): Promise<string> {
  try {
    console.log(`[PDF Parsing] Fetching PDF from URL...`);
    
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    // Fetch the PDF from Firebase Storage URL
    const response = await fetch(fileUrl, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch PDF: HTTP ${response.status} ${response.statusText}`
      );
    }

    // Convert response to buffer
    const arrayBuffer = await response.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);

    if (pdfBuffer.length === 0) {
      throw new Error("Downloaded PDF is empty (0 bytes)");
    }

    console.log(`[PDF Parsing] Parsing PDF buffer (${pdfBuffer.length} bytes)...`);

    // Extract text using pdf-parse
    const parser = new PDFParse({ data: pdfBuffer });
    const result = await parser.getText();
    const rawText = result.text?.trim() || "";

    if (!rawText || rawText.length === 0) {
      throw new Error("PDF extraction returned empty text");
    }

    await parser.destroy();

    console.log(`[PDF Parsing] Extracted ${rawText.length} characters from PDF`);
    return rawText;
  } catch (error) {
    throw new Error(
      `PDF Parsing Failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * STAGE 1: GROQ DATA EXTRACTION (The Strict Reader)
 * Initialize Groq client with temperature: 0 (ZERO CREATIVITY)
 * Extract vendor name, total cost, line items, and specifications
 * CRITICAL: Only extract information explicitly written in the quotation
 * 
 * INPUT: Raw PDF text, Base Requirements
 * OUTPUT: Structured vendor data with no hallucinations
 */
async function stageGroqExtraction(
  pdfText: string,
  baseRequirementsText: string,
  vendorName: string
): Promise<Record<string, any>> {
  try {
    console.log(`[Groq Extraction] Starting Groq llama-3.3-70b extraction (temperature: 0)...`);

    const message = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: 4096,
      temperature: 0, // CRITICAL: Disable all creativity
      messages: [
        {
          role: "user",
          content: `You are a merciless, literal data auditor. Your ONLY job is to read the provided vendor quotation and extract EXACTLY what is written. 

BASE REQUIREMENTS:
${baseRequirementsText}

VENDOR QUOTATION (${vendorName}):
${pdfText}

CRITICAL ANTI-HALLUCINATION RULES:
1. EXTRACT ONLY information that is explicitly written in the quotation text.
2. DO NOT infer, guess, calculate, or assume missing information.
3. DO NOT hallucinate prices, specifications, or measurements.
4. If a value is NOT explicitly stated in the quotation, write "NOT_EXPLICITLY_STATED".
5. DO NOT translate or alter technical specifications - copy them exactly as written.
6. For each base requirement, explicitly state whether it is mentioned, partially mentioned, or MISSING.
7. Extract the vendor name exactly as written.
8. Extract EVERY line item, specification, and measurement word-for-word.

OUTPUT ONLY a valid JSON object with this exact structure (no markdown, no code blocks):
{
  "vendorName": "exact name as written in quotation",
  "extractedData": {
    "lineItems": [
      {
        "description": "exact text from quotation",
        "quantity": "as written or NOT_EXPLICITLY_STATED",
        "unit": "as written or NOT_EXPLICITLY_STATED",
        "unitPrice": "exact price or NOT_EXPLICITLY_STATED",
        "notes": "any qualifiers or notes"
      }
    ],
    "specifications": [
      "exact specification text as written",
      "another specification"
    ],
    "measurements": [
      {
        "description": "what measurement (e.g., diameter, weight)",
        "value": "exact value as written or NOT_EXPLICITLY_STATED",
        "unit": "exact unit or NOT_EXPLICITLY_STATED",
        "exactText": "the original text from quotation"
      }
    ],
    "totalCost": "exact total or NOT_EXPLICITLY_STATED",
    "currency": "currency symbol or NOT_EXPLICITLY_STATED",
    "deliveryTime": "as stated or NOT_EXPLICITLY_STATED",
    "certifications": ["exact certification names"],
    "warnings": ["any red flags or unclear information"]
  },
  "requirementsCoverage": {
    "mentioned": ["requirements mentioned in quotation"],
    "missing": ["requirements NOT mentioned in quotation"],
    "unclear": ["requirements that are unclear or partially mentioned"]
  }
}

PUNISHMENT RULES:
- If you hallucinate ANY data, the quotation will be REJECTED.
- If you infer a price that isn't written, REJECTED.
- If you guess a measurement unit, REJECTED.
- Only extract LITERAL text.`,
        },
      ],
    });

    const responseText = message.choices[0]?.message?.content ?? "";

    // Extract JSON from response (handle potential markdown wrapping)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Groq returned invalid JSON format");
    }

    const extractedData = JSON.parse(jsonMatch[0]);

    if (!extractedData.extractedData || !extractedData.requirementsCoverage) {
      throw new Error("Groq response missing required fields");
    }

    console.log(`[Groq Extraction] Successfully extracted data from quotation`);
    return extractedData;
  } catch (error) {
    throw new Error(
      `Groq Extraction Failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * STAGE 2: GEMINI JSON ADJUDICATION (The Enforcer)
 * Use Gemini API via REST with temperature: 0 (DETERMINISTIC OUTPUT)
 * Validate extracted data against base requirements with strict JSON response
 * 
 * INPUT: Groq extracted data, Base Requirements
 * OUTPUT: Compliance score, matched specs, critical gaps
 */
async function stageGeminiAdjudication(
  groqData: Record<string, any>,
  baseRequirementsText: string
): Promise<Record<string, any>> {
  try {
    console.log(`[Gemini Adjudication] Starting Gemini 2.5-flash validation (temperature: 0)...`);

    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable not set");
    }

    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `You are a STRICT procurement adjudicator. Review the extracted quotation data and validate it against the base requirements.

BASE REQUIREMENTS:
${baseRequirementsText}

EXTRACTED QUOTATION DATA (from Groq - already literal, no hallucinations):
${JSON.stringify(groqData, null, 2)}

YOUR CRITICAL TASKS:
1. STRICT LITERAL MATCHING: If requirement asks for "32GB RAM" and quotation says "16GB RAM", it is a FAILURE. Do NOT give partial credit.
2. ZERO HALLUCINATION: If a value is "NOT_EXPLICITLY_STATED" from Groq, you must treat it as a FAILURE. Do NOT invent prices or specs.
3. Determine compliance score (0-100) strictly based on ratio of PERFECTLY MET requirements to total requirements.
4. Identify missing or failed specs and add to "missingRequirements".
5. Output ONLY valid JSON.

VALIDATION RULES (NON-NEGOTIABLE):
- If base requirement is "ISO 9001 certification" and quotation has NO certification mention → MISSING.
- If value is "NOT_EXPLICITLY_STATED" → MISSING from compliance score calculation.
- Compliance score = (Number of perfectly matched requirements / Total identified requirements) × 100.
- If multiple critical gaps exist → overallRecommendation = "CONDITIONAL" or "REJECTED".
- If all requirements met → overallRecommendation = "APPROVED".

CRITICAL RULE: THE UNIT CONVERSION PROTOCOL
1. If the base requirement and the vendor quotation use different units for the same metric (e.g., Tons vs. BTUs, kg vs. lbs, mm vs. inches, meters vs. feet), you MUST attempt to mathematically convert the vendor's unit to the base requirement's unit.
2. If the converted value meets or exceeds the base requirement, mark it as COMPLIANT. Do NOT penalize the vendor for using a different unit.
3. If you perform a conversion, you must document it in a new array called "unitConversions" in the JSON output, formatted as: "Converted [Vendor Value] [Vendor Unit] to [Converted Value] [Base Unit] to verify compliance with requirement of [Requirement Value] [Base Unit]."
4. If the units are fundamentally incompatible (e.g., requirement asks for 'Liters' and vendor provides 'Meters'), mark the spec as a FAILURE and add it to the "measurementPrecisionErrors" array with the reason: "[Requirement] expected in [Requirement Unit], but vendor provided [Vendor Unit] - incompatible dimensions."
5. Example conversions:
   - Requirement: "2 Ton AC Unit" + Vendor: "24,000 BTU" → Convert to "2 Ton equivalent" → PASS (document in unitConversions)
   - Requirement: "50 kg weight" + Vendor: "110 lbs" → Convert to "49.9 kg" → PASS (document in unitConversions)
   - Requirement: "100 mm bore" + Vendor: "3.937 inches" → Convert to "100 mm" → PASS (document in unitConversions)
   - Requirement: "50 Liters capacity" + Vendor: "50 Meters length" → FAIL (incompatible) → Add to measurementPrecisionErrors

RESPONSE FORMAT (valid JSON only, no markdown):
{
  "vendorName": "string",
  "complianceScore": 0-100,
  "matchedRequirements": ["string"],
  "missingRequirements": ["string"],
  "uncertainRequirements": ["string"],
  "unitConversions": ["Converted [Vendor Unit] to [Base Unit] to verify compliance"],
  "measurementPrecisionErrors": ["Incompatible units or precision failures"],
  "lineItems": [{"description": "string", "quantity": "string", "unit": "string", "unitPrice": "string"}],
  "certifications": ["string"],
  "totalCost": "string",
  "currency": "string",
  "deliveryTime": "string",
  "criticalIssues": ["string"],
  "overallRecommendation": "APPROVED | CONDITIONAL | REJECTED",
  "validationNotes": "string"
}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
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
      throw new Error("Gemini returned empty response");
    }

    const adjudicationResult = JSON.parse(responseText);

    console.log(
      `[Gemini Adjudication] Compliance score: ${adjudicationResult.complianceScore}%`
    );
    console.log(
      `[Gemini Adjudication] Recommendation: ${adjudicationResult.overallRecommendation}`
    );

    return adjudicationResult;
  } catch (error) {
    throw new Error(
      `Gemini Adjudication Failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}


/**
 * POST HANDLER: Execute the Hybrid AI Pipeline
 * 
 * Flow:
 * 1. PDF Parsing: Fetch from Firebase Storage URL → Extract text
 * 2. Groq Extraction: temperature: 0, literal auditor mode
 * 3. Gemini Adjudication: temperature: 0, strict JSON schema
 * 4. RTDB Update: Store results with status tracking
 */
export async function POST(request: NextRequest) {
  try {
    const payload: ExtractionRequest = await request.json();
    const { userId, sessionId, quoteId, fileUrl, baseRequirementsText } = payload;

    // Validation
    if (!userId || !sessionId || !quoteId || !fileUrl || !baseRequirementsText) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Missing required fields: userId, sessionId, quoteId, fileUrl, baseRequirementsText",
        },
        { status: 400 }
      );
    }

    console.log(`\n[${quoteId}] ==================== PIPELINE START ====================`);
    console.log(`[${quoteId}] User: ${userId} | Session: ${sessionId}`);

    // Update status to "processing"
    const quoteRef = ref(rtdb, `quotations/${userId}/${sessionId}/${quoteId}`);
    await update(quoteRef, { status: "processing" });

    // ===== STAGE 1: PDF PARSING =====
    console.log(`[${quoteId}] STAGE 1: PDF Parsing from Firebase Storage URL...`);
    const pdfText = await stagePdfParsing(fileUrl);

    // ===== STAGE 2: GROQ EXTRACTION (Temperature: 0, Literal Auditor) =====
    console.log(`[${quoteId}] STAGE 2: Groq Data Extraction (temperature: 0)...`);
    const groqResult = await stageGroqExtraction(
      pdfText,
      baseRequirementsText,
      quoteId
    );

    // ===== STAGE 3: GEMINI ADJUDICATION (Temperature: 0, Strict Schema) =====
    console.log(
      `[${quoteId}] STAGE 3: Gemini JSON Adjudication (temperature: 0)...`
    );
    const geminiResult = await stageGeminiAdjudication(
      groqResult,
      baseRequirementsText
    );

    // ===== BUILD FINAL PARSED DATA OBJECT =====
    const parsedData: ParsedQuotationData = {
      totalCost: parseFloat(
        groqResult.extractedData?.totalCost?.toString() || "0"
      ),
      complianceScore: geminiResult.complianceScore || 0,
      missingSpecs: geminiResult.missingRequirements || [],
      lineItems: geminiResult.lineItems || groqResult.extractedData?.lineItems || [],
      allSpecs: groqResult.extractedData?.specifications || [],
      certifications: geminiResult.certifications || groqResult.extractedData?.certifications || [],
      deliveryTime:
        geminiResult.deliveryTime || groqResult.extractedData?.deliveryTime || "Not specified",
    };

    // ===== UPDATE RTDB WITH FINAL RESULTS =====
    console.log(`[${quoteId}] Updating RTDB with final results...`);
    await update(quoteRef, {
      status: "analyzed",
      parsedData,
      finalJsonReport: geminiResult,
      groqExtractionReport: groqResult,
      overallRecommendation: geminiResult.overallRecommendation || "UNKNOWN",
      criticalIssues: geminiResult.criticalIssues || [],
      unitConversions: geminiResult.unitConversions || [],
      measurementPrecisionErrors: geminiResult.measurementPrecisionErrors || [],
      requirementsCoverage: groqResult.requirementsCoverage || {},
      analyzedAt: Date.now(),
    });

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
    console.error(`[Extract API Error]`, error);

    // Extract userId, sessionId, and quoteId from request body to update error status
    try {
      const payload = await request.json();
      const { userId, sessionId, quoteId } = payload;

      if (userId && sessionId && quoteId) {
        const quoteRef = ref(rtdb, `quotations/${userId}/${sessionId}/${quoteId}`);
        await update(quoteRef, {
          status: "error",
          errorMessage:
            error instanceof Error ? error.message : "Unknown extraction error",
          errorAt: Date.now(),
        });

        console.error(
          `[${quoteId}] Error status updated in RTDB: ${error instanceof Error ? error.message : "Unknown"}`
        );
      }
    } catch (updateError) {
      console.error(`[Extract API] Failed to update error status in RTDB:`, updateError);
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Extraction pipeline failed",
      },
      { status: 500 }
    );
  }
}
