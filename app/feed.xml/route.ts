import { CHANGELOG } from "@/lib/changelog";

import { siteUrl } from "@/lib/siteUrl";
const title = "アニメ視聴ガイド";
const description = "シーズンごとのアニメを、観られる国内配信サービス別に一覧。配信情報は Annict からリアルタイム取得。";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// サイトの更新履歴（lib/changelog.ts）をRSS 2.0で配信する。
// 個別作品の配信情報はAnnict由来で確定した公開日時を持たないため、
// フィードの対象は「サイト自体の更新」にしている。
// 【2026-11-06・Next.js 16】GET の route handler は 15 以降、既定で**毎回関数を起動する**（14 はビルド時に
// 静的化していた）。中身はビルド時に決まるので、14 と同じく静的に固定する（外すと要求ごとに起動＝無料枠を削る）。
// 検査は node scripts/check.ts の「引数なしの GET はキャッシュの扱いを明示する」。
export const dynamic = "force-static";

export async function GET() {
  const items = CHANGELOG.map((c) => {
    const pubDate = new Date(`${c.date}T00:00:00+09:00`).toUTCString();
    return `
    <item>
      <title>${escapeXml(c.text)}</title>
      <link>${siteUrl}</link>
      <guid isPermaLink="false">${c.date}-${escapeXml(c.text).slice(0, 40)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escapeXml(c.text)}</description>
    </item>`;
  }).join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${siteUrl}</link>
    <description>${escapeXml(description)}</description>
    <language>ja</language>
    <atom:link xmlns:atom="http://www.w3.org/2005/Atom" href="${siteUrl}/feed.xml" rel="self" type="application/rss+xml" />
    ${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      // 更新履歴が変わったときだけ反映されればよいので、10分キャッシュ。
      // 【2026-08-25変更】600 → 3600。RSSリーダーの巡回間隔は概ね1時間以上で、
      // 10分で切らす必要が無い（上のシーズンAPIと同じ理由）。
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
