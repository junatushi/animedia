// ───────────────────────────────────────────────────────────────
// 配信先ウィジェット（iframe版）の中身を返す。
//   GET /embed/anime/{annictId}  → text/html
//
// React のページではなく Route Handler にしている理由:
//   app/layout.tsx（ルートレイアウト）は globals.css・Supabase の AuthProvider・
//   Vercel Analytics を読み込む。これは他人のブログの中で動くiframeには過剰で、
//   認証用JSと解析を第三者サイトに持ち込むことにもなる。App Router では
//   ルートレイアウトを外せないため、HTMLを直接返して回避する。
//   組み立てそのものは lib/embed.ts（純.ts＝scripts/check.ts から検査できる）。
// ───────────────────────────────────────────────────────────────
import { getWorkData } from "@/lib/getWorkData";
import { buildEmbedDocument } from "@/lib/embed";

// 作品ページ（app/anime/[id]/page.tsx）と同じ15分。
export const revalidate = 900;

function jstToday(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 埋め込みは第三者サイトの中で読まれる。フレーム内表示を明示的に許可し、
// CDNエッジにも載せて貼り先の表示速度に影響しないようにする。
const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "public, s-maxage=900, stale-while-revalidate=86400",
  // 既定でも埋め込みは可能だが、意図（どのサイトからでも貼ってよい）を明示する。
  "Content-Security-Policy": "frame-ancestors *",
  "X-Robots-Tag": "noindex, follow",
};

function plain(message: string, status: number): Response {
  return new Response(
    `<!doctype html><html lang="ja"><head><meta charset="utf-8">` +
      `<meta name="robots" content="noindex"><title>アニメ視聴ガイド</title></head>` +
      `<body style="margin:0;font:13px/1.6 system-ui,sans-serif;color:#5b6472;padding:12px">` +
      `${message}</body></html>`,
    { status, headers: { ...HTML_HEADERS, "Cache-Control": "no-store" } }
  );
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return plain("作品IDが正しくありません。", 400);
  }

  let item;
  try {
    item = await getWorkData(id);
  } catch {
    // Annict障害時。貼り先のブログに壊れた枠を出しっぱなしにしないよう、
    // キャッシュせず短い文言だけ返す（作品ページ側のnoindex方針と同じ考え方）。
    return plain("配信情報を取得できませんでした。", 502);
  }
  if (!item) return plain("作品が見つかりませんでした。", 404);

  return new Response(buildEmbedDocument(item, jstToday()), { headers: HTML_HEADERS });
}
