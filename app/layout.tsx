import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/react";

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
  // Google Search Console の所有権確認（HTMLタグ方式）。
  verification: { google: "IX-bhS1gsK4LM3Dxy_j6MpdaVGtuCtVvY_RA2NIrybs" },
  alternates: {
    types: { "application/rss+xml": `${siteUrl}/feed.xml` },
  },
};

// 検索結果のリッチ表示・サイト構造の理解のための構造化データ（JSON-LD）。
// 個々の作品はクライアント側取得のため一覧化できないので、まずはサイト自体を表す。
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: title,
  url: siteUrl,
  description,
  inLanguage: "ja",
};

export const viewport: Viewport = {
  themeColor: "#060a16",
  colorScheme: "light dark",
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
      <head>
        {/* ライトモードの選択を、描画前に <html data-theme="light"> として反映する
            （ちらつき防止のため、他のスクリプトより先に同期実行する）。 */}
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{if(localStorage.getItem('anime-haishin:theme')==='light'){document.documentElement.setAttribute('data-theme','light');}}catch(e){}})();",
          }}
        />
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>
        {children}
        {/* Vercel Web Analytics（Cookieレス・個人特定なし）。ページビューと
            page.tsx で track() する行動イベントを収集する。 */}
        <Analytics />
      </body>
    </html>
  );
}
