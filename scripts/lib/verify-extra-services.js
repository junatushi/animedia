"use strict";
// ───────────────────────────────────────────────────────────────
// 配信先の自動補完を、マージ前に機械で裏取りする（2026-10-04導入）
//
// 【なぜ要るか】
// 配信先0件の作品（scripts/coverage-gaps.js が毎日Issueに出す）は、毎日の定期実行の
// Claudeが一次情報を調べて content/works/extraServices.ts に足す（docs/coverage-autofill.md）。
// しかし**調べた本人の申告をそのまま本番に出すと誤登録が起きうる**。実際に2026-10-04の
// 手作業の調査で、次の2つの罠に当たった:
//   - ルルットリリィの公式サイトの配信欄は「第2クール」のもので、Annictの #18233
//     （第1クールの総集編）には当てはまらない（総集編はYouTubeだけ）
//   - ゴールデンカムイの公式サイトの配信欄は「最終章」のもので、「暴走列車編」の告知ではない
// どちらも**ページにサービス名は確かに書いてある**ので、「出典にサービス名があるか」だけを
// 見る検査では素通りする。共通点は「その作品の名前（全文）がページに無い」こと。
//
// 【何を確かめるか】（1件でも外れたら自動マージしない＝人が見る）
//   1. 出典URLがhttpsで、一次情報でないと分かっている場所（X・Wikipedia・AniList・
//      個人ブログ・動画ページ等）ではない
//   2. 出典ページを**取り直して**、抜き書き（evidence）がそのまま実在する
//   3. 抜き書きにそのサービスの名前が入っている
//   4. ページに**作品名の全文**（Annictの題名）があり、しかも抜き書きの近く（PROXIMITY文字以内）にある
//   5. 作品が今期・次期の「配信先0件」の作品である（Annictが既に持つ作品を触らない）
//   6. 曜日・時刻（schedule）を付けていない（カレンダーに出る＝放送開始前ルールに関わるので人が見る）
//   7. 既存の行を消したり書き換えたりしていない（追加だけ）
// 確認済みの除外（scripts/lib/coverage-acknowledged.js）の追加は、理由に出典URLがあり、
// 再確認の期日が62日以内のときだけ通す（除外は画面に何も出さないが、長く隠すと欠損を見落とす）。
//
// ここに置くのは純粋関数だけ。取得とファイルの読み書きは scripts/verify-extra-services.ts。
// ───────────────────────────────────────────────────────────────

// 抜き書きと作品名の距離の上限（正規化後の文字数）。公式サイトの1ページに複数のシーズンが
// 並ぶ場合に、別シーズンの配信欄を拾うのを防ぐ。広すぎると効かず、狭すぎると正しい出典を落とす
// （落ちるぶんには人が見るだけなので、迷ったら狭い側に倒す）。
const PROXIMITY = 1500;
const EVIDENCE_MIN = 8;
const EVIDENCE_MAX = 400;
const ACK_MAX_DAYS = 62;
const CONFIRMED_MAX_AGE_DAYS = 7;

// 一次情報ではない／一次情報の確認に使えない場所。ここに無い場所でも、上の2〜4を満たさなければ通らない。
const BLOCKED_HOST = [
  /(^|\.)x\.com$/,
  /(^|\.)twitter\.com$/,
  /(^|\.)wikipedia\.org$/,
  /(^|\.)anilist\.co$/,
  /(^|\.)myanimelist\.net$/,
  /(^|\.)justwatch\.com$/,
  /(^|\.)filmarks\.com$/,
  /(^|\.)annict\.com$/,
  /(^|\.)note\.com$/,
  /(^|\.)ameblo\.jp$/,
  /(^|\.)hatenablog\.(com|jp)$/,
  /(^|\.)hateblo\.jp$/,
  /(^|\.)fc2\.com$/,
  /(^|\.)livedoor\.(blog|jp)$/,
  /(^|\.)blog\.jp$/,
  /(^|\.)uzurea\.net$/,
  /(^|\.)youtube\.com$/,
  /(^|\.)youtu\.be$/,
  /(^|\.)tiktok\.com$/,
  /(^|\.)instagram\.com$/,
  /(^|\.)facebook\.com$/,
  /(^|\.)google\.[a-z.]+$/,
  /(^|\.)yahoo\.co\.jp$/, // 転載（出典は転載元を使う）
  /(^|\.)github\.com$/,
  /(^|\.)animedia-khaki\.vercel\.app$/,
];

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", yen: "¥", copy: "©", hellip: "…", mdash: "—", ndash: "–" };

/** HTML → 可視テキスト（scriptとstyleを落とし、タグを空白にし、実体参照を戻す）。 */
function htmlToText(html) {
  return String(html)
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

/** 照合用の正規化: 全角半角・大文字小文字・空白・記号の揺れを全部落とし、文字と数字だけ残す。 */
function normText(s) {
  return String(s).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** lib/services.ts の norm と同じ（SERVICES の match はこの形に対して書かれている）。 */
function normForService(s) {
  return String(s)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[ー－―‐]/g, "-");
}

/** 抜き書きがそのサービスの名前を含むか。 */
function evidenceNamesService(evidence, svc) {
  if (!svc) return false;
  const n = normForService(evidence);
  if (svc.match && svc.match.test(n)) return true;
  return [svc.name, svc.short, svc.kana].filter(Boolean).some((x) => n.includes(normForService(x)));
}

const toDay = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;

/** EXTRA_SERVICES の前後を比べる。行の同一性は「作品ID × サービス」。 */
function diffExtraServices(base, head) {
  const flat = (obj) => {
    const m = new Map();
    for (const [workId, list] of Object.entries(obj || {})) {
      for (const e of list || []) m.set(`${workId}:${e.key}`, { workId: String(workId), entry: e });
    }
    return m;
  };
  const b = flat(base);
  const h = flat(head);
  const added = [];
  const removed = [];
  const changed = [];
  for (const [k, v] of h) {
    if (!b.has(k)) added.push(v);
    else if (JSON.stringify(b.get(k).entry) !== JSON.stringify(v.entry)) changed.push(v);
  }
  for (const [k, v] of b) if (!h.has(k)) removed.push(v);
  return { added, removed, changed };
}

/** 確認済みの除外の前後を比べる。消す（＝一覧に戻す）のは安全側なので数えるだけ。 */
function diffAcknowledged(base, head) {
  const b = new Map((base || []).map((a) => [String(a.id), a]));
  const added = [];
  const changed = [];
  for (const a of head || []) {
    const old = b.get(String(a.id));
    if (!old) added.push(a);
    else if (JSON.stringify(old) !== JSON.stringify(a)) changed.push(a);
  }
  const headIds = new Set((head || []).map((a) => String(a.id)));
  const removed = (base || []).filter((a) => !headIds.has(String(a.id)));
  return { added, changed, removed };
}

/** 出典URLの形だけで分かる問題。 */
function checkSourceUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return ["出典URLとして読めない"];
  }
  const problems = [];
  if (u.protocol !== "https:") problems.push("出典URLがhttpsではない");
  if (BLOCKED_HOST.some((re) => re.test(u.hostname))) problems.push(`一次情報として使わない場所（${u.hostname}）`);
  return problems;
}

/**
 * 追加された1行を、取り直した出典ページと突き合わせる。問題の一覧を返す（空なら合格）。
 * @param p.workId   作品ID
 * @param p.entry    ExtraServiceEntry
 * @param p.work     first-seen.json の作品（今期・次期で見つからなければ null）
 * @param p.svc      SERVICES の定義（無ければ null）
 * @param p.pageText 出典ページの可視テキスト（取れなければ null）
 * @param p.today    JSTの "YYYY-MM-DD"
 */
function checkAddedEntry({ entry, work, svc, pageText, today }) {
  const problems = [];
  if (!work) problems.push("今期・次期の作品として記録されていない（scripts/track-season.js の記録に無い）");
  else if (Object.keys(work.services || {}).length > 0) problems.push("Annict側に配信先が既にある作品（補完の対象外）");
  if (!svc) problems.push(`SERVICES に無いサービス（${entry.key}）`);
  if (entry.schedule) problems.push("曜日・時刻（schedule）は自動では通さない（カレンダーに出るので人が確かめる）");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.confirmedDate || "")) problems.push("confirmedDate が YYYY-MM-DD ではない");
  else {
    const age = toDay(today) - toDay(entry.confirmedDate);
    if (age < 0 || age > CONFIRMED_MAX_AGE_DAYS) problems.push(`confirmedDate が今日から${CONFIRMED_MAX_AGE_DAYS}日以内ではない`);
  }
  problems.push(...checkSourceUrl(entry.sourceUrl));
  const ev = typeof entry.evidence === "string" ? entry.evidence : "";
  if (ev.length < EVIDENCE_MIN || ev.length > EVIDENCE_MAX) {
    problems.push(`抜き書き（evidence）が無いか長さが範囲外（${EVIDENCE_MIN}〜${EVIDENCE_MAX}文字）`);
    return problems;
  }
  if (svc && !evidenceNamesService(ev, svc)) problems.push(`抜き書きに「${svc.name}」の名前が無い`);
  if (pageText == null) {
    problems.push("出典ページを取得できなかった");
    return problems;
  }
  const page = normText(pageText);
  const evN = normText(ev);
  const evAt = page.indexOf(evN);
  if (evAt < 0) problems.push("抜き書きが出典ページに見つからない（写し間違い・別のページ）");
  const titleN = work ? normText(work.title) : "";
  if (work && titleN.length > 0) {
    const hits = [];
    for (let i = page.indexOf(titleN); i >= 0; i = page.indexOf(titleN, i + 1)) hits.push(i);
    if (hits.length === 0) problems.push(`出典ページに作品名の全文「${work.title}」が無い（別の作品・別のシーズンの告知の疑い）`);
    else if (evAt >= 0) {
      const dist = Math.min(
        ...hits.map((i) => (i + titleN.length <= evAt ? evAt - (i + titleN.length) : i >= evAt + evN.length ? i - (evAt + evN.length) : 0))
      );
      if (dist > PROXIMITY) problems.push(`作品名と抜き書きが離れすぎている（${dist}文字。上限${PROXIMITY}）`);
    }
  }
  return problems;
}

/** 追加・変更された確認済みの除外の検査。 */
function checkAck(a, today) {
  const problems = [];
  if (!/https:\/\/\S+/.test(a.reason || "")) problems.push("理由に出典URLが無い");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.recheckOn || "")) problems.push("recheckOn が YYYY-MM-DD ではない");
  else {
    const d = toDay(a.recheckOn) - toDay(today);
    if (d <= 0 || d > ACK_MAX_DAYS) problems.push(`recheckOn が明日から${ACK_MAX_DAYS}日以内ではない`);
  }
  return problems;
}

module.exports = {
  PROXIMITY,
  ACK_MAX_DAYS,
  htmlToText,
  normText,
  evidenceNamesService,
  diffExtraServices,
  diffAcknowledged,
  checkSourceUrl,
  checkAddedEntry,
  checkAck,
};
