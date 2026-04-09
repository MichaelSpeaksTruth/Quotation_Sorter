/**
 * QuoteAnalyzer Type Definitions
 * Strict TypeScript interfaces for production-grade quotation analysis
 */

export interface User {
  uid: string;
  email: string;
  createdAt: number;
}

export interface SecuritySettings {
  userId: string;
  lastPasswordChange: number;
  lastPasswordChangeIP?: string;
  lastPasswordChangeDevice?: string;
  backupCodes?: string[];
}

export interface BaseRequirements {
  fileUrl: string;
  extractedText: string;
  uploadedAt: number;
  fileName: string;
}

export interface Session {
  id: string;
  userId: string;
  title: string;
  status: "open" | "closed";
  createdAt: number;
  baseRequirements: BaseRequirements | null;
  adjudicationResult?: Record<string, any> | null;
  adjudicatedAt?: number;
}

export interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface ParsedQuotationData {
  totalCost: number;
  complianceScore: number;
  missingSpecs: string[];
  lineItems: LineItem[];
  allSpecs: string[];
  certifications: string[];
  deliveryTime: string;
}

export interface Quotation {
  id: string;
  sessionId: string;
  vendorName: string;
  fileUrl: string;
  status: "processing" | "analyzed" | "error" | "canceled";
  uploadedAt: number;
  parsedData: ParsedQuotationData | null;
  finalJsonReport: Record<string, any> | null;
  errorMessage?: string;
  canceledAt?: number;
  canceledReason?: string;
}

export interface ComplianceReport {
  vendorName: string;
  totalCost: number;
  complianceScore: number;
  matchedSpecs: string[];
  missingSpecs: string[];
  uncertainSpecs: string[];
  certifications: string[];
  deliveryTime: string;
  overallRecommendation: "APPROVED" | "CONDITIONAL" | "REJECTED";
  notes: string;
}

export interface ExtractionRequest {
  userId: string;
  sessionId: string;
  quoteId: string;
  fileUrl: string;
  baseRequirementsText: string;
  targetCurrency: string;
}

export interface ExtractionResponse {
  success: boolean;
  data?: ParsedQuotationData;
  finalReport?: Record<string, any>;
  error?: string;
}
