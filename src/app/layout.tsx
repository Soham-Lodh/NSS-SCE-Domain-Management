import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/components/providers/query-provider";

/**
 * Bricolage Grotesque is the site typeface; Inter stays in the stack as a
 * wide-coverage fallback so no glyph falls back to the system UI font.
 */
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
  axes: ["opsz", "wdth"],
});

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

export const metadata: Metadata = {
  title: "NSS SCE KIIT — Domain Management",
  description: "Secure volunteer, event and assignment management for NSS SCE KIIT.",
  // The approved circular NSS emblem (transparent PNG, JPEG fallback).
  icons: {
    icon: [
      { url: "/nss-logo.png", type: "image/png" },
    ],
  },
  // Application data is private; never index or embed private data in metadata.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${inter.variable}`}>
      <body className="min-h-full font-sans antialiased">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
