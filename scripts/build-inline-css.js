// app/globals.css → app/inlineCss.ts（HTMLに直接埋め込む文字列定数）を生成する。
//
// なぜ埋め込むか（2026-09-04・㊵）: Next.js が <link rel="stylesheet"> を吐くと
// HTMLが届いた後にもう1往復かかり、実測で描画開始が約370ms遅れる。
//
// 【2026-09-14変更】1本の INLINE_CSS ではなく、**面ごとに必要な分だけを配る層**
// （CSS_LAYERS）を出す。全ページに全量（40.9KB）を入れていたため、ビルド成果物の
// 実測で声優ページ1枚の**76%がCSS**（<style>・RSCペイロード・.rsc に計3コピー）で、
// 本文4.6KBに対してCSSが126KBという状態だった。層に分けると声優・制作会社・監督・
// ランキング・独占配信・サービス別・固定ページは 11.2KB で足りる（−73%）。
// 層の決め方・検査・順序の扱いは scripts/lib/css-layers.js の冒頭に全部書いてある。
const fs = require("fs");
const path = require("path");
const { minifyCss } = require("./lib/minify-css");
const { LAYERS, collectRouteClasses, layerForRoutes, splitCss, findOrderConflicts } =
  require("./lib/css-layers");

const SRC = path.join(__dirname, "..", "app", "globals.css");
const OUT = path.join(__dirname, "..", "app", "inlineCss.ts");
// base 層だけを**別ファイル**に出す（2026-09-19導入）。理由は buildBase の上に書いた。
const OUT_BASE = path.join(__dirname, "..", "app", "inlineCssBase.ts");

// globals.css を層ごとの最小化済みCSSに変換する。
// scripts/check.ts もこの関数を通して「app/inlineCss.ts が globals.css と同期しているか」
// を確かめるので、生成とテストで同じ経路を通る（片方だけ直すことができない）。
function buildLayers(css) {
  const { classToRoutes, warnings } = collectRouteClasses();
  const classToLayer = new Map();
  for (const [c, routes] of classToRoutes) classToLayer.set(c, layerForRoutes(routes));
  const { rendered, rules } = splitCss(css, classToLayer);
  const conflicts = findOrderConflicts(rules, classToLayer);
  const minified = {};
  for (const l of LAYERS) minified[l] = minifyCss(rendered[l]);
  return { minified, conflicts, warnings, classToLayer };
}

/**
 * base 層だけを単体のモジュールとして出す（2026-09-19導入・重大度高）。
 *
 * 【なぜ分けるか】ビルド成果物の実測で、埋め込んだCSSが**1ページに3コピー**入っていた:
 *   ①<style> の中身（HTML） ②同じ文字列がRSCペイロードにも入る（HTML内の
 *   self.__next_f.push） ③さらに .rsc ファイルにもう1本。
 * ②③が生まれるのは、<style> を**サーバーコンポーネント**が描いているせい。
 * サーバーが描いた要素はそのまま Flight ペイロードへ直列化されるので、
 * dangerouslySetInnerHTML に渡した文字列がまるごと2回余計に焼かれる。
 * base は全ページに載るため、これが成果物のいちばん大きな塊になっていた
 * （声優ページ1枚 97KB のうち CSS が 23KB＝24%。4,483枚で約103MB）。
 *
 * 【どう直すか】base を描くのを**クライアントコンポーネント**（components/BaseCss.tsx）に
 * 移す。クライアントコンポーネントは Flight ペイロードには「モジュールの参照」しか
 * 出ないので、②③が消える。サーバー描画時には従来どおり <style> がHTMLに出るので、
 * **見た目もCSSの往復の無さ（㊵）も変わらない**。
 * その代わりCSS文字列はクライアントのJSチャンクに入るが、それは**1本だけ**で
 * 全ページで共有・キャッシュされる（ページ数を掛けない）。
 *
 * 【なぜ別ファイルにするか】CSS_LAYERS（base+explorer+detail の1オブジェクト）を
 * クライアントから import すると、使わない explorer(26.5KB) までJSチャンクに入る。
 * base だけの単体モジュールにしておけば、クライアントに渡るのは base だけで済む。
 */
function buildBase(css) {
  const { minified } = buildLayers(css);
  return (
    "// 自動生成（node scripts/build-inline-css.js）。手で編集しない。\n" +
    "// 元は app/globals.css。**base 層だけ**を単体で持つ。\n" +
    "//\n" +
    "// これを分けてあるのは components/BaseCss.tsx（クライアントコンポーネント）が\n" +
    "// ここだけを import するため。CSS_LAYERS ごと渡すと、使わない explorer 層まで\n" +
    "// クライアントのJSチャンクに入る。\n" +
    "// なぜクライアントで描くのかは scripts/build-inline-css.js の buildBase を読むこと\n" +
    "// （サーバーで描くとRSCペイロードと .rsc にCSSがもう2コピー焼かれる）。\n" +
    "export const CSS_BASE = " +
    JSON.stringify(minified.base) +
    ";\n"
  );
}

function build(css) {
  const { minified } = buildLayers(css);
  const entries = LAYERS.map((l) =>
    l === "base" ? "  base: CSS_BASE," : `  ${l}: ${JSON.stringify(minified[l])},`
  ).join("\n");
  return (
    "// 自動生成（node scripts/build-inline-css.js）。手で編集しない。\n" +
    "// 元は app/globals.css。HTMLに <style> として直接埋め込み、CSS取得の往復\n" +
    "// （実測で描画開始が約370ms遅れる）を無くすためのもの。\n" +
    "//\n" +
    "// base はルートレイアウトが <head> に入れる（全ページ共通）。ただし実体は\n" +
    "// app/inlineCssBase.ts にあり、描くのは components/BaseCss.tsx（クライアント）。\n" +
    "// explorer / detail は、それを使う面が本文の**先頭**で追加する\n" +
    "// （components/PageCss.tsx）。どのクラスがどの層かは app/ と components/ の\n" +
    "// import グラフから導出しており、人が並べる場所は無い。\n" +
    "// 仕組みと検査は scripts/lib/css-layers.js を読むこと。\n" +
    "// app/globals.css を編集したら必ず再生成する（ズレは node scripts/check.ts が検出）。\n" +
    'import { CSS_BASE } from "./inlineCssBase";\n\n' +
    "export const CSS_LAYERS = {\n" +
    entries +
    "\n} as const;\n\n" +
    "export type CssLayer = keyof typeof CSS_LAYERS;\n"
  );
}

module.exports = { build, buildBase, buildLayers };

if (require.main === module) {
  const css = fs.readFileSync(SRC, "utf8");
  const { minified, conflicts, warnings } = buildLayers(css);
  // 生成の時点で止める。ここを素通りさせると「そのページだけ無スタイル」や
  // 「順序が入れ替わって見た目が変わる」が本番まで届く。
  if (warnings.length > 0) {
    console.error("className をソースから導出できない箇所があります:");
    for (const w of warnings) console.error("  " + w);
    process.exit(1);
  }
  if (conflicts.length > 0) {
    console.error("層に分けるとカスケードの順序が入れ替わる組があります:");
    for (const c of conflicts) {
      console.error(`  [${c.layer}] ${c.earlier}  ↔  ${c.later}  (${c.props.join(", ")})`);
    }
    process.exit(1);
  }
  fs.writeFileSync(OUT_BASE, buildBase(css));
  fs.writeFileSync(OUT, build(css));
  const total = LAYERS.reduce((n, l) => n + minified[l].length, 0);
  console.log(
    `app/inlineCss.ts + app/inlineCssBase.ts を更新: ${(css.length / 1024).toFixed(1)}KB → ` +
      LAYERS.map((l) => `${l} ${(minified[l].length / 1024).toFixed(1)}KB`).join(" / ") +
      ` （計 ${(total / 1024).toFixed(1)}KB）`
  );
}
