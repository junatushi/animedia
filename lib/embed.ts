// ───────────────────────────────────────────────────────────────
// 配信先ウィジェット（他サイトに貼ってもらう埋め込み）の中核ロジック。
//
// なぜ作るか（2026-08-06）:
//   2026-07-26の実測で平均掲載順位19.8位・検索クリック7件/28日。ページの種類を増やす
//   方向は「新設したSEOページ群が表示ゼロ」という実測で頭打ちと判定済みで、残る
//   ボトルネックは被リンク・外部言及がゼロに近いこと。個人サイトが金も知名度も無しに
//   被リンクを得る現実的な手段は「他人が貼りたくなるものを配る」しかない。
//   アニメ感想ブログは記事末に「この作品はここで見れます」を書きたい動機が元々あるのに、
//   その情報を自分で調べて手で書いている。そこを1行で埋められるようにする。
//   大手VODアフィリエイトサイトは同じことをすると自分の広告収益を他人に渡すことになるため
//   構造的に真似できない＝個人サイトだから打てる手。
//
// 設計上の約束（scripts/check.ts が機械的に検査する）:
//   ・埋め込みHTMLに入るリンクは **自サイト（siteUrl）配下だけ**。アフィリエイトリンクや
//     配信サービスの公式サイトへのリンクは絶対に入れない。他人のブログに自分のアフィリンクを
//     埋め込むのはステマ規制・ASP規約の両面で事故になるうえ、貼る側の信頼も壊す。
//   ・<script> を含めない。他人のサイトで実行されるJSを配らない（信頼と安全のため）。
//   ・作品名などの外部由来文字列は必ずエスケープする。
//   ・リンクには ?ref=embed を付け、埋め込み経由の流入を実測できるようにする
//     （docs/demand-scan.md の ?ref= と同じ運用）。
// ───────────────────────────────────────────────────────────────
// 拡張子つきなのは `node scripts/check.ts`（Nodeの型ストリッピング）から直接読めるようにするため。
// tsconfig.json の allowImportingTsExtensions と対。
import { siteUrl } from "./siteUrl.ts";
import { sortServicesForMetadata } from "./services.ts";

// 埋め込み経由の流入を Vercel Analytics のリファラ/クエリで見分けるための印。
export const EMBED_REF = "embed";

// サマリ文に並べる配信サービス名の上限（超えた分は「ほか{n}サービス」にまとめる）。
export const EMBED_MAX_SERVICES = 3;

export interface EmbedService {
  key: string;
  short: string;
  name: string;
  color: string;
}

// AnimeItem / AnimeDetail をそのまま渡せる形（必要な分だけを構造的に受ける）。
export interface EmbedWork {
  id: number;
  title: string;
  services: EmbedService[];
  otherServices: string[];
  hasBroadcastData: boolean;
}

// HTML本文・属性値の両方で安全に使えるようエスケープする。
// 他人のサイトに貼られるHTMLを組み立てるので、ここは必ず通す。
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// 埋め込みから自サイトへ戻ってくるリンク。?ref= で流入を実測する。
export function embedWorkUrl(id: number): string {
  return `${siteUrl}/anime/${id}?ref=${EMBED_REF}`;
}

// iframe版の配信元URL。
export function embedFrameUrl(id: number): string {
  return `${siteUrl}/embed/anime/${id}`;
}

// 「dアニメストア・ABEMA・U-NEXT ほか3サービス」のような1行サマリ。
// 配信が無い場合は、Annictに放送データ自体が無いのか（＝未登録）、TV放送のみなのかを
// 区別して書く（lib/services.ts の hasBroadcastData と同じ出し分け。推測で埋めない）。
export function embedServiceSummary(work: EmbedWork): string {
  // 並び順は作品ページのtitle（lib/workTitle.ts）と同じ優先度に揃える。Annictの返す順は
  // 登録順で意味を持たず、そのままだと「バンチャ・ABEMA・Prime ほか8サービス」のように
  // 検索でよく指名されるサービス（dアニメ・U-NEXT等）が「ほか8」に埋もれる。
  const names = [...sortServicesForMetadata(work.services).map((s) => s.short), ...work.otherServices];
  if (names.length === 0) {
    return work.hasBroadcastData
      ? "見放題の配信サービスは未登録（TV放送のみ確認）"
      : "配信情報は未登録";
  }
  const head = names.slice(0, EMBED_MAX_SERVICES).join("・");
  const rest = names.length - EMBED_MAX_SERVICES;
  return rest > 0 ? `${head} ほか${rest}サービス` : head;
}

// ── 貼り付け用の静的HTMLスニペット ───────────────────────────────
// 単一の <a> にまとめる。理由:
//   ・はてなブログ・WordPress・FC2 などHTMLの許可範囲が異なる環境でも壊れにくい
//   ・外部CSS/JSに依存しない（貼った先の表示速度に影響しない）
//   ・カード全体がリンク＝押し間違いが起きない（CLAUDE.mdの「リンクの中に別の
//     行き先のリンクを入れない」方針とも整合。行き先はこのカード1つにつき1つだけ）
// 背景色・文字色は明示する。貼り先がダークテーマでもライトテーマでも読めるようにするため、
// メディアクエリの使えないインラインstyleでは「白地＋濃い文字」で固定する。
export function buildEmbedSnippet(work: EmbedWork): string {
  const url = escapeHtml(embedWorkUrl(work.id));
  const title = escapeHtml(work.title);
  const summary = escapeHtml(embedServiceSummary(work));
  const card = [
    "display:block",
    "max-width:520px",
    "margin:16px 0",
    "padding:14px 16px",
    "border:1px solid #d7dbe3",
    "border-radius:10px",
    "background:#ffffff",
    "color:#1a1d24",
    "text-decoration:none",
    "font-family:system-ui,-apple-system,'Segoe UI','Hiragino Sans','Noto Sans JP',sans-serif",
    "line-height:1.6",
  ].join(";");

  return [
    `<!-- アニメ視聴ガイド 配信先ウィジェット / ${siteUrl} -->`,
    `<a href="${url}" target="_blank" rel="noopener" style="${card}">`,
    `<span style="display:block;font-size:11px;letter-spacing:.08em;color:#5b6472">配信中のサービス</span>`,
    `<span style="display:block;margin-top:4px;font-size:15px;font-weight:700">${title}</span>`,
    `<span style="display:block;margin-top:6px;font-size:13px;color:#2b3240">${summary}</span>`,
    `<span style="display:block;margin-top:10px;font-size:11px;color:#5b6472">アニメ視聴ガイドで最新の配信先を見る →</span>`,
    `</a>`,
  ].join("\n");
}

// ── iframe版の貼り付けコード ─────────────────────────────────────
// 静的スニペットと違い、配信先が変わったら自動で追従する。
export const EMBED_FRAME_HEIGHT = 132;

export function buildEmbedIframeSnippet(work: EmbedWork): string {
  const src = escapeHtml(embedFrameUrl(work.id));
  const title = escapeHtml(`${work.title} の配信先（アニメ視聴ガイド）`);
  return [
    `<iframe src="${src}" title="${title}" width="100%" height="${EMBED_FRAME_HEIGHT}"`,
    ` style="border:0;max-width:520px" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`,
  ].join("");
}

// ── iframeが読み込むHTML文書そのもの ────────────────────────────
// app/embed/anime/[id]/route.ts が返す。ルートレイアウト（globals.css・Supabaseの
// AuthProvider・Analytics）を通さないよう、React ではなく Route Handler で組み立てる。
// 他人のサイトの中で動くものに認証用JSや解析を持ち込まないための判断でもある。
export function buildEmbedDocument(work: EmbedWork, checkedDate: string): string {
  const url = escapeHtml(embedWorkUrl(work.id));
  const title = escapeHtml(work.title);
  // バッジもサマリ文と同じ優先度で並べる（よく指名されるサービスを先に見せる）。
  const badges = sortServicesForMetadata(work.services)
    .map(
      (s) =>
        `<span class="b" style="border-color:${escapeHtml(s.color)}"><i style="background:${escapeHtml(
          s.color
        )}"></i>${escapeHtml(s.short)}</span>`
    )
    .join("");
  const others = work.otherServices
    .map((n) => `<span class="b o">${escapeHtml(n)}</span>`)
    .join("");
  const empty =
    work.services.length === 0 && work.otherServices.length === 0
      ? `<p class="empty">${escapeHtml(embedServiceSummary(work))}</p>`
      : "";

  return `<!doctype html>
<html lang="ja"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,follow">
<title>${title} の配信先 | アニメ視聴ガイド</title>
<style>
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;font:13px/1.6 system-ui,-apple-system,"Segoe UI","Hiragino Sans","Noto Sans JP",sans-serif;
 background:#fff;color:#1a1d24}
a.w{display:block;padding:12px 14px;border:1px solid #d7dbe3;border-radius:10px;
 text-decoration:none;color:inherit}
.k{font-size:11px;letter-spacing:.08em;color:#5b6472}
.t{display:block;margin-top:3px;font-size:15px;font-weight:700}
.row{margin-top:8px;display:flex;flex-wrap:wrap;gap:5px}
.b{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border:1px solid #d7dbe3;
 border-radius:999px;font-size:11px;white-space:nowrap}
.b i{width:7px;height:7px;border-radius:50%;display:inline-block}
.b.o{border-style:dashed}
.empty{margin:8px 0 0;font-size:12px;color:#5b6472}
.f{margin-top:9px;font-size:11px;color:#5b6472}
@media (prefers-color-scheme:dark){
 body{background:#12151c;color:#e8ecf4}
 a.w{border-color:#2c3444}
 .k,.f,.empty{color:#97a1b3}
 .b{border-color:#2c3444}
}
</style></head><body>
<a class="w" href="${url}" target="_blank" rel="noopener">
<span class="k">配信中のサービス</span>
<span class="t">${title}</span>
<div class="row">${badges}${others}</div>
${empty}
<div class="f">アニメ視聴ガイド調べ（${escapeHtml(checkedDate)}時点・Annictより自動取得）→ 最新を見る</div>
</a>
</body></html>`;
}
