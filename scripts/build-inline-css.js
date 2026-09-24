// app/globals.css → app/inlineCss<Layer>.ts（HTMLに直接埋め込む文字列定数）を生成する。
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
const {
  LAYERS,
  collectRouteClasses,
  layerForRoutes,
  splitCss,
  findOrderConflicts,
  cssModuleFor,
  cssConstFor,
  cssComponentFor,
} = require("./lib/css-layers");

const SRC = path.join(__dirname, "..", "app", "globals.css");
// 出力は**層ごとに1本**（app/inlineCssBase.ts / inlineCssExplorer.ts / inlineCssDetail.ts）。
// 1つの CSS_LAYERS オブジェクトにまとめない理由は buildLayerModule の上に書いた。
// ファイル名は層から導出する（ここに並べない。㊳）。
const outFor = (layer) => path.join(__dirname, "..", cssModuleFor(layer));

// globals.css を層ごとの最小化済みCSSに変換する。
// scripts/check.ts もこの関数を通して「生成物が globals.css と同期しているか」
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
 * 層1つを単体のモジュールとして出す（2026-09-19に base で導入 → 2026-09-24に全層へ）。
 *
 * 【なぜ層ごとに別ファイルなのか】このモジュールを import するのは
 * components/<Layer>Css.tsx（**クライアントコンポーネント**）だけ。層をまとめた
 * 1つのオブジェクト（かつての CSS_LAYERS）を渡すと、その面が使わない層まで同じ
 * JSチャンクに載る（explorer は 26.1KB あり、作品ページには1文字も要らない）。
 *
 * 【なぜクライアントで描くのか】サーバーコンポーネントが描いた <style> は、そのまま
 * Flight ペイロードへ直列化されるので、同じCSS文字列が **1ページに3コピー**焼かれる:
 *   ① <style> の中身（HTML） ② HTML内の self.__next_f.push ③ 同じページの .rsc
 * ②③は圧縮でも重複排除されない（③は別ファイル）。クライアントコンポーネントなら
 * Flight に出るのは「モジュールの参照」だけなので②③が消え、CSS文字列は
 * JSチャンク1本に入って全ページで共有される（ページ数を掛けない）。
 *
 * ビルド成果物の実測（2026-09-24・修正前）: 同じ作品ページのHTML内で base 層は
 * 1回・detail 層は2回現れ、.rsc には base 0回・detail 1回。**"use client" の有無
 * だけがこの差を作っていた。** 余剰は detail 15.31MiB（1,961枚）＋
 * explorer 3.52MiB（69枚）＝計 18.83MiB。
 *
 * 【見た目・速度は変わらない】サーバー描画時には従来どおり <style> がHTMLに出るので、
 * 「CSSを外部ファイルにしない（㊵）」は守られたまま＝往復は増えない。
 */
function buildLayerModule(css, layer) {
  const { minified } = buildLayers(css);
  return (
    "// 自動生成（node scripts/build-inline-css.js）。手で編集しない。\n" +
    `// 元は app/globals.css の「${layer}」層**だけ**。\n` +
    "//\n" +
    `// これを単体のファイルにしてあるのは components/${cssComponentFor(layer)}.tsx\n` +
    "// （クライアントコンポーネント）がここだけを import するため。層をまとめて渡すと、\n" +
    "// その面が使わない層までクライアントのJSチャンクに入る。\n" +
    "// なぜクライアントで描くのかは scripts/build-inline-css.js の buildLayerModule を\n" +
    "// 読むこと（サーバーで描くとRSCペイロードと .rsc にCSSがもう2コピー焼かれる）。\n" +
    `export const ${cssConstFor(layer)} = ` +
    JSON.stringify(minified[layer]) +
    ";\n"
  );
}

module.exports = { buildLayerModule, buildLayers };

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
  for (const l of LAYERS) fs.writeFileSync(outFor(l), buildLayerModule(css, l));
  const total = LAYERS.reduce((n, l) => n + minified[l].length, 0);
  console.log(
    `${LAYERS.map(cssModuleFor).join(" + ")} を更新: ${(css.length / 1024).toFixed(1)}KB → ` +
      LAYERS.map((l) => `${l} ${(minified[l].length / 1024).toFixed(1)}KB`).join(" / ") +
      ` （計 ${(total / 1024).toFixed(1)}KB）`
  );
}
