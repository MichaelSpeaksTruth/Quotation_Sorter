# Firebase RTDB Rules Deployment Guide

## ⚠️ CRITICAL: The cancel button won't work until you deploy these rules!

### Steps to Deploy Rules:

1. **Open Firebase Console**
   - Go to https://console.firebase.google.com
   - Select your project: `quotation-sorter-app`

2. **Navigate to Realtime Database Rules**
   - Click **Realtime Database** from the left menu
   - Click the **Rules** tab (next to Data)

3. **Copy and Paste Updated Rules**
   - Open this file in your editor: `/firebase-rtdb-rules.json`
   - Copy ALL the content
   - Paste it into the Firebase Console Rules editor (replace everything)

4. **Publish Rules**
   - Click the **Publish** button (top right)
   - Wait for confirmation: "Rules published successfully"

### What Changed:

- ✅ Added `"canceled"` status value to allowed statuses
- ✅ Added `updatedAt` field for tracking updates
- ✅ Added `errorAt` field for error timestamps  
- ✅ Added `canceledAt` field for cancellation timestamps
- ✅ Added `canceledReason` field for cancellation reasons

### Verification: After Publishing Rules

1. Click the cancel (**✕**) button on a quotation
2. Check your browser console (F12) for logs starting with `✅ [CANCEL REQUEST]`
3. Check your terminal (where `npm run dev` is running) for logs starting with `✅ [API/CANCEL]`
4. If successful, quotation should change to **"canceled"** status

### If You Still Get Permission Denied (401):

1. Check that the user ID in the database path matches `auth.uid` in the rules
2. Verify you're logged in with a valid Firebase account
3. Check your auth token isn't expired
4. Screenshot the error and share the exact response from RTDB

### Rules File Location:

`/firebase-rtdb-rules.json` in your project root
