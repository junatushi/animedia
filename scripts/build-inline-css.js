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

function build(css) {
  const { minified } = buildLayers(css);
  const entries = LAYERS.map((l) => `  ${l}: ${JSON.stringify(minified[l])},`).join("\n");
  return (
    "// 自動生成（node scripts/build-inline-css.js）。手で編集しない。\n" +
    "// 元は app/globals.css。HTMLに <style> として直接埋め込み、CSS取得の往復\n" +
    "// （実測で描画開始が約370ms遅れる）を無くすためのもの。\n" +
    "//\n" +
    "// base はルートレイアウトが <head> に入れる（全ページ共通）。\n" +
    "// explorer / detail は、それを使う面が本文の**先頭**で追加する\n" +
    "// （components/PageCss.tsx）。どのクラスがどの層かは app/ と components/ の\n" +
    "// import グラフから導出しており、人が並べる場所は無い。\n" +
    "// 仕組みと検査は scripts/lib/css-layers.js を読むこと。\n" +
    "// app/globals.css を編集したら必ず再生成する（ズレは node scripts/check.ts が検出）。\n" +
    "export const CSS_LAYERS = {\n" +
    entries +
    "\n} as const;\n\n" +
    "export type CssLayer = keyof typeof CSS_LAYERS;\n"
  );
}

module.exports = { build, buildLayers };

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
  fs.writeFileSync(OUT, build(css));
  const total = LAYERS.reduce((n, l) => n + minified[l].length, 0);
  console.log(
    `app/inlineCss.ts を更新: ${(css.length / 1024).toFixed(1)}KB → ` +
      LAYERS.map((l) => `${l} ${(minified[l].length / 1024).toFixed(1)}KB`).join(" / ") +
      ` （計 ${(total / 1024).toFixed(1)}KB）`
  );
}
