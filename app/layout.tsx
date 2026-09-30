import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AuthGate from "@/components/AuthGate";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// アイコンは app/icon.svg・app/favicon.ico・app/apple-icon.png を Next.js が自動で読み込む
// （作り直すときは node scripts/generate-icons.mjs）
export const metadata: Metadata = {
  title: "デジタル経費記録",
  description: "領収書を撮影して、あなたのGoogleドライブに経費の記録を残すアプリ",
  applicationName: "デジタル経費記録",
  appleWebApp: { capable: true, title: "経費記録", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#4338CA",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
