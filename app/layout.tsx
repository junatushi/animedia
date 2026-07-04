import "./globals.css";
import type { Metadata, Viewport } from "next";

const title = "アニメ視聴ガイド";
const description = "シーズンごとのアニメを、観られる国内配信サービス別に一覧。配信情報は Annict からリアルタイム取得。";

export const metadata: Metadata = {
  title: { default: title, template: `%s | ${title}` },
  description,
  applicationName: title,
  keywords: ["アニメ", "配信", "見逃し", "サブスク", "dアニメ", "ABEMA", "Netflix", "U-NEXT", "シーズン"],
  openGraph: {
    title,
    description,
    type: "website",
    locale: "ja_JP",
    siteName: title,
  },
  twitter: {
    card: "summary",
    title,
    description,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#050b14",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
