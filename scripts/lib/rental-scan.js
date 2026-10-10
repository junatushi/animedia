"use strict";
// ───────────────────────────────────────────────────────────────
// 「見放題ではなく課金（都度課金・レンタル）」の配信先の洗い出し（2026-10-10導入）
//
// 【なぜ要るか】
// 2026秋「転生したら剣でしたII」（10258）は、公式サイトの配信情報が
// 「ABEMA（地上波1週間先行・独占配信）」と「＜個別課金サービス＞ dアニメストア・Hulu・
// Prime Video・DMM TV・FOD・バンダイチャンネル ほか」に分かれているのに、作品ページは
// 7社を同じ枠に並べていた＝**課金が要るサービスを見放題と同じ顔で案内していた**。
// 分ける仕組み（content/works/rentalServices.ts → lib/services.ts の splitRentalServices）は
// 2026-07-09からあったが、記録は2026夏の作品だけで、**新しいクールの作品を調べる道具が
// 無かった**（coverage-gaps.js の導入理由と同じ穴。仕組みがあっても「何を足すべきか」が
// 出なければ誰も足さない）。
//
// 【何をするか】
// 公式サイトの配信情報ページを行ごとのテキストにし、見出しで「課金の区画」と
// 「それ以外の区画」に分けて、**課金の区画にだけ現れるサービス**を拾う。
// 判定の考え方は content/works/rentalServices.ts の冒頭（2026-07-10）に合わせる:
//   - 「見放題」と「各話購入」の両方に載るサービス（バンダイチャンネル・Prime Video に多い）は
//     レンタル扱いにしない ＝ 課金の区画**以外**に一度でも出たら対象外
//   - 「dアニメストア for Prime Video」「dアニメストア ニコニコ支店」は dアニメのブランド展開
//     ＝ lib/services.ts の classifyChannel と同じ判定順（dアニメが先）で自動的に dアニメになる
//
// 【やらないこと】
// rentalServices.ts を自動で書き換えない。ここが出すのは「調べる候補」と抜き書き（evidence）
// だけで、追加するのは公式サイトを見て確かめた人（または日次巡回のセッション）。
// 見出しの言い回しはサイトごとに違い、画像だけの配信表もあるので、拾えなかった作品を
// 「課金なし」とは言わない（「読めなかった」と数えて出す）。
// ───────────────────────────────────────────────────────────────

// 課金の区画を始める見出し。「レンタル」は Blu-ray のレンタル開始告知とも重なるが、
// 配信情報ページだけを読むので許容する（誤検出は人が見て捨てる。見落とすよりよい）。
const PAY_HEADING =
  /(個別課金|都度課金|都度購入|各話課金|各話購入|単話購入|単品購入|話数課金|都度レンタル|レンタル配信|レンタル|ペイパービュー|\bPPV\b|TVOD)/i;
// 課金でない区画を始める見出し。「独占配信」「先行配信」は見放題とは書いていないが、
// 課金の見出しより前に置かれる主配信の見出しとして実際に使われている（転剣II）。
const FREE_HEADING = /(見放題|定額|月額|サブスク|無料|見逃し配信|独占配信|先行配信|同時配信|SVOD)/i;
// 配信の区画が終わる見出し（放送局の表や商品情報に入ったら、どちらの区画でもない）。
// 行全体が見出し語のときだけ（「music.jp」のような配信サービス名で区画を閉じないため。
// 転剣IIの公式で、課金の区画の途中にある music.jp で区画が閉じ、FOD・バンダイチャンネルを取りこぼした）。
const END_HEADING =
  /^(放送情報|放送局|放送スケジュール|TV放送|テレビ放送|BD|Blu-?ray|DVD|CD|MUSIC|NEWS|STAFF|CAST|STAFF ?& ?CAST|INTRODUCTION|STORY|CHARACTERS?|SPECIAL|GOODS)$/i;
// 見出しとみなす行の長さの上限（本文の長い文の中の「レンタル」で区画を切り替えない）。
const HEADING_MAX_LEN = 40;

// 配信サービスのリンク先ドメイン → classifyChannel が読める名前。
// 配信表がロゴ画像だけで alt も空のサイト（ドラゴンボール超 ビルス）では、リンク先しか
// 手がかりが無い。ここに無いドメインは何も足さない（推測で名前を作らない）。
const SERVICE_DOMAINS = [
  [/(^|\.)b-ch\.com$/, "バンダイチャンネル"],
  [/^animestore\.docomo\.ne\.jp$/, "dアニメストア"],
  [/(^|\.)abema\.tv$/, "ABEMA"],
  [/^fod\.fujitv\.co\.jp$/, "FOD"],
  [/^tv\.dmm\.com$/, "DMM TV"],
  [/(^|\.)hulu\.jp$/, "Hulu"],
  [/(^|\.)netflix\.com$/, "Netflix"],
  [/(^|\.)nicovideo\.jp$/, "ニコニコ"],
  [/(^|\.)(amazon\.co\.jp|primevideo\.com)$/, "Prime Video"],
  [/(^|\.)unext\.jp$/, "U-NEXT"],
  [/(^|\.)disneyplus\.(disney\.co\.jp|com)$/, "Disney+"],
  [/^lemino\.docomo\.ne\.jp$/, "Lemino"],
  [/(^|\.)telasa\.jp$/, "TELASA"],
  [/^wod\.wowow\.co\.jp$/, "WOWOWオンデマンド"],
  [/(^|\.)animehodai\.jp$/, "アニメ放題"],
];

function serviceNameForHref(href) {
  let host;
  try {
    host = new URL(href).host.toLowerCase();
  } catch {
    return null;
  }
  for (const [re, name] of SERVICE_DOMAINS) if (re.test(host)) return name;
  return null;
}

/** HTML → 行ごとのテキスト。画像の alt（配信サービスのロゴ）と、配信サービスへのリンク先も行として残す。 */
function htmlToLines(html) {
  let t = String(html);
  t = t.replace(/<!--[\s\S]*?-->/g, "");
  t = t.replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, "");
  // リンク先で名前を補うのは、リンクの中に文字も alt も無いときだけ。文字があるリンクは
  // 文字のほうが正しい（「dアニメストア ニコニコ支店」は nicovideo.jp へのリンクだが dアニメ。
  // 転生した大聖女・百妖譜で、リンク先からニコニコを足して見放題に数えてしまった）。
  t = t.replace(/<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi, (m, _q, a, b, inner) => {
    const visible = inner.replace(/<img\b[^>]*?\balt\s*=\s*("([^"]*)"|'([^']*)')[^>]*>/gi, " $2$3 ").replace(/<[^>]+>/g, " ").trim();
    if (visible) return m;
    const name = serviceNameForHref(decodeEntities(a ?? b ?? ""));
    return name ? `\n${name}\n${inner}` : m;
  });
  t = t.replace(/<img\b[^>]*?\balt\s*=\s*("([^"]*)"|'([^']*)')[^>]*>/gi, (_m, _q, a, b) => `\n${a ?? b ?? ""}\n`);
  t = t.replace(/<br\s*\/?>/gi, "\n");
  t = t.replace(/<\/?(p|div|li|ul|ol|dl|dt|dd|tr|td|th|table|h[1-6]|section|article|header|footer|span|a|strong|em|b)\b[^>]*>/gi, "\n");
  t = t.replace(/<[^>]+>/g, " ");
  t = decodeEntities(t);
  return t
    .split(/\n/)
    .map((l) => l.replace(/[\s　]+/g, " ").trim())
    .filter(Boolean);
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)));
}

/**
 * 公式サイトのトップから、配信情報が載っていそうな同一ホストのページを選ぶ。
 * 1作品あたりの取得数を抑えるため上限つき（相手のサイトに負荷を掛けない）。
 */
function findStreamingPages(html, baseUrl, limit = 3) {
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const out = [];
  const seen = new Set([stripHash(base.href)]);
  const re = /<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html)))) {
    const href = m[2] ?? m[3] ?? "";
    const text = decodeEntities(m[4].replace(/<img\b[^>]*?\balt\s*=\s*"([^"]*)"[^>]*>/gi, " $1 ").replace(/<[^>]+>/g, " "));
    const looks =
      /(on_?air|onair|broadcast|streaming|haishin|vod|distribution)/i.test(href) ||
      /(ON ?AIR|放送・配信|配信情報|放送情報|配信)/i.test(text);
    if (!looks) continue;
    let u;
    try {
      u = new URL(href, base);
    } catch {
      continue;
    }
    if (u.host !== base.host || !/^https?:$/.test(u.protocol)) continue;
    const key = stripHash(u.href);
    if (seen.has(key)) continue;
    seen.add(key);
    // URLが配信情報らしいページを先に取る（トップのニュース記事「配信決定」に枠を取られて
    // 肝心の /onair/ が上限からこぼれるのを防ぐ。転生した大聖女で実際に起きた）。
    const strong = /(on_?air|onair|streaming|haishin|vod)/i.test(u.pathname);
    out.push({ href: key, strong });
  }
  return out
    .sort((a, b) => Number(b.strong) - Number(a.strong))
    .slice(0, limit)
    .map((o) => o.href);
}

function stripHash(href) {
  return href.replace(/#.*$/, "");
}

/**
 * 行ごとのテキストから、課金の区画にだけ現れるサービスを拾う。
 * @param lines     htmlToLines の結果（複数ページぶんを連結してよい。ページの境目には null を挟む）
 * @param classify  (name) => サービスkey | null（lib/services.ts の classifyChannel を包んだもの）
 * @returns { payOnly: string[], other: string[], sawPayHeading: boolean, evidence: string[] }
 */
function classifySections(lines, classify) {
  // ページごとに数える。課金の見出しがあるページ（＝配信情報の表）の中だけで
  // 「課金の区画にしか無いか」を決める。トップページのニュース欄の「ABEMAほかで配信決定」の
  // ような言及まで「課金以外の区画に載っていた」に数えると、本物の課金専用を打ち消してしまう。
  const pages = [[]];
  for (const line of lines) {
    if (line === null) pages.push([]);
    else pages[pages.length - 1].push(line);
  }
  const payOnly = new Set();
  const other = new Set();
  const evidence = [];
  let sawPayHeading = false;
  for (const page of pages) {
    for (const block of splitBlocks(page)) {
      const r = scanPage(block.lines, classify);
      if (!r.sawPayHeading) continue;
      sawPayHeading = true;
      const only = [...r.pay].filter((k) => !r.other.has(k));
      only.forEach((k) => payOnly.add(k));
      r.other.forEach((k) => other.add(k));
      if (only.length && block.title) evidence.push(`【${block.title}】`);
      evidence.push(...r.evidence);
    }
  }
  return { payOnly: [...payOnly].sort(), other: [...other].sort(), sawPayHeading, evidence: uniq(evidence).slice(0, 40) };
}

// 1ページに複数のシリーズ・編の配信表が並ぶ形（東京リベンジャーズは「8・3抗争編」〜「三天戦争編」
// の5つ）を、「〜配信情報」の見出しで区切る。区切らずに1つの表として読むと、旧作の表で
// 見放題に載っているサービスが、最新作の表では課金だけ、という形を打ち消してしまう
// （三天戦争編は Disney+ 以外の全社が都度課金なのに、2社しか拾えなかった）。
// 「見放題配信サービス」のような区画の見出しでは区切らない（二重掲載の判定が壊れる）。
const BLOCK_HEADING = /配信情報/;
function splitBlocks(lines) {
  const blocks = [{ title: null, lines: [] }];
  for (const line of lines) {
    if (line.length <= HEADING_MAX_LEN && BLOCK_HEADING.test(line) && !PAY_HEADING.test(line) && !FREE_HEADING.test(line)) {
      blocks.push({ title: line, lines: [] });
      continue;
    }
    blocks[blocks.length - 1].lines.push(line);
  }
  return blocks;
}

function scanPage(lines, classify) {
  const pay = new Set();
  const other = new Set();
  const evidence = [];
  let state = "none";
  let sawPayHeading = false;
  for (const line of lines) {
    const short = line.length <= HEADING_MAX_LEN;
    // 1行の中に「サービス名 ※都度課金配信」と注記がある形（鬼の花嫁）は、その行だけ課金。
    const inlinePay = /※.{0,12}(都度課金|個別課金|レンタル|各話購入)/.test(line);
    const found = servicesIn(line, classify);
    if (short && found.length === 0) {
      if (PAY_HEADING.test(line)) {
        state = "pay";
        sawPayHeading = true;
        evidence.push(line);
        continue;
      }
      if (FREE_HEADING.test(line)) {
        state = "free";
        continue;
      }
      if (END_HEADING.test(line)) {
        state = "none";
        continue;
      }
    }
    if (found.length === 0) continue;
    // 見出しとサービス名が同じ行にある形（「見放題：dアニメストア、ABEMA」）は、その行の見出しに従う。
    let lineState = state;
    if (inlinePay) lineState = "pay";
    else if (/[:：]/.test(line)) {
      const head = line.split(/[:：]/)[0];
      if (PAY_HEADING.test(head)) lineState = "pay";
      else if (FREE_HEADING.test(head)) lineState = "free";
    }
    for (const { key, paren } of found) {
      // 「YouTube（レンタル配信）」のように、そのサービスだけ括弧で課金と書いてある形。
      const isPay = lineState === "pay" || PAY_HEADING.test(paren);
      if (isPay) {
        pay.add(key);
        sawPayHeading = true;
        evidence.push(line);
      } else other.add(key);
    }
  }
  return { pay, other, sawPayHeading, evidence };
}

// 1行に複数のサービスが並ぶ形（「dアニメストア、Hulu、Prime Video」）を区切ってから判定する。
// 空白では区切らない（「dアニメストア for Prime Video」を dアニメと Prime の2つにしないため）。
function servicesIn(line, classify) {
  const out = [];
  for (const chunk of line.split(/[、,，・/／|｜]/)) {
    const paren = (chunk.match(/[（(][^）)]*[）)]/g) || []).join("");
    const c = chunk.replace(/[（(][^）)]*[）)]/g, "").trim();
    if (!c || c.length > 40) continue;
    // 「dアニメストア ニコニコ支店」「dアニメストア for Prime Video」が2行に割れて
    // 「ニコニコ支店」「for Prime Video」だけの行になる形（転生した大聖女）。dアニメのブランド展開。
    const key = /ニコニコ支店|^for ?prime ?video$/i.test(c) ? "d_anime" : classify(c);
    if (key && !out.some((o) => o.key === key)) out.push({ key, paren });
  }
  return out;
}

function uniq(a) {
  return [...new Set(a)];
}

/**
 * 作品ごとの判定。
 * @param work       { id, title, services: string[], officialSiteUrl }
 * @param scan       classifySections の結果（読めなかったときは null）
 * @param recorded   rentalServices.ts に記録済みの key の配列（無ければ undefined）
 */
function judgeWork(work, scan, recorded) {
  const rec = new Set(recorded ?? []);
  if (!scan) return { kind: "unread", work };
  const onWork = new Set(work.services);
  // Annict にまだ無いサービスは、課金の区画にあっても作品ページに出ていない＝分ける対象が無い。
  const candidates = scan.payOnly.filter((k) => onWork.has(k));
  const missing = candidates.filter((k) => !rec.has(k));
  // 記録済みなのに、公式サイトでは課金でない区画に載っている＝記録が古い／誤りの疑い。
  const contradicted = [...rec].filter((k) => scan.other.includes(k) && !scan.payOnly.includes(k));
  if (missing.length > 0 || contradicted.length > 0) {
    return { kind: "gap", work, missing, contradicted, evidence: scan.evidence };
  }
  return { kind: scan.sawPayHeading ? "ok-pay" : "ok", work, payOnly: scan.payOnly, other: scan.other, evidence: scan.evidence };
}

/** Issue本文（Markdown）。対応が要るものが0件なら空文字。 */
function renderIssue({ gaps, unread, scanned, seasons, today }) {
  if (gaps.length === 0) return "";
  const L = [];
  L.push(`公式サイトの配信情報で**課金（都度課金・レンタル）の区画にだけ**載っているのに、`);
  L.push(`作品ページで見放題と同じ枠に並んでいるサービスがあります（${today}・${seasons.join("／")}・${scanned}作品を確認）。`);
  L.push("");
  L.push(`**自動では直しません。** 公式サイトを開いて確かめ、正しければ`);
  L.push("`content/works/rentalServices.ts` に出典つきで足してください（手順は同ファイルの冒頭）。");
  L.push("「見放題」と「各話購入」の**両方**に載っているサービスは足さないこと。");
  L.push("");
  for (const g of gaps) {
    L.push(`### ${g.work.title}（[${g.work.id}](https://animedia-khaki.vercel.app/anime/${g.work.id})）`);
    if (g.work.officialSiteUrl) L.push(`- 公式: ${g.work.officialSiteUrl}`);
    if (g.ackReason) L.push(`- 再確認の期日が来た除外（前回の理由）: ${g.ackReason}`);
    if (g.missing.length) L.push(`- 課金の区画にだけある（未記録）: \`${g.missing.join("`, `")}\``);
    if (g.contradicted.length)
      L.push(`- 記録済みだが課金以外の区画にも載っている（記録の見直し）: \`${g.contradicted.join("`, `")}\``);
    if (g.evidence.length) {
      L.push("- 抜き書き:");
      for (const e of g.evidence.slice(0, 8)) L.push(`  - ${e.replace(/[`<>]/g, "")}`);
    }
    L.push("");
  }
  if (unread.length) {
    L.push(`<details><summary>公式サイトを読めなかった作品 ${unread.length}件（課金の有無は不明。「無い」とは扱わない）</summary>`);
    L.push("");
    for (const u of unread) L.push(`- ${u.work.title}（${u.work.id}）${u.reason ? `: ${u.reason}` : ""}`);
    L.push("");
    L.push("</details>");
  }
  return L.join("\n");
}

module.exports = {
  htmlToLines,
  findStreamingPages,
  classifySections,
  judgeWork,
  renderIssue,
  PAY_HEADING,
  FREE_HEADING,
};
