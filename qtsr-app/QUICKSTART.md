# QuoteAnalyzer - Quick Start Guide

## 🚀 60-Second Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Set Environment Variables
Create `.env.local` in the project root:
```env
# Firebase (from your Firebase Console)
NEXT_PUBLIC_FIREBASE_API_KEY=your_firebase_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=quotation-sorter-app.firebaseapp.com
NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://quotation-sorter-app-default-rtdb.asia-southeast1.firebasedatabase.app
NEXT_PUBLIC_FIREBASE_PROJECT_ID=quotation-sorter-app
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=quotation-sorter-app.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id

# AI APIs (KEEP SECRET - server-side only)
GROQ_API_KEY=your_groq_api_key
GEMINI_API_KEY=your_gemini_api_key
```

### 3. Start Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## 📝 First Time User Walkthrough

### Step 1: Sign Up
- Click **SIGN UP** tab
- Enter any email and password
- Click **CREATE ACCOUNT**
- → Redirects to Dashboard

### Step 2: Create a Session
- Enter session name: `"Server Procurement RFQ"`
- Click **CREATE**
- → Opens Session Workspace

### Step 3: Upload Base Requirements
- Prepare a TXT, PDF, or JSON file with your requirements
- Example requirements:
  ```
  - Intel Xeon processor, minimum 20 cores
  - 256 GB RAM minimum
  - 10TB RAID-6 storage
  - 5-year warranty
  - Delivery within 30 days
  - ISO 9001 certified
  ```
- Drag and drop into **BASE REQUIREMENTS** panel (left)
- → File uploaded and text extracted

### Step 4: Upload Vendor Quotations
- Prepare 2-3 vendor quote PDFs or text files
- Drag and drop into **VENDOR QUOTATIONS** panel (center)
- → Each file shows in Processing Queue
- **Wait 30-60 seconds** for AI analysis to complete
- Status changes from `PROCESSING` → `ANALYZED`

### Step 5: View Compliance Report
- Click **VIEW REPORT** button
- See comparison matrix of all vendors
- **GREEN cells** = Requirements met
- **RED cells** = Requirements missing
- **YELLOW cells** = Uncertain or needs review
- Compliance percentage per vendor
- Click through detailed analysis for each vendor

---

## 🎨 UI Overview

### Neo-Brutalist Design Elements
- **Cream background**: `#FFFDD0`
- **Pure black text**: `text-black`
- **UPPERCASE headers**: All caps, bold, tight tracking
- **Thick borders**: 4-8px solid black on every element
- **Hard shadows**: Offset block shadows, never soft blurs
- **No rounded corners**: All boxes have sharp corners
- **High contrast buttons**: Black with white text, click = translate-down effect

### Navigation Flow
```
Login/Signup → Dashboard (Sessions) → Workspace (Upload) → Report (Analysis)
```

---

## 🤖 How AI Works

### Your Quotation Flow
1. **You upload PDF** → API receives file
2. **Stage 1**: Extracts raw text from PDF
3. **Stage 2 (Groq)**: Parses specs, line items, pricing
4. **Stage 3 (Groq)**: Matches against your requirements
5. **Stage 4**: Draft report created
6. **Stage 5 (Gemini)**: Final validation & scoring
7. **Report saved** → You see compliance percentage

**Total time**: 30-60 seconds per quotation

---

## 📊 Report Metrics

### Compliance Score (0-100%)
- **90-100%**: APPROVED ✓ (Green)
- **70-89%**: CONDITIONAL ⚠ (Yellow)
- **Below 70%**: REJECTED ✗ (Red)

### Data Extracted
- ✓ Matched requirements
- ✗ Missing requirements
- ⚠ Uncertain requirements
- Total cost
- Delivery timeline
- Certifications

---

## ⚠️ Critical Warnings

1. **This is AI-Generated Analysis**
   - ALWAYS verify with human procurement officer
   - AI can misinterpret or miss details
   - Use as DECISION SUPPORT only

2. **No Contract Without Review**
   - Legal and technical teams must verify
   - Human signature required before signing anything

3. **File Size Limits**
   - Max 10MB per file
   - For very large documents, split across multiple uploads

---

## 🔧 Troubleshooting

### "Loading..." stuck or API errors
- Check internet connection
- Verify Firebase credentials in `.env.local`
- Check that `GROQ_API_KEY` and `GEMINI_API_KEY` are correct

### Quotation shows "ERROR" status
- File format not supported (only PDF, JPG, PNG, TXT)
- Network timeout (API servers unreachable)
- File corrupted or empty
- Try uploading again or use different file format

### Base Requirements won't upload
- File must be PDF, TXT, JSON, or image
- Max 10MB size
- Drag to correct panel (left side, not center)

### Report shows no vendors
- Upload at least one vendor quotation after base requirements
- Wait for status to change from PROCESSING to ANALYZED
- Check Firebase RTDB didn't fail (check browser console)

---

## 💾 Your Data

### What's Stored
- Sessions: Name, status, date created
- Base Requirements: Text only (no full file stored, just text extraction)
- Quotations: File content as base64 + AI analysis (JSON)

### Where It's Stored
- Firebase Realtime Database (RTDB)
- Associated with your user email

### How to Delete
- Currently: No delete button in UI
- To delete session: Request Firebase console admin
- Data persists in RTDB until manually cleaned

---

## 🚀 Best Practices

### For Accurate Analysis
1. **Upload comprehensive requirements**
   - Be specific about specs
   - Include all must-have features
   - Add certifications and compliance needs

2. **Use clear vendor quotes**
   - Vendor PDF must include line items and specs
   - Clear pricing and delivery info
   - Avoid scanned images if possible (text-based PDFs better)

3. **Review AI output carefully**
   - Re-read matched/missing specs
   - Verify totals and math
   - Check delivery dates

### For Multiple Quotations
- Upload all 3-5 quotes at once
- Let AI process them in parallel
- Compare in one report after all complete

---

## 📞 Support

For issues, check:
1. `.env.local` has all required keys
2. Firebase project/RTDB actually exists and is accessible
3. Groq and Gemini API keys are active and have quota remaining
4. Browser console for error messages (F12)

---

**Ready to analyze quotes? Start at** → [http://localhost:3000](http://localhost:3000)
