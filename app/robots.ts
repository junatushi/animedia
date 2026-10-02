import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/siteUrl";

// 【2026-10-02・利用者の判断】AIクローラーを「学習用」と「検索・回答用」に分けて扱う。
//
// 学習用（AI_TRAINING_BOTS）は**拒否する**。公開ページの本文（作品名・配信サービス・
// 放送曜日・声優など）をモデルの学習データとして持ち去るだけで、回答に出典リンクを付けない
// ＝サイトへの流入を生まない。しかもこのサイトの中身は鮮度が命の配信情報なので、学習時点の
// 古い情報が出典なしで答えられうる。巡回のたびにページ再生成（ISR Writes）とCPUも使う。
//
// 検索・回答用（AI_SEARCH_BOTS）は**許可を続ける**。ユーザーの質問に答えるときにページを
// 取りに来て、回答に出典リンクを付ける＝流入の可能性がある側（docs/ai-era-strategy-2026-08-13.md）。
// Googlebot・Bingbot など通常の検索エンジンは `*` の規則で従来どおり許可。
//
// Google-Extended・Applebot-Extended はクローラーではなく「AI学習への利用許諾」の意思表示
// トークン。拒否しても Google検索・Apple検索の索引には影響しない。
const AI_TRAINING_BOTS = [
  "GPTBot", // OpenAI（学習）
  "ClaudeBot", // Anthropic（学習）
  "anthropic-ai",
  "Claude-Web",
  "CCBot", // Common Crawl（多くのLLMの学習元となる公開データセット）
  "Bytespider", // ByteDance
  "Amazonbot", // Amazon
  "Meta-ExternalAgent", // Meta（Llama等）
  "Google-Extended", // GoogleのAI学習への利用許諾（検索の索引には無関係）
  "Applebot-Extended", // AppleのAI学習への利用許諾（検索の索引には無関係）
];

const AI_SEARCH_BOTS = [
  "OAI-SearchBot", // OpenAI（ChatGPT検索）
  "ChatGPT-User", // ChatGPTのブラウジング
  "PerplexityBot", // Perplexity
  "Perplexity-User",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: "/admin" },
      { userAgent: AI_SEARCH_BOTS, allow: "/", disallow: "/admin" },
      { userAgent: AI_TRAINING_BOTS, disallow: "/" },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
