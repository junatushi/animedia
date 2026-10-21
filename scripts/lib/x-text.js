// X（旧Twitter）の文字数の数え方と、長すぎる作品名の省略（2026-10-21導入）。
//
// 【なぜ要るか】日次・週次の下書きは「文字の個数」で260字以内に収めていたが、Xは
// 個数ではなく**重み**で数える（twitter-text v3）。日本語（全角）は1文字=2、半角は1、
// URLは長さに関係なく23で、上限は280。つまり日本語の本文は実質140字までしか入らない。
// 2026-10-21に実測すると日次の放送枠は全曜日で393〜444（上限280）、毎回はみ出していた
// （利用者の指摘で発覚。投稿画面で毎回手で削っていた）。
//
// Bluesky（300字・個数で数える）・Mastodon・Threadsは数え方が違うので、ここは X 専用。
const X_MAX_WEIGHT = 280;
const X_URL_WEIGHT = 23;

// 作品名が「ポスト表示で2行」を超えたら省略する（利用者の基準・2026-10-21）。
// 1行の幅は**推測**: スマホのXアプリで全角おおよそ21文字（重み42）。端末・文字サイズで
// 変わるので、表示が合わなければこの定数だけを直す。
const X_LINE_WEIGHT = 42;
const X_TITLE_MAX_LINES = 2;
const ELLIPSIS = "…";

// twitter-text v3 の既定の重み表。この範囲は1、それ以外（全角・絵文字等）は2。
function charWeight(cp) {
  if (cp <= 4351) return 1; // ラテン・ギリシャ・キリル・ハングル字母など
  if (cp >= 8192 && cp <= 8205) return 1; // 各種スペース
  if (cp >= 8208 && cp <= 8223) return 1; // ハイフン・ダッシュ・引用符
  if (cp >= 8242 && cp <= 8247) return 1; // プライム
  return 2;
}

function weightOf(text) {
  let n = 0;
  for (const ch of text) n += charWeight(ch.codePointAt(0));
  return n;
}

// URLは本文中の長さに関係なく23。下書きに入るURLは https:// で始まるものだけ。
const URL_RE = /https?:\/\/\S+/g;
function xWeightedLength(text) {
  let n = 0;
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    n += weightOf(text.slice(last, m.index)) + X_URL_WEIGHT;
    last = m.index + m[0].length;
  }
  return n + weightOf(text.slice(last));
}

function fitsX(text) {
  return xWeightedLength(text) <= X_MAX_WEIGHT;
}

// 重みが max を超えるところで切って「…」を付ける（最後の手段。呼び出し側は先に
// 行を減らして収めること＝末尾のハッシュタグが千切れないように）。
function truncateForX(text, max = X_MAX_WEIGHT) {
  if (xWeightedLength(text) <= max) return text;
  const budget = max - weightOf(ELLIPSIS);
  let out = "";
  for (const ch of text) {
    if (xWeightedLength(out + ch) > budget) break;
    out += ch;
  }
  return out + ELLIPSIS;
}

// 切ったあとの末尾に残ると見苦しい記号（空白・サブタイトルの開き記号・句読点）。
const TRAILING_JUNK = /[\s　～〜〈《「『(（\-―－・、。:：]+$/;

// 作品名を「同じ行のほかの文字（fixedWeight）と合わせて2行以内」に収める。
// 収まるなら手を加えない。超えるときは途中で切り、続きがあると分かるよう「…」を付ける。
// 新しい呼び方を作らない（機械的に切るだけ。CLAUDE.mdの「創作しない」方針）。
function fitTitleForX(title, fixedWeight = 0) {
  const budget = X_LINE_WEIGHT * X_TITLE_MAX_LINES - fixedWeight;
  if (weightOf(title) <= budget) return title;
  const room = budget - weightOf(ELLIPSIS);
  let out = "";
  for (const ch of title) {
    if (weightOf(out + ch) > room) break;
    out += ch;
  }
  return out.replace(TRAILING_JUNK, "") + ELLIPSIS;
}

module.exports = {
  X_MAX_WEIGHT,
  X_URL_WEIGHT,
  X_LINE_WEIGHT,
  X_TITLE_MAX_LINES,
  xWeightedLength,
  fitsX,
  truncateForX,
  fitTitleForX,
  weightOf,
};
