import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { RegisterSw } from "@/components/pwa/register-sw";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Life OS",
  description: "A personal productivity dashboard for Deen, Business, Fitness, School, and Work.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Life OS",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0c",
  width: "device-width",
  initialScale: 1,
  // Floors pinch-zoom-out at the default view (Ayman: "you can only zoom
  // out to default view"). Deliberately no maximumScale below a generous
  // ceiling and no userScalable: false — he explicitly wants pinch-zoom-in
  // kept ("you can keep zooming in and out"), and blocking it outright
  // would also be a WCAG 1.4.4 failure. See mobile-island.tsx's
  // usePinToVisualViewport for the bottom nav's own position/size lock,
  // which minimumScale alone doesn't provide (position: fixed tracks the
  // layout viewport, not the visual one).
  minimumScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <RegisterSw />
      </body>
    </html>
  );
}
