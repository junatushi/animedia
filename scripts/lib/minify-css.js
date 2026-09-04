// CSSを「意味を変えずに」縮める最小限のミニファイア（2026-09-04導入）。
//
// 【なぜ要るか】app/globals.css を <style> としてHTMLに直接埋め込むため
// （app/inlineCss.ts を scripts/build-inline-css.js が生成する）。埋め込む理由は
// docs/operations.md の㊵。ソースは日本語コメントが多く67KBあるので、そのまま埋めると
// 毎レスポンスに無駄が乗る。
//
// 【安全側に倒す方針】壊れ方が「サイト全体が無スタイル」なので、賢い最適化はしない:
//   ・コメント（/* */）を落とす
//   ・文字列（"..." '...'）の**中身は絶対に触らない**（content: "◆ " のような
//     意味のある空白が消えると見た目が変わる）
//   ・空白の連続を1つに畳み、`{` `}` `;` `,` の前後だけ空白を落とす
//   ・`:` `>` `+` `~` の周りは触らない（calc() や セレクタの結合子を壊さないため）
function minifyCss(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    // コメント
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      // コメントは区切りにもなり得るので空白1つに置き換える（後段で畳まれる）
      out += " ";
      continue;
    }
    // 文字列（中身はそのまま通す）
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let str = quote;
      while (j < n) {
        if (src[j] === "\\") {
          str += src[j] + (src[j + 1] ?? "");
          j += 2;
          continue;
        }
        str += src[j];
        if (src[j] === quote) {
          j++;
          break;
        }
        j++;
      }
      out += str;
      i = j;
      continue;
    }
    // 空白の連続
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f") {
      let j = i;
      while (j < n && /\s/.test(src[j])) j++;
      out += " ";
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  // 区切り記号の前後の空白だけ落とす
  return out
    .replace(/\s*([{};,])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();
}

module.exports = { minifyCss };
