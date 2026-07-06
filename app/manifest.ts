import type { MetadataRoute } from "next";

// PWA化: これを置くだけで <link rel="manifest"> が自動挿入され、
// スマホの「ホーム画面に追加」でアプリらしく起動できるようになる。
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "アニメ視聴ガイド",
    short_name: "アニメ視聴ガイド",
    description: "シーズンごとのアニメを、観られる国内配信サービス別に一覧。",
    start_url: "/",
    display: "standalone",
    background_color: "#060a16",
    theme_color: "#060a16",
    lang: "ja",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
