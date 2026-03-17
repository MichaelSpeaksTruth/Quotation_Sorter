# Map-Reduce Architecture for Quotation Analysis

## Overview

The QuoteAnalyzer system implements a **Map-Reduce pattern** to efficiently handle 30+ vendor quotations without Vercel timeout or context degradation issues.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     FRONTEND (Workspace)                        │
│                                                                 │
│  1. User uploads base requirements                             │
│  2. User uploads multiple vendor quotations (drag-drop multi)  │
│  3. System batches uploads (5 concurrent max)                  │
│  4. Progress bar tracks individual file status                 │
│  5. "CLOSE SESSION" button triggers adjudication              │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │   MAP PHASE │
                    └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼──────┐  ┌───────▼──────┐  ┌───────▼──────┐
│ /api/extract  │  │ /api/extract  │  │ /api/extract  │  ...
│  (Quotation 1)│  │  (Quotation 2)│  │  (Quotation 3)│ (5 concurrent)
└───────┬──────┘  └───────┬──────┘  └───────┬──────┘
        │                 │                 │
        │  5-Stage Pipeline: Extract → Vendor Specs → Matching → Draft → Validate
        │  • Stage 1: Text extraction from PDF/image
        │  • Stage 2: Groq - vendor spec extraction (measurements with units)
        │  • Stage 3&4: Groq - requirement matching (unit-aware comparison)
        │  • Stage 5: Gemini - final validation (precision validation, JSON response)
        │
        └──────────────────┬──────────────────┘
                           │
        ┌──────────────────▼──────────────────┐
        │     RTDB: Lightweight JSON           │
        │  /quotations/{uid}/{sessionId}/      │
        │    {quoteId} = {vendorName, status,  │
        │       parsedData, finalJsonReport,   │
        │       precisionValidation, ...}      │
        └──────────────────┬──────────────────┘
                           │
                    ┌──────▼────────┐
                    │  REDUCE PHASE │
                    └──────┬────────┘
                           │
                    ┌──────▼──────────────┐
                    │ /api/adjudicate     │
                    │ (Single API call)   │
                    └──────┬──────────────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
        FETCH         BUILD SUMMARY    GEMINI
        All JSON      (strip verbose   Final
        from RTDB     fields)          Analysis
           │               │               │
           └───────────────┼───────────────┘
                           │
        ┌──────────────────▼──────────────────┐
        │       ADJUDICATION RESULTS          │
        │  • Vendor ranking (1st, 2nd, 3rd)  │
        │  • Overall scoring breakdown       │
        │  • Best vendor recommendation      │
        │  • Cost analysis                   │
        │  • Compliance analysis             │
        │  • Precision analysis              │
        │  • Delivery timeline comparison    │
        └──────────────────┬──────────────────┘
                           │
        ┌──────────────────▼──────────────────┐
        │  Save to RTDB /sessions/{uid}/      │
        │    {sessionId}/adjudicationResult   │
        │  Status: "closed"                  │
        └──────────────────┬──────────────────┘
                           │
        ┌──────────────────▼──────────────────┐
        │   Report Page displays results     │
        │   • Adjudication section           │
        │   • Vendor ranking                 │
        │   • Comparative analysis           │
        │   • Executive summary              │
        └───────────────────────────────────┘
```

## Phases

### Phase 1: MAP - Individual Quotation Processing

**Endpoint**: `POST /api/extract`

**Role**: Called by frontend for each uploaded quotation

**Input**:
- `userId`: User identification
- `sessionId`: Session context
- `quoteId`: Individual quotation ID
- `fileUrl`: Base64 encoded file
- `baseRequirementsText`: Requirements for comparison

**Process** (5 Stages):
1. **Extract**: PDF/image → raw text
2. **Vendor Spec Extraction** (Groq): Extract line items, measurements with units, certifications
3. **Requirement Matching** (Groq): Compare specs with base requirements, unit-aware comparisons, precision validation
4. **Draft JSON** (Groq): Produce initial compliance report
5. **Final Validation** (Gemini): Validate measurements, enforce JSON response, set `precisionValidation` flag

**Output**: Store to RTDB as JSON
```
/quotations/{uid}/{sessionId}/{quoteId}
{
  vendorName: string,
  status: "analyzed",
  parsedData: { totalCost, complianceScore, ... },
  finalJsonReport: { ... },
  precisionValidation: "PASS|FAIL|UNKNOWN",
  unitMismatches: [ ... ],
  measurementPrecisionErrors: [ ... ]
}
```

**Why MAP Phase Avoids Timeouts**:
- Each quotation is processed independently
- API calls run in parallel (5 concurrent max)
- Each call is 30-60 seconds, not 30 × 60 = 1800 seconds
- No AI context degradation (Groq and Gemini see one quotation at a time)

### Phase 2: REDUCE - Comparative Analysis

**Endpoint**: `POST /api/adjudicate`

**Role**: Called once when user clicks "CLOSE SESSION"

**Input**:
- `userId`: User identification
- `sessionId`: Session to adjudicate
- `baseRequirementsText`: Requirements context

**Process**:
1. **Fetch**: Read ALL processed quotations from RTDB (lightweight JSON only, no raw files)
2. **Build Summary**: Extract key fields (vendor name, scores, recommendations, measurements)
3. **Single Gemini Call**: Feed lightweight summary to Gemini for final analysis
4. **Rank Vendors**: Generate scoring across 4 dimensions (compliance, cost, precision, delivery)
5. **Generate Recommendations**: Best vendor, ranking tiers, rationale

**Output**: Store to RTDB
```
/sessions/{uid}/{sessionId}
{
  status: "closed",
  adjudicationResult: {
    ranking: [ { rank, vendorName, overallScore, scoringBreakdown, recommendation, ... } ],
    bestVendor: { vendorName, overallScore, rationale },
    costAnalysis: { lowestCost, averageCost, highestCost },
    complianceAnalysis: { fullCompliance, partialCompliance, nonCompliant },
    precisionAnalysis: { precisionPass, precisionFail, precisionUnknown },
    deliveryAnalysis: { bestDelivery, worstDelivery, averageDeliveryDays },
    adjudicationNotes: string
  },
  adjudicatedAt: timestamp
}
```

**Why REDUCE Phase Handles 30+ Vendors**:
- Single API call to Gemini (fast, no timeout risk)
- Input is lightweight JSON summaries, not raw PDFs (small context window)
- Gemini can easily compare 30+ vendors in analysis framework
- All computation done server-side, no network I/O

## Frontend Implementation

### Upload Phase (Map Trigger)

```typescript
// File: app/session/[id]/page.tsx

// Batch uploads: 5 concurrent max
const maxConcurrent = 5;
for (let i = 0; i < files.length; i += maxConcurrent) {
  const batch = files.slice(i, i + maxConcurrent);
  const batchPromises = batch.map(file => processQuotationFile(file));
  await Promise.all(batchPromises);
  await new Promise(resolve => setTimeout(resolve, 1000)); // Stagger batches
}

// Per-file tracking
const [uploadProgress, setUploadProgress] = useState<Record<string, { status: string; progress: number }>>();

// Each file shows: "converting" (20%) → "uploading" (60%) → "complete" (100%)
```

### Close Session Phase (Reduce Trigger)

```typescript
// File: app/session/[id]/page.tsx

const handleCloseSession = async () => {
  const response = await fetch("/api/adjudicate", {
    method: "POST",
    body: JSON.stringify({
      userId: user.uid,
      sessionId,
      baseRequirementsText: session.baseRequirements.extractedText
    })
  });
  
  // Results saved to RTDB, redirect to report
  router.push(`/session/${sessionId}/report`);
};
```

## Scaling Characteristics

### For 30 Quotations

| Phase | Time | Bottleneck | Risk |
|-------|------|-----------|------|
| MAP (Extract) | ~300-600 seconds (parallel, 5 at a time) | Network I/O + AI processing | Vercel timeout (900s) ✗ MITIGATED |
| Data Storage (RTDB) | Negligible | None | None ✓ |
| REDUCE (Adjudicate) | ~10-20 seconds | Single Gemini API call | Vercel timeout ✓ SAFE |
| **Total** | **~320 seconds** | Parallel extraction | ✓ SAFE |

### For 100+ Quotations

To scale further:
1. Increase `maxConcurrent` from 5 to 10 (watch API rate limits)
2. Split adjudication across multiple API calls (e.g., rank top 20 first, then analyze all)
3. Implement caching for repeated measurements
4. Use Groq for adjudication instead of Gemini (no quota limit)

## Error Handling

### Map Phase Failures
- Individual extraction failures don't block other quotations
- Status set to "error" and user can retry single file
- Error message stored in RTDB for troubleshooting

### Reduce Phase Failures
- User can retry closing session
- All extract results remain in RTDB (can re-adjudicate)
- Partial adjudication not saved

## Data Flow Example: 3 Quotations

```
User Timeline:
┌──────────────────────────────────────────────────┐
│ T=0: Upload 3 quotations (A, B, C)               │
└─────┬─────────────────────────────────────────────┘
      │
      ├─→ API 1: Extract A (T=0-60s) ──→ RTDB: Q_A = {parsedData, status: "analyzed"}
      ├─→ API 2: Extract B (T=0-60s) ──→ RTDB: Q_B = {parsedData, status: "analyzed"}
      ├─→ API 3: Extract C (T=0-60s) ──→ RTDB: Q_C = {parsedData, status: "analyzed"}
      │
      ├─ (Parallel, all complete by ~T=60s)
      │
┌─────▼─────────────────────────────────────────────┐
│ T=65: User clicks "CLOSE SESSION"                │
└─────┬─────────────────────────────────────────────┘
      │
      ├─→ API 4: Adjudicate
      │   Fetch: {Q_A, Q_B, Q_C} from RTDB
      │   Gemini: Compare all 3, rank them
      │   Save: session.adjudicationResult = {...}
      │   (T=75-85s)
      │
┌─────▼─────────────────────────────────────────────┐
│ T=90: Report page shows:                         │
│   • Ranking: Q_A (1st), Q_B (2nd), Q_C (3rd)    │
│   • Best vendor: Q_A ($X, 95% compliance)      │
│   • Cost analysis, precision analysis, etc.     │
└────────────────────────────────────────────────┘
```

## RTDB Schema

```
/sessions/{uid}/{sessionId}
├── title: string
├── status: "open" | "closed"
├── createdAt: timestamp
├── baseRequirements: { fileUrl, extractedText, ... }
├── adjudicationResult: { ranking, bestVendor, ... }  ← REDUCE output
└── adjudicatedAt: timestamp

/quotations/{uid}/{sessionId}/{quoteId}
├── vendorName: string
├── status: "processing" | "analyzed" | "error"
├── fileUrl: string (base64)
├── parsedData: { totalCost, complianceScore, ... }
├── finalJsonReport: { ... }  ← MAP output
├── precisionValidation: "PASS" | "FAIL" | "UNKNOWN"
├── unitMismatches: [ ... ]
├── measurementPrecisionErrors: [ ... ]
└── uploadedAt: timestamp
```

## Benefits of Map-Reduce

1. **No Timeouts**: Parallel processing + single final call
2. **No Context Degradation**: Each quotation processed independently
3. **Efficient**: RTDB stores results for quick final analysis
4. **Scalable**: Can handle 30+, 100+, 1000+ quotations
5. **Resilient**: Individual failures don't block entire session
6. **Cost-Effective**: One Gemini call replaces N individual calls

## Future Enhancements

1. **Streaming Results**: Show vendor rankings as extraction completes
2. **Caching**: Store extraction results across sessions
3. **Batching API Calls**: Group 5-10 quotations per API call
4. **Progressive Adjudication**: Rank top 10 as they complete, final ranking when all done
5. **Webhooks**: Notify user of completion instead of poll
