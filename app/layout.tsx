import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import PostHogProvider from "@/components/PostHogProvider";
import { CreditsProvider } from "@/components/CreditsProvider";

export const metadata: Metadata = {
  title: "BOQ Generator — AI-powered Bill of Quantities",
  description:
    "Upload a Scope of Work PDF and get a tender-ready Bill of Quantities in seconds.",
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className={`${GeistSans.variable} font-sans antialiased bg-[#0f0f0f] text-white`}>
        <PostHogProvider>
          <CreditsProvider>{children}</CreditsProvider>
        </PostHogProvider>
      </body>
    </html>
  );
}
