/**
 * Quotation Cancellation & Error Status API
 * Handles:
 * 1. Manual cancellation of stuck "processing" quotations
 * 2. Auto-fail timeout for quotations stuck >5 minutes
 * 
 * Uses Firebase ID token for authenticated RTDB updates
 */

import { NextRequest, NextResponse } from "next/server";

const FIREBASE_DATABASE_URL =
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ||
  "https://quotation-sorter-app-default-rtdb.asia-southeast1.firebasedatabase.app";

/**
 * Firebase REST API Helper: Update RTDB with authenticated request
 */
async function updateRTDB(
  path: string,
  data: Record<string, any>,
  idToken: string
): Promise<void> {
  const url = `${FIREBASE_DATABASE_URL}/${path}.json?auth=${idToken}`;
  
  console.log(`[API/CANCEL] REST URL: ${url.substring(0, 100)}...`);
  console.log(`[API/CANCEL] Token length: ${idToken.length} chars`);
  console.log(`[API/CANCEL] Update payload:`, JSON.stringify(data, null, 2));
  
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json();
    console.error(`[API/CANCEL] RTDB Response Status: ${response.status}`);
    console.error(`[API/CANCEL] RTDB Error Data:`, errorData);
    throw new Error(`RTDB PATCH failed: ${response.status} - ${JSON.stringify(errorData)}`);
  }
  
  const responseData = await response.json();
  console.log(`[API/CANCEL] RTDB Update Success:`, responseData);
}

export async function POST(req: NextRequest) {
  try {
    console.log("[API/CANCEL] ========== CANCEL REQUEST START ==========");

    const body = await req.json();
    const { userId, sessionId, quoteId, idToken, reason, targetStatus } = body;

    // Validate required fields
    if (!userId || !sessionId || !quoteId || !idToken) {
      console.error("[API/CANCEL] Missing required fields:", {
        userId: !!userId,
        sessionId: !!sessionId,
        quoteId: !!quoteId,
        idTokenLength: idToken?.length || 0,
      });
      return NextResponse.json(
        { error: "Missing required fields (userId, sessionId, quoteId, idToken)" },
        { status: 400 }
      );
    }

    const status = targetStatus || "canceled"; 
    console.log(`[API/CANCEL] Field Validation Passed`);
    console.log(`[API/CANCEL] userId: ${userId}`);
    console.log(`[API/CANCEL] sessionId: ${sessionId}`);
    console.log(`[API/CANCEL] quoteId: ${quoteId}`);
    console.log(`[API/CANCEL] status: ${status}`);
    console.log(`[API/CANCEL] targetStatus: ${targetStatus}`);
    console.log(`[API/CANCEL] reason: ${reason}`);
    console.log(`[API/CANCEL] idToken length: ${idToken.length}`);

    // Build the update data
    const path = `quotations/${userId}/${sessionId}/${quoteId}`;
    const updateData: Record<string, any> = {
      status,
      updatedAt: Date.now(),
    };

    // Add appropriate metadata based on status
    if (status === "canceled") {
      updateData.canceledAt = Date.now();
      updateData.canceledReason = reason || "Manually canceled by user";
    } else if (status === "error") {
      updateData.errorAt = Date.now();
      updateData.errorMessage = reason || "Processing timeout (5 minutes exceeded)";
    }

    console.log(`[API/CANCEL] Update path: ${path}`);
    console.log(`[API/CANCEL] Update data:`, JSON.stringify(updateData, null, 2));

    // Attempt RTDB update
    console.log(`[API/CANCEL] Calling updateRTDB...`);
    await updateRTDB(path, updateData, idToken);

    console.log(`[API/CANCEL] ========== SUCCESS ==========`);

    return NextResponse.json(
      {
        success: true,
        message: `Quotation status updated to ${status}`,
        quoteId,
        status,
        timestamp: updateData.updatedAt,
      },
      { status: 200 }
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[API/CANCEL] ========== ERROR ==========");
    console.error("[API/CANCEL] Error Message:", errorMsg);
    console.error("[API/CANCEL] Full Error:", error);
    console.error("[API/CANCEL] ========== END ERROR ==========");

    return NextResponse.json(
      { error: errorMsg || "Failed to update quotation status" },
      { status: 500 }
    );
  }
}

