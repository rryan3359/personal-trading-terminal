import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trading Terminal",
  description: "個人自用看盤終端 — Binance 加密貨幣即時 K 線",
};

// viewport-fit=cover: the layout viewport extends under the home
// indicator / notch, so env(safe-area-inset-*) reports real insets
// (34px bottom on Face ID iPhones) instead of 0. Without it the
// bottom bar's safe-area padding collapses to 8px and h-dvh can
// exceed the safe viewport, leaving the page scrollable and the
// capsules half under the home indicator (Ryan's real-iPhone report
// 2026-11-26). No userScalable/maximumScale change: pinch-zoom stays.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-[#0b0e11] text-[#d1d4dc] antialiased">
        {children}
      </body>
    </html>
  );
}
