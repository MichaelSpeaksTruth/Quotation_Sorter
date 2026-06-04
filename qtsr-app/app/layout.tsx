import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppFrameWrapper from "@/app/components/AppFrameWrapper";

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
      <body className="font-sans antialiased text-zinc-900 dark:text-zinc-50 bg-zinc-50 dark:bg-zinc-950">
        <AppFrameWrapper>{children}</AppFrameWrapper>
      </body>
    </html>
  );
}

