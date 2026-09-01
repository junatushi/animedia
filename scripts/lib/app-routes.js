// app/ を歩いて「Next.js がURLに割り当てるファイル」を全部返す（2026-08-31導入）。
//
// 【なぜ要るか】
// このリポジトリの検査は長らく**対象を手で数えて名指しで書いて**いた。
// 実際、作品IDの検証（lib/workId.ts）を導入したとき、私は窓口を「3つ」と手で数え、
// scripts/check.ts にもその3つを名指しで書いた。ところが実際には4つあり、
// `app/anime/[id]/opengraph-image.tsx` が `Number(params.id)` のまま残った。
// 名指しの検査は**そのファイルについては正しく動き続ける**ので、漏れた1件は
// 永久に見つからない。同じ形の取りこぼしは過去にもある:
//   ・404の境界を `app/not-found.tsx` だけに置いて、区画ごとの境界を漏らした
//   ・逆張り巡回（patrol.js）の対象URLを手書きしたので、OG画像のルートを崩していない
//
// **対象を列挙するのをやめ、リポジトリを走査して導出する**のがこの道具の役目。
// 新しいページ種別・新しい画像ルートを足したとき、検査も巡回も**自動で追随する**。
//
// ネットワークに出ない・依存の追加なし。CommonJS で書いてあるのは、
// ESM の scripts/check.ts と CommonJS の scripts/patrol.js の両方から使うため。
const fs = require("node:fs");
const path = require("node:path");

// Next.js App Router が **URLに割り当てる** ファイル名。
// ここに載っているものは params を受け取り、外から任意の値を入れられる＝
// 検証の責任がある。not-found / loading / error / layout / template は
// URLに割り当てられない（params を受け取らない）ので対象外。
//
// 新しい種別（例: twitter-image）を Next が増やしたらここに足す。足し忘れても
// 「検査が緩む」だけで落ちないので、増やしたときは意識して足すこと。
const ROUTABLE =
  /^(page|route|opengraph-image|twitter-image|icon|apple-icon|default|sitemap|robots)\.(tsx|ts|jsx|js)$/;

// URLに現れないディレクトリ名。
//   (group) … ルートグループ
//   @slot   … パラレルルート
const isGroup = (name) => /^\(.*\)$/.test(name) || name.startsWith("@");

/**
 * app/ 以下の全ルートを返す。
 *
 * @param {string} appDir  app ディレクトリの絶対パス
 * @returns {{file:string, rel:string, routePath:string, kind:"html"|"asset"|"api", segments:string[], basename:string}[]}
 *   file      … 絶対パス
 *   rel       … リポジトリルートからの相対パス（app/... 形式・区切りは "/"）
 *   routePath … URLのパス（例: "/anime/[id]", "/anime/[id]/opengraph-image"）
 *   kind      … html=HTMLを返すページ / asset=画像など / api=Route Handler
 *   segments  … 動的セグメント名の配列（例: ["id"], ["name","year","season"]）
 *   basename  … ファイル名（例: "page.tsx"）
 */
function appRoutes(appDir) {
  const out = [];
  const walk = (dir, urlParts) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        // ルートグループ・パラレルルートはURLに現れないので、URLには足さずに潜る。
        walk(full, isGroup(ent.name) ? urlParts : [...urlParts, ent.name]);
        continue;
      }
      if (!ROUTABLE.test(ent.name)) continue;
      const stem = ent.name.replace(/\.(tsx|ts|jsx|js)$/, "");
      // page / route はディレクトリ自体がURL。それ以外（画像など）はファイル名もURLに出る。
      const parts = stem === "page" || stem === "route" ? urlParts : [...urlParts, stem];
      const routePath = "/" + parts.join("/");
      const segments = urlParts
        .filter((p) => /^\[.*\]$/.test(p))
        .map((p) => p.replace(/^\[\.{0,3}/, "").replace(/\]$/, ""));
      out.push({
        file: full,
        rel: "app" + full.slice(appDir.length).split(path.sep).join("/"),
        routePath: routePath === "/" ? "/" : routePath,
        kind: stem === "route" ? "api" : stem === "page" ? "html" : "asset",
        segments,
        basename: ent.name,
      });
    }
  };
  walk(appDir, []);
  out.sort((a, b) => a.routePath.localeCompare(b.routePath) || a.basename.localeCompare(b.basename));
  return out;
}

/** 動的セグメントを1つ以上持つルートだけ（＝外から任意の値が入る窓口）。 */
function dynamicRoutes(appDir) {
  return appRoutes(appDir).filter((r) => r.segments.length > 0);
}

module.exports = { appRoutes, dynamicRoutes, ROUTABLE };
