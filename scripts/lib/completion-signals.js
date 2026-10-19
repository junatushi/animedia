"use strict";
// ───────────────────────────────────────────────────────────────
// 「完結」の明示的な信号を読む純粋関数（2026-10-19導入）。
// 取得は scripts/fetch-completion.js、使う側は lib/completion.ts。
//
// 【なぜ推定をやめたか】
// 以前は「Annictに登録された最後の放送枠が過ぎたら完結」と推定していた。Annictは
// 放送枠を「済んだ分＋数週先」しか登録しないので、12話の作品が第4話の後に「完結」と
// 出た（生徒会にも穴はある！ほか、2026-10-18の本番で開始3〜4週目の7作品）。
// 話数の下限・期間・停滞日数で縛る案も利用者に却下された（1〜2話完結の作品があり、
// X投稿の「今日の配信」から外すのが目的なので7週間・21日は遅すぎる）。
// そこで**完結したら表記が変わる情報源**だけを見る。推定は一切しない。
//
// 信号は2つ。どちらも「無い」は「完結していない」ではなく「分からない」として扱う。
//  ① dアニメストアの作品ページの「（全N話）」。dアニメが完結と判断した作品にだけ付く
//    （2026-10-18実測: 289作品で表記と JSON-LD の numberOfEpisodes が完全に一致、
//    放送中の作品に付いていた例は0件。全1話の作品にも付く）。
//  ② しょぼいカレンダーの番組の「終」フラグ（Flag の 4 のビット。
//    https://docs.cal.syoboi.jp/spec/proginfo-flag/ ）。最終回の枠に人が付ける印で、
//    放送前に付くことが多い（2026夏で69作品中59作品が24時間以上前）＝**最終話の時刻ちょうどに
//    切り替えられる**。作品の対応は Annict の syobocalTid（推測不要）。
// ───────────────────────────────────────────────────────────────

const { normalizeTitle } = require("./upcoming-match.js");

// ── ② しょぼいカレンダー ─────────────────────────────────────

// db.php の XML（1行に詰まっている）から ProgItem を取り出す。依存を増やさないため
// 正規表現で読む（タグは固定・入れ子なし）。
function parseSyoboiPrograms(xml) {
  const out = [];
  const items = String(xml || "").match(/<ProgItem[\s>][\s\S]*?<\/ProgItem>/g) || [];
  for (const it of items) {
    const get = (k) => {
      const m = it.match(new RegExp(`<${k}>([\\s\\S]*?)</${k}>`));
      return m ? m[1].trim() : "";
    };
    out.push({
      tid: Number(get("TID")),
      chId: Number(get("ChID")),
      stTime: get("StTime"),
      stOffset: Number(get("StOffset") || 0),
      count: get("Count"),
      flag: Number(get("Flag") || 0),
      deleted: get("Deleted") === "1",
    });
  }
  return out;
}

// "2026-09-17 00:06:00"（JST）＋StOffset秒 → ISO（UTC）。読めなければ null。
function syoboiTimeToIso(stTime, stOffset = 0) {
  const m = String(stTime).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5], +m[6]) + (Number(stOffset) || 0) * 1000;
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

const FLAG_FINAL = 4; // 終
const FLAG_RERUN = 8; // 再

// 1作品（TID）分の番組から最終回を決める。決められなければ { final: null, reason }。
// 採用の条件はすべて必要（2026-10-18の反証で見つかった壊れ方を1つずつ塞いでいる）:
//  - Deleted でない・再放送（Flag 8）でない
//  - 話数（Count）が数字（「ABEMA限定先行配信版 #12」や「#7～#12」の一挙放送を除くため）
//  - 「終」の付いた枠の話数がすべて同じで、どのチャンネルの話数もそれを超えない
//    （FX戦士くるみちゃん: ABEMAの#12に「終」、AT-Xに#13 → 決められない＝完結にしない）
// 時刻は「終」の付いた枠のいちばん早いもの（ABEMA等の配信チャンネルも含む）。
function syoboiFinal(programs) {
  const live = programs.filter((p) => !p.deleted && !(p.flag & FLAG_RERUN));
  const numeric = live.filter((p) => /^\d+$/.test(p.count));
  const finals = numeric.filter((p) => p.flag & FLAG_FINAL);
  if (finals.length === 0) return { final: null, reason: "終フラグなし" };
  const counts = new Set(finals.map((p) => Number(p.count)));
  if (counts.size > 1) return { final: null, reason: `終フラグの話数が食い違う（${[...counts].join("/")}）` };
  const finalCount = [...counts][0];
  const maxCount = Math.max(...numeric.map((p) => Number(p.count)));
  if (maxCount > finalCount) return { final: null, reason: `終フラグ（#${finalCount}）より先の話数（#${maxCount}）がある` };
  const times = finals.map((p) => syoboiTimeToIso(p.stTime, p.stOffset)).filter(Boolean).sort();
  if (times.length === 0) return { final: null, reason: "終フラグの時刻が読めない" };
  return { final: { finalCount, finalAt: times[0] }, reason: null };
}

// ── ① dアニメストア ──────────────────────────────────────────

// dアニメの題名は同じ作品を【規制解除版】【TV放送版】などで複数のIDに分けることがある。
// 末尾の【…】だけ落として比べる（「第2期」「Ⅱ」のような期数の表記は落とさない＝
// 続編を前の期と取り違えない。upcoming-match.js の normalizeTitle と同じ考え方）。
function normalizeDanimeTitle(title) {
  return normalizeTitle(String(title || "").replace(/(【[^】]*】)+\s*$/, ""));
}

// Annictの作品名と**正規化後に完全一致**するdアニメの作品だけを候補にする。部分一致は
// しない（「うまゆる ふるげ～と！」→旧作「うまゆる（全24話）」、「桃源暗鬼 特別編集版」→
// 「桃源暗鬼（全24話）」のように、別作品の「全N話」で誤って完結になるため）。
function danimeCandidates(annictTitle, workList) {
  const key = normalizeTitle(annictTitle);
  if (!key) return [];
  return workList.filter((w) => normalizeDanimeTitle(w.title) === key);
}

// 作品ページ（ci_pc）のHTMLから「（全N話）」を読む。h1の中の表記と JSON-LD の
// numberOfEpisodes が**両方そろったときだけ**数を返す（片方だけ＝ページの形が変わった
// 可能性があるので信じない）。
function parseDanimeEpisodes(html) {
  const s = String(html || "");
  const h1 = s.match(/<h1>[^<]*<span>（全(\d+)話）<\/span><\/h1>/);
  const ld = s.match(/"numberOfEpisodes"\s*:\s*"?(\d+)"?/);
  if (!h1 || !ld) return null;
  if (h1[1] !== ld[1]) return null;
  const n = Number(h1[1]);
  return n > 0 ? n : null;
}

// 本サイトのクール → dアニメの cours（WS000118 の引数。2026秋＝202604）。
const COURS_INDEX = { winter: "01", spring: "02", summer: "03", autumn: "04" };
function danimeCours(seasonStr) {
  const [y, s] = String(seasonStr).split("-");
  return COURS_INDEX[s] ? `${y}${COURS_INDEX[s]}` : null;
}

module.exports = {
  parseSyoboiPrograms,
  syoboiTimeToIso,
  syoboiFinal,
  normalizeDanimeTitle,
  danimeCandidates,
  parseDanimeEpisodes,
  danimeCours,
  FLAG_FINAL,
  FLAG_RERUN,
};
