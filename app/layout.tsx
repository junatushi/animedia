import "./globals.css";
import type { Metadata, Viewport } from "next";

const title = "アニメ視聴ガイド";
const description = "シーズンごとのアニメを、観られる国内配信サービス別に一覧。配信情報は Annict からリアルタイム取得。";

// SNSカードの og:image / twitter:image を絶対URLで解決するために必要。
// 実際の公開ドメインに合わせて変更する（複数ドメイン運用時は環境変数化を検討）。
const siteUrl = "https://animedia-khaki.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
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
    url: siteUrl,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#060a16",
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
