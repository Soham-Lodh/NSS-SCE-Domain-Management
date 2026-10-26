import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/components/providers/query-provider";
import { serverEnv } from "@/lib/env";

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

const appUrl = serverEnv().APP_URL;

export const metadata: Metadata = {
  // Canonical origin so social previews / linking resolve against the real host.
  metadataBase: new URL(appUrl),
  applicationName: "NSS SCE KIIT Domain Management",
  title: {
    default: "NSS SCE KIIT — Domain Management",
    template: "%s | NSS SCE KIIT",
  },
  description: "Secure volunteer, event and assignment management for NSS SCE KIIT.",
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    siteName: "NSS SCE KIIT",
    title: "NSS SCE KIIT — Domain Management",
    description: "Secure volunteer, event and assignment management for NSS SCE KIIT.",
    url: appUrl,
  },
  twitter: {
    card: "summary",
    title: "NSS SCE KIIT — Domain Management",
    description: "Secure volunteer, event and assignment management for NSS SCE KIIT.",
  },
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
