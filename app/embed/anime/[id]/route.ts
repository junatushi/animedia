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
import { parseWorkId } from "@/lib/workId";

// 作品ページ（app/anime/[id]/page.tsx）と同じ15分。
// 【2026-08-25変更】900秒 → 3600秒（1時間）。Vercel Hobbyの ISR Writes 上限
// （30日で200,000）を296,449件で超過しプロジェクトがPausedになったため。再検証の間隔を
// 延ばすと、①再生成の回数がそのまま減る（ISR Writes・Fluid CPU・Provisioned Memoryの
// 3指標すべてに効く）②キャッシュが効いている時間が長くなるので**表示はむしろ速くなる**。
// ISRは期限切れ後も stale-while-revalidate で古いHTMLを即座に返しつつ裏で作り直すので、
// 期限を延ばしても訪問者が待たされる場面は増えない。Annictの配信情報はコミュニティ更新で
// 分単位に動くものではなく、1時間の鮮度で困る用途がこのサイトには無い。経緯はdocs/operations.md。
// 【2026-08-25変更（2回目）】3600 → 604800（1週間）。
// 同日に900→3600へ延ばしたが、**それでは書き込みは1件も減らない**ことが実測で判明した。
// 超過時の30日で Edge Requests 10,300件/日 に対し ISR Writes 9,882件/日＝96%。
// sitemapの約7,051ページへ1日10,300リクエストが分散すると1ページあたりの再訪間隔は
// 平均16.4時間になり、revalidateがそれより短い限り訪問のたびに必ず期限切れ＝毎回書き込みに
// なる。900秒でも3600秒でも16.4時間より遥かに短いので効果が無かった。
// そこで再訪間隔より十分長い1週間にして「時間による再生成」を止め、鮮度が要る現在クールは
// /api/revalidate（.github/workflows/revalidate.yml が1日2回叩く）で明示的に指名する方式に
// 変えた。表示速度は落ちない（stale-while-revalidateで古いHTMLを即座に返す設計は同じで、
// むしろキャッシュに当たる時間が長くなる）。経緯は docs/operations.md の㉝。
export const revalidate = 604800;

function jstToday(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 埋め込みは第三者サイトの中で読まれる。フレーム内表示を明示的に許可し、
// CDNエッジにも載せて貼り先の表示速度に影響しないようにする。
const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  // 【2026-08-25変更】900 → 86400（1日）。
  // このルートは Route Handler なので、上の `export const revalidate` ではなく
  // **この Cache-Control ヘッダが実効値**（ビルド出力でも ƒ ＝動的のまま）。
  // 900秒だとエッジのキャッシュが15分で切れ、そのたびに関数が起動していた。
  // 埋め込みは他人のブログに貼られて長く生き続ける＝典型的な長い裾なので、
  // 再訪間隔（実測で平均16.4時間）より長い1日にする。1週間にしないのは、現在クールの
  // 作品を貼られた場合に配信サービスの追加が反映されるまでが長くなりすぎるため。
  "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
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
  const id = parseWorkId(params.id);
  if (id === null) {
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
