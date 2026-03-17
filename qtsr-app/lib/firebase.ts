/**
 * Firebase v9 Modular SDK Configuration
 * Production-grade setup for QuoteAnalyzer
 */

import { initializeApp } from "firebase/app";
import {
  getAuth,
  Auth,
} from "firebase/auth";
import {
  getDatabase,
  Database,
} from "firebase/database";

// Firebase configuration from console
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Auth
export const auth: Auth = getAuth(app);

// Initialize Realtime Database
export const rtdb: Database = getDatabase(app);

export default app;

/**
 * RTDB Schema (Hierarchical by User UID):
 * /sessions/{uid}/{sessionId} = {title, status, createdAt, baseRequirements}
 * /quotations/{uid}/{sessionId}/{quoteId} = {vendorName, fileUrl, status, parsedData...}
 * /users/{uid} = {email, createdAt}
 */
