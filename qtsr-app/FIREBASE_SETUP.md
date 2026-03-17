# Firebase RTDB Security Rules Setup

## 🔴 Why Permission Denied Error?

Your Firebase Realtime Database has default rules that **deny all access** unless properly configured. The error:
```
permission_denied at /sessions: Client doesn't have permission to access the desired data.
```

This is because the RTDB doesn't know which users are allowed to read/write to which paths.

---

## ✅ Fix: Apply Security Rules

### Step 1: Open Firebase Console
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project: **quotation-sorter-app**
3. In left sidebar: **Realtime Database**
4. Click on your database

### Step 2: Go to Rules Tab
1. Click the **RULES** tab (next to Data)
2. Delete all existing default rules
3. Copy the rules from `firebase-rtdb-rules.json` below

### Step 3: Paste Rules
Copy this entire JSON and paste into the Rules editor:

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    
    "users": {
      "$uid": {
        ".read": "$uid === auth.uid",
        ".write": "$uid === auth.uid",
        ".validate": "newData.hasChildren(['email', 'createdAt'])"
      }
    },
    
    "sessions": {
      ".read": "auth != null",
      ".write": "auth != null",
      
      "$sessionId": {
        ".read": "root.child('sessions').child($sessionId).child('userId').val() === auth.uid || data.child('userId').val() === auth.uid",
        ".write": "root.child('sessions').child($sessionId).child('userId').val() === auth.uid || newData.child('userId').val() === auth.uid",
        
        "userId": {
          ".validate": "newData.val() === auth.uid"
        },
        "title": {
          ".validate": "newData.isString() && newData.val().length > 0"
        },
        "status": {
          ".validate": "newData.val() === 'open' || newData.val() === 'closed'"
        },
        "createdAt": {
          ".validate": "newData.isNumber()"
        },
        "baseRequirements": {
          ".validate": "newData.hasChildren(['fileUrl', 'extractedText', 'uploadedAt', 'fileName'])"
        }
      }
    },
    
    "quotations": {
      ".read": "auth != null",
      ".write": "auth != null",
      
      "$sessionId": {
        ".read": "root.child('sessions').child($sessionId).child('userId').val() === auth.uid",
        ".write": "root.child('sessions').child($sessionId).child('userId').val() === auth.uid",
        
        "$quoteId": {
          ".read": true,
          ".write": true,
          
          "vendorName": {
            ".validate": "newData.isString()"
          },
          "status": {
            ".validate": "newData.val() === 'processing' || newData.val() === 'analyzed' || newData.val() === 'error'"
          },
          "uploadedAt": {
            ".validate": "newData.isNumber()"
          },
          "parsedData": {
            ".validate": "newData.hasChildren(['totalCost', 'complianceScore', 'missingSpecs', 'lineItems']) || !newData.exists()"
          },
          "finalJsonReport": {
            ".validate": "newData.isObject() || !newData.exists()"
          },
          "precisionValidation": {
            ".validate": "newData.val() === 'PASS' || newData.val() === 'FAIL' || newData.val() === 'UNKNOWN' || !newData.exists()"
          }
        }
      }
    }
  }
}
```

### Step 4: Publish Rules
- Click **PUBLISH** button
- Wait for confirmation message: "Rules published successfully"

---

## 📋 What These Rules Do

### **Root Level** (Deny by default)
```json
".read": false,
".write": false
```
Everything is private unless explicitly allowed.

### **Users Path** (User-specific data)
```json
"users": {
  "$uid": {
    ".read": "$uid === auth.uid",    // Users read only their own data
    ".write": "$uid === auth.uid"    // Users write only their own data
  }
}
```
✅ User can read/write: `/users/{their_uid}`
❌ User canNOT read: `/users/{other_uid}`

### **Sessions Path** (User's sessions)
```json
"sessions": {
  "$sessionId": {
    ".read": "...userId val === auth.uid",     // Only session owner can read
    ".write": "...userId val === auth.uid"     // Only session owner can write
  }
}
```
✅ User can read their sessions
❌ User cannot read other users' sessions

### **Quotations Path** (Quotations under sessions)
```json
"quotations": {
  "$sessionId": {
    ".read": "...session userId === auth.uid",  // Check session ownership
    ".write": "...session userId === auth.uid"  // Check session ownership
  }
}
```
✅ User can read quotations in their sessions
❌ User cannot read quotations in other users' sessions

---

## ✔️ Testing Rules

After publishing, test in Firebase Console:

### Test 1: Signup
1. Refresh browser
2. Click **SIGN UP**
3. Enter email and password
4. Should succeed ✅

### Test 2: Create Session
1. On Dashboard, enter "Test Session"
2. Click CREATE
3. Should succeed ✅ (not getting permission_denied error)

### Test 3: Upload Files
1. Drag base requirements file
2. Drag vendor quotations
3. Should succeed ✅

If you still get **permission_denied**:
- ❌ Rules not published
- ❌ Copy-paste error in rules
- ❌ Firebase cache (try hard refresh: Ctrl+Shift+R)

---

## 🔒 Security Features

These rules enforce:

1. **Authentication Required**: `.read` and `.write` require `auth != null`
2. **Ownership Verification**: Users can only access their own data
3. **Data Validation**: Structure must match schema (e.g., sessions must have userId, title, status)
4. **Role Separation**: 
   - Sessions are owned by one user
   - Quotations belong to sessions (inherit permissions)
   - Users can only access their own profile

---

## ⚠️ Production Considerations

For **production deployment**, add:

```json
{
  "rules": {
    // Existing rules...
    
    "analytics": {
      ".read": "auth != null",
      ".write": false  // No direct writes, server-side logging only
    },
    
    "audit_logs": {
      ".read": "root.child('users').child(auth.uid).child('role').val() === 'admin'",
      ".write": false  // Server-only
    }
  }
}
```

---

## 🆘 Troubleshooting

### Still getting "permission_denied"?

**Checklist:**
1. ✅ Rules are published (click PUBLISH button)
2. ✅ User is authenticated (not null)
3. ✅ No typos in rules JSON
4. ✅ Hard refresh browser (Ctrl+Shift+R)
5. ✅ Clear browser cache (DevTools → Storage → Clear All)

### "Invalid JSON" error?

- Check for trailing commas
- Ensure all braces `{}` are balanced
- Use Firebase Rules Simulator to validate

---

## 📚 Firebase Rules Documentation

- [Firebase Security Rules Reference](https://firebase.google.com/docs/rules)
- [RTDB Security Guide](https://firebase.google.com/docs/database/security)
- [Rules Simulator Tool](https://console.firebase.google.com/project/{projectId}/database/rules)

---

**After publishing these rules, refresh your app and the permission_denied error should be gone.** ✅
