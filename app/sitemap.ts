import type { MetadataRoute } from "next";

const siteUrl = "https://animedia-khaki.vercel.app";

// コンテンツは Annict からクライアント側で取得しており、年・シーズンごとに
// 別々にサーバーレンダリングされたページがあるわけではないため、
// クロール対象としてはルートURL1件で十分。
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: siteUrl,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
  ];
}
