import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trading Terminal",
  description: "個人自用看盤終端 — Binance 加密貨幣即時 K 線",
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
