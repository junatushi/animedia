import type { MetadataRoute } from "next";

const siteUrl = "https://animedia-khaki.vercel.app";

// 生成AI検索（ChatGPT / Perplexity / Google AI Overviews 等）に載ることを狙い、
// 主要なAIクローラを明示的に許可する。既定の `*` でも許可されるが、Google-Extended や
// Applebot-Extended のようにAI用途を別扱いするクローラもあるため、意思表示として列挙する。
const AI_BOTS = [
  "GPTBot", // OpenAI（学習）
  "OAI-SearchBot", // OpenAI（ChatGPT検索）
  "ChatGPT-User", // ChatGPTのブラウジング
  "ClaudeBot", // Anthropic（学習）
  "anthropic-ai",
  "Claude-Web",
  "PerplexityBot", // Perplexity
  "Perplexity-User",
  "Google-Extended", // GoogleのAI（Gemini/AI Overviews）用途
  "Applebot-Extended", // AppleのAI用途
  "Amazonbot",
  "Bytespider",
  "CCBot", // Common Crawl（多くのLLMの学習元）
  "Meta-ExternalAgent",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/" },
      { userAgent: AI_BOTS, allow: "/" },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
