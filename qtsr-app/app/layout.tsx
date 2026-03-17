import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QuoteAnalyzer - Strict Technical Quotation Sorter",
  description: "Production-grade technical quotation analysis and adjudication system",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-mono">
        {children}
      </body>
    </html>
  );
}
