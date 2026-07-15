// アニメ配信の「需要シグナル」を集計する中核ロジック（決定論的・ネットワーク非依存）。
// 収集そのものは Claude(WebSearch) 側が担い、その生ヒット(JSONL)を入力に受け取る。
// ここでは次を行う: 直近N日フィルタ / URL重複排除 / 需要タイプ分類 /
//   作品名・配信サービス名の抽出 / 集計・スコアリング。
//
// 入力の生ヒット1件のスキーマ（scripts/demand-scan.js が JSONL の1行として読む）:
//   {
//     "source":  "x" | "chiebukuro" | "5ch" | "reddit" | "matome" | "web",
//     "url":     "https://...",              // 重複排除キー
//     "title":   "検索結果のタイトル",
//     "snippet": "本文抜粋（分類・抽出の対象）",
//     "date":    "2026-07-14" | null,        // 分かる範囲でJSTの日付。null可
//     "query":   "収集に使った検索クエリ"       // 任意。追跡用
//   }
//
// 「直近1週間」の扱い: date が分かるヒットは windowDays より古ければ落とす。
// date が null（WebSearchの抜粋は日付を伴わないことが多い）のものは「不明」として残し、
// dateUnknown フラグを立てる。推測で日付を埋めない（CLAUDE.mdの方針）。

// 配信サービスの正準リスト。match は「正規化後（小文字・空白除去）」の文字列に当てる。
// lib/services.ts の SERVICES とは別に、SNS上の口語表記（ネトフリ/アマプラ等）まで拾えるよう
// この集計専用に薄く持つ。増やすときはここに1行足す。
const SERVICES = [
  { key: "dアニメストア", match: /dアニメ(ストア)?|danime|ｄアニメ/ },
  { key: "Netflix", match: /netflix|ネトフリ|ネットフリックス/ },
  { key: "U-NEXT", match: /u-?next|ユーネクスト/ },
  { key: "Amazon Prime Video", match: /prime\s?video|プライムビデオ|アマプラ|amazonプライム|アマゾンプライム/ },
  { key: "ABEMA", match: /abema|アベマ/ },
  { key: "Disney+", match: /disney\+|ディズニープラス|ディズニー\+/ },
  { key: "Hulu", match: /hulu|フールー/ },
  { key: "DMM TV", match: /dmm\s?tv|dmmtv/ },
  { key: "Lemino", match: /lemino|レミノ/ },
  { key: "バンダイチャンネル", match: /バンダイチャンネル|バンチャ/ },
  { key: "FOD", match: /\bfod\b|フジテレビオンデマンド/ },
  { key: "ニコニコ", match: /ニコニコ|niconico|ニコ動/ },
  { key: "Crunchyroll", match: /crunchyroll|クランチロール/ },
  { key: "TELASA", match: /telasa|テラサ/ },
  { key: "WOWOW", match: /wowow|ワウワウ/ },
];

// 需要タイプの判定に使うキーワード群（正規化後の文字列に対して）。
// (A) 作品の配信先の困りごと: 「この作品どこで見れる？／配信されてない」等
const WHERE_TO_WATCH = [
  /どこ(で|に)?(見|観|視聴|配信)/,
  /(見|観|視聴)(れ|られ)?ない/,
  /どのサブスク/,
  /サブスク.{0,4}どこ/,
  /配信.{0,4}(どこ|ある\?|されて(ない|る\?)|予定|なし|未定)/,
  /見放題.{0,4}どこ/,
  /見逃し(配信)?/,
  /独占配信/,
  /視聴方法/,
  /地上波.{0,4}(ない|なし|放送な)/,
];
// (B) 配信サービスへの需要: 「〇〇に入るべき？／解約したい／どのサービスがいい」等
const SERVICE_DEMAND = [
  /(加入|契約|登録|入っ?|入る|課金)(すべき|した(い|方)|しようか|するか|迷)/,
  /(解約|退会|やめ)(すべき|した(い|方)|ようか|るか|迷)/,
  /おすすめ.{0,6}(サブスク|配信|サービス)/,
  /(サブスク|配信サービス).{0,6}(おすすめ|どれ|比較|迷)/,
  /どの(サブスク|配信サービス|サービス).{0,4}(いい|おすすめ|安い|お得)/,
  /(値上げ|コスパ|乗り換え|一番いい|どれがいい)/,
  /(最速|見放題|安い|無料).{0,8}(配信|サブスク|アプリ|サイト|サービス)/,
  /(配信|動画)(サイト|アプリ|サービス).{0,6}(どこ|おすすめ|教え|ある|安い)/,
];

function normalize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)) // 全角英数→半角
    .replace(/\s+/g, " ")
    .trim();
}

function matchAny(patterns, text) {
  const hit = [];
  for (const re of patterns) if (re.test(text)) hit.push(re.source);
  return hit;
}

// 「」『』《》""＂ で囲まれた作品タイトル候補を拾う。タイトル辞書が無くても動くように、
// SNS投稿でよく使われる引用符ベースの抽出をデフォルトにする。titlesDict を渡すと
// 引用符無しでも辞書一致で拾う（例: シーズン作品タイトルの配列）。
function extractWorks(rawText, titlesDict) {
  const works = new Set();
  const quoted = rawText.match(/[「『《""＂]([^」』》""＂]{2,40})[」』》""＂]/g) || [];
  for (const q of quoted) {
    const inner = q.replace(/^[「『《""＂]|[」』》""＂]$/g, "").trim();
    // 引用符内が需要フレーズそのもの（作品名でない）を弾く軽いガード
    if (inner && !/^(どこ|配信|見れ|サブスク|おすすめ)/.test(inner)) works.add(inner);
  }
  if (Array.isArray(titlesDict)) {
    for (const t of titlesDict) {
      if (t && t.length >= 2 && rawText.includes(t)) works.add(t);
    }
  }
  return [...works];
}

function extractServices(normText) {
  const found = [];
  for (const s of SERVICES) if (s.match.test(normText)) found.push(s.key);
  return found;
}

// date(YYYY-MM-DD等) を JST基準の経過日数に。null/不正は null を返す。
function ageInDays(dateStr, nowMs) {
  if (!dateStr) return null;
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return null;
  return Math.floor((nowMs - t) / (24 * 60 * 60 * 1000));
}

const SOURCE_WEIGHT = {
  chiebukuro: 1.3, // 明示的な「困りごと」質問で需要が濃い
  x: 1.0,
  reddit: 1.0,
  "5ch": 0.9,
  web: 0.8,
  matome: 0.5, // まとめ記事は需要というより供給側情報
};

// 生ヒット配列を集計する。opts: { windowDays=7, nowMs, titlesDict, top=20 }
function analyze(rawHits, opts = {}) {
  const windowDays = opts.windowDays ?? 7;
  const nowMs = opts.nowMs ?? Date.parse("1970-01-01"); // 呼び出し側で必ず渡す想定（決定性のため）
  const titlesDict = opts.titlesDict;

  const seenUrl = new Set();
  const kept = [];
  let droppedOld = 0;
  let droppedDup = 0;

  for (const h of rawHits) {
    if (!h || !h.url) continue;
    if (seenUrl.has(h.url)) {
      droppedDup++;
      continue;
    }
    seenUrl.add(h.url);

    const age = ageInDays(h.date, nowMs);
    if (age !== null && age > windowDays) {
      droppedOld++;
      continue;
    }

    const rawText = `${h.title || ""} ${h.snippet || ""}`;
    const norm = normalize(rawText);
    const whereSignals = matchAny(WHERE_TO_WATCH, norm);
    const serviceSignals = matchAny(SERVICE_DEMAND, norm);
    const services = extractServices(norm);
    const works = extractWorks(rawText, titlesDict);

    kept.push({
      source: h.source || "web",
      url: h.url,
      title: h.title || "",
      snippet: h.snippet || "",
      date: h.date || null,
      dateUnknown: age === null,
      age,
      query: h.query || null,
      whereSignals,
      serviceSignals,
      services,
      works,
    });
  }

  // 集計: 配信サービス需要（サービス名 × 需要シグナル）
  const serviceMap = new Map();
  // 集計: 作品の配信先の困りごと（作品名 × 「どこで見れる」系シグナル）
  const workMap = new Map();

  for (const h of kept) {
    const weight = SOURCE_WEIGHT[h.source] ?? 0.8;

    // サービス需要: サービス名があり、かつ需要 or 困りごとシグナルのどちらかがある
    if (h.services.length && (h.serviceSignals.length || h.whereSignals.length)) {
      for (const svc of h.services) {
        const e = serviceMap.get(svc) || { key: svc, score: 0, mentions: 0, signals: new Set(), hits: [] };
        e.score += weight;
        e.mentions += 1;
        [...h.serviceSignals, ...h.whereSignals].forEach((s) => e.signals.add(s));
        e.hits.push({ url: h.url, title: h.title, date: h.date, source: h.source });
        serviceMap.set(svc, e);
      }
    }

    // 作品の困りごと: 作品名があり、かつ「どこで見れる」系シグナルがある
    if (h.works.length && h.whereSignals.length) {
      for (const w of h.works) {
        const e = workMap.get(w) || { key: w, score: 0, mentions: 0, signals: new Set(), hits: [] };
        e.score += weight;
        e.mentions += 1;
        h.whereSignals.forEach((s) => e.signals.add(s));
        e.hits.push({ url: h.url, title: h.title, date: h.date, source: h.source });
        workMap.set(w, e);
      }
    }
  }

  const finalize = (map) =>
    [...map.values()]
      .map((e) => ({ ...e, signals: [...e.signals] }))
      .sort((a, b) => b.score - a.score || b.mentions - a.mentions || a.key.localeCompare(b.key));

  const serviceDemand = finalize(serviceMap);
  const workWhereToWatch = finalize(workMap);

  // どちらにも入らなかった（需要シグナルはあるが作品/サービスを特定できない等）ヒット。
  // 手動レビュー用に残す。
  const classifiedUrls = new Set([
    ...serviceDemand.flatMap((e) => e.hits.map((x) => x.url)),
    ...workWhereToWatch.flatMap((e) => e.hits.map((x) => x.url)),
  ]);
  const unclassified = kept
    .filter((h) => !classifiedUrls.has(h.url))
    .map((h) => ({ url: h.url, title: h.title, date: h.date, source: h.source, hasSignal: !!(h.whereSignals.length || h.serviceSignals.length) }));

  const top = opts.top ?? 20;
  return {
    windowDays,
    totalRawHits: rawHits.length,
    keptHits: kept.length,
    droppedOld,
    droppedDup,
    unknownDateHits: kept.filter((h) => h.dateUnknown).length,
    serviceDemand: serviceDemand.slice(0, top),
    workWhereToWatch: workWhereToWatch.slice(0, top),
    unclassified,
  };
}

module.exports = {
  analyze,
  normalize,
  matchAny,
  extractWorks,
  extractServices,
  ageInDays,
  SERVICES,
  WHERE_TO_WATCH,
  SERVICE_DEMAND,
  SOURCE_WEIGHT,
};
