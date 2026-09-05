// app/globals.css を app/inlineCss.ts（TypeScriptの文字列定数）へ焼き込む（2026-09-04導入）。
//
// 【なぜ埋め込むか】Next.jsは <link rel="stylesheet"> を吐くので、HTMLが届いてから
// **もう1往復**してCSSを取りに行く。本番のPageSpeed（モバイル）実測でこれが
// 「Est savings of 150 ms」として指摘され、ローカル実測でも描画開始が約370ms遅れていた。
// 回線の遅い端末＝このサイトの主な訪問者（スマホ）ほど効く。CSSは1本しか無く
// 圧縮後8KB程度なので、HTMLに含めても転送量の増分は小さい。
//
// 【なぜ実行時に fs で読まないか】Vercelのサーバーレス関数にはソースが同梱されない
// ことがあり、読めなければ**サイト全体が無スタイル**になる。ビルド成果物ではなく
// リポジトリにコミットされた定数にして、ズレは node scripts/check.ts が機械的に検出する。
//
// 使い方: app/globals.css を編集したら必ず `node scripts/build-inline-css.js` を実行する
//（忘れると `npm run check` が落ちる）。
const fs = require("fs");
const path = require("path");
const { minifyCss } = require("./lib/minify-css");

const SRC = path.join(__dirname, "..", "app", "globals.css");
const OUT = path.join(__dirname, "..", "app", "inlineCss.ts");

function build(css) {
  const min = minifyCss(css);
  return (
    "// 自動生成（node scripts/build-inline-css.js）。手で編集しない。\n" +
    "// 元は app/globals.css。HTMLの <head> に <style> として直接埋め込み、\n" +
    "// CSS取得の往復（実測で描画開始が約370ms遅れる）を無くすためのもの。\n" +
    "// app/globals.css を編集したら必ず再生成する（ズレは node scripts/check.ts が検出）。\n" +
    `export const INLINE_CSS = ${JSON.stringify(min)};\n`
  );
}

module.exports = { build };

if (require.main === module) {
  const css = fs.readFileSync(SRC, "utf8");
  const body = build(css);
  fs.writeFileSync(OUT, body);
  console.log(
    `app/inlineCss.ts を更新: ${(css.length / 1024).toFixed(1)}KB → ${(
      (body.length - 400) / 1024
    ).toFixed(1)}KB`
  );
}
