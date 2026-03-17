# QuoteAnalyzer - Production-Grade Technical Quotation Sorter

A strict, zero-hallucination technical quotation analysis and adjudication system for procurement officers. Built with Next.js, Firebase RTDB, Groq, and Gemini AI.

## 🚀 Features

### Core Architecture
- **5-Stage Hybrid AI Pipeline**: Text extraction → Vendor specs → Requirement matching → Draft JSON → Final validation
- **Quota-Aware Design**: Optimized for Gemini (20/day) and Groq (high volume) API limits
- **JSON-Based Storage**: All quotations and files stored in Firebase RTDB (no Firebase Storage dependency)
- **Real-time Processing**: Live status updates using Firebase listeners

### User Workflows
1. **Authentication**: Email/Password auth via Firebase v9
2. **Session Management**: Create procurement sessions, organize quotations
3. **File Handling**: Drag-and-drop support for PDFs, images, text files
4. **AI Analysis**: Automatic extraction and compliance analysis
5. **Compliance Report**: Rich comparison matrix with Neo-Brutalist UI

### Neo-Brutalist UI
- Off-white cream background (`#FFFDD0`)
- Extreme typography: Uppercase, bold, tracking-tight
- Thick black borders (`border-4 border-black`) on all elements
- Hard shadows with offset positioning
- High-contrast, deliberately harsh aesthetics

## 📁 Project Structure

```
qtsr-app/
├── app/
│   ├── page.tsx                    # Root redirect page
│   ├── layout.tsx                  # Root layout
│   ├── globals.css                 # Tailwind imports
│   ├── login/
│   │   └── page.tsx               # Email/Password auth
│   ├── dashboard/
│   │   └── page.tsx               # Session grid & creation
│   ├── session/
│   │   ├── [id]/
│   │   │   ├── page.tsx           # Workspace with drag-and-drop
│   │   │   └── report/
│   │   │       └── page.tsx       # Compliance report & matrix
│   └── api/
│       └── extract/
│           └── route.ts            # 5-stage extraction pipeline
├── lib/
│   ├── firebase.ts                # Firebase v9 setup
│   └── types.ts                   # TypeScript interfaces
├── .env.local                      # API keys (not in repo)
├── tailwind.config.ts             # Tailwind theme
├── next.config.ts
├── tsconfig.json
└── package.json
```

## 🔧 Setup & Installation

### Prerequisites
- Node.js 18+
- npm/yarn

### Environment Variables
Create `.env.local` with your credentials:

```env
# Firebase Configuration (public)
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_DATABASE_URL=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...

# AI API Keys (server-only)
GROQ_API_KEY=...
GEMINI_API_KEY=...
```

### Installation
```bash
npm install

# Development server
npm run dev

# Production build
npm run build
npm run start
```

Access at `http://localhost:3000`

## 📊 Firebase RTDB Schema

```json
{
  "users": {
    "$uid": {
      "email": "string",
      "createdAt": "timestamp"
    }
  },
  "sessions": {
    "$sessionId": {
      "userId": "$uid",
      "title": "string",
      "status": "open | closed",
      "createdAt": "timestamp",
      "baseRequirements": {
        "fileUrl": "base64 encoded file",
        "extractedText": "string",
        "uploadedAt": "timestamp",
        "fileName": "string"
      }
    }
  },
  "quotations": {
    "$sessionId": {
      "$quoteId": {
        "vendorName": "string",
        "fileUrl": "base64 encoded file",
        "status": "processing | analyzed | error",
        "uploadedAt": "timestamp",
        "parsedData": {
          "totalCost": "number",
          "complianceScore": "number",
          "missingSpecs": ["array"],
          "lineItems": ["array"],
          "allSpecs": ["array"],
          "certifications": ["array"],
          "deliveryTime": "string"
        },
        "finalJsonReport": { ... },
        "errorMessage": "string (optional)"
      }
    }
  }
}
```

## 🤖 5-Stage AI Pipeline

### Stage 1: Text Extraction
- Uses `pdf-parse` to convert PDF to raw text
- Handles images via base64 encoding
- Returns cleaned, extracted text

### Stage 2: Vendor Spec Extraction (Groq)
- Model: `llama-3.3-70b-versatile`
- Extracts: Line items, specifications, pricing, certifications
- Output: Structured JSON with parsed data

### Stage 3 & 4: Requirement Matching (Groq)
- Compares vendor specs against base requirements
- Identifies: Matched, missing, and uncertain specs
- Output: Draft compliance report (JSON)

### Stage 5: Final Validation (Gemini)
- Model: `gemini-2.5-flash`
- Validates Groq's draft with strict compliance scoring
- Enforces `responseMimeType: "application/json"`
- Output: Final, trusted JSON report

## 📋 Compliance Report Features

- **Comparison Matrix**: Vendor vs. base requirements side-by-side
- **Compliance Score**: 0-100% rating per vendor
- **Color Coding**: Green (matched), Red (missing), Yellow (uncertain)
- **Detailed Analysis**: Per-vendor breakdown with critical issues
- **Recommendation System**: APPROVED | CONDITIONAL | REJECTED
- **Critical Disclaimer**: Mandatory human verification notice

## ⚠️ Critical Notes

1. **No Hallucination Guarantee**: AI analysis is rigorous but can contain errors
2. **Human Verification Required**: MANDATORY procurement officer review before contract execution
3. **Quota Limits**: Design accounts for Gemini 20 requests/day
4. **Error Handling**: Comprehensive try-catch at all pipeline stages
5. **Audit Trail**: All actions logged to Firebase RTDB with timestamps

## 🔐 Security

- Firebase v9 Modular SDK (no secrets exposed)
- API keys in `.env.local` only (server-side)
- Email/Password authentication with Firebase Auth
- RTDB security rules should be configured in Firebase Console

## 📝 License

Internal use only. Proprietary procurement system.

---

**Built with**: Next.js 15, Firebase v9, Groq SDK, Google Gen AI SDK, Tailwind CSS, TypeScript
