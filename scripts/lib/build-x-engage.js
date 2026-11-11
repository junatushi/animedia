// Xの「2本目」の投稿（2026-11-08導入）。
//
// 【なぜ作ったか】Xは2026-08-16から1日1投稿（その曜日の放送・配信一覧）で運用してきた。
// 表示は1投稿あたり約200出るようになったが、フォロワーは2週間35のまま増えなかった
// （docs/x-analytics.md）。利用者の判断（2026-11-08）で**1日2投稿**に変え、2本目は
// 「X上で実際に反応が集まっている投稿の構成」を真似た型からランダムに選ぶ。
// シャドウバンの検証も兼ねる（2投稿にして表示が落ちないか）。
//
// 【型の出どころ】2026-11-07にXの検索で集めた実例59件（「秋アニメ」いいね1000以上・
// 「今期アニメ」返信30以上）。**リプライが多い投稿ほど「問いかけで終わる」**構成だった:
//   ・「今期アニメ何見てる？教えて！」だけの短い問い（返信160〜200／表示約3,000）
//   ・「この◯本しか見てない、おすすめある？」＋作品の列挙（返信50前後／表示2〜4万）
//   ・ランキングTOP5＋「みんなの1位は？」（ニコニコの今期ランキングで返信45・RT429）
//   ・「◯◯なアニメ◯選！みんなはどれが好き？」（返信91・いいね1,590）
// 型ごとの対応は ENGAGE_KINDS のコメントに書いてある。
//
// 【書いてよいこと・書かないこと】（利用者の指定・2026-11-08）
//   ・**主観による評価はしない**（面白い/神作/おすすめ/覇権 を私たちが言わない）。
//     tier表・個人の評価の型は真似しない。
//   ・**みんなの1位・ランキングを聞くのはよい**（評価するのは答える側）。
//   ・数字・作品名・配信サービス名は /api/season の実データだけ。創作しない。
//   ・放送が終わった作品（前期）に「配信中」と書かない（CLAUDE.mdの基本ルール）。
//   ・本文にURLは入れない（Xの方針。リプライ用のURLを replyUrl で対に持つ）。
//   ・ハッシュタグは季節タグ1個だけ。
//   ・無料体験・加入を勧める文言は書かない（アフィリエイトは凍結中）。
//
// 【ランダムだが再現できる】Math.random() は使わない。同じ日なら何度生成しても同じ型
// （再実行で別の本文が出ると、どれを投稿したか分からなくなる）。日付から決まる並びで選び、
// **前日と同じ型は出さない**（似た投稿の連続もBOT扱いの原因になる。2026-10-20の利用者の指摘）。
const { SITE_URL } = require("./build-digest");
const { fitsX, truncateForX, fitTitleForX, weightOf, X_LINE_WEIGHT } = require("./x-text");

// 型の一覧。表示名は下書きIssueの見出しに出る。
const ENGAGE_KINDS = [
  // 「今期アニメ何見てる？」— リプ率がいちばん高かった型。作品は並べない（短さが効いている）。
  "ask-count",
  // 「ランキングTOP5＋みんなの1位は？」
  "top5-vote",
  // 「◯◯なアニメ◯選！みんなはどれ？」をサービス別にしたもの。
  "service-pick",
  // 同じ型の独占配信版。
  "exclusive-pick",
  // 同じ型の声優版（出演作の列挙＋印象に残った役は？）。
  "cast-pick",
  // 「この◯本しか見てない、おすすめある？」の裏返し。前期の作品を並べて「一気見するなら？」。
  "binge-prev",
];
const ENGAGE_LABEL = {
  "ask-count": "今期何本見てる？（問いかけ）",
  "top5-vote": "注目作TOP5＋みんなの1位は？",
  "service-pick": "サービス別◯選＋どれ見てる？",
  "exclusive-pick": "独占配信◯選＋どれ見てる？",
  "cast-pick": "声優の今期出演作＋印象に残った役は？",
  "binge-prev": "前期アニメ、一気見するなら？",
};

// 選び方の起点。ここから1日ずつ「前日と違う型」を順に決める（前日の型を参照するため）。
const ENGAGE_EPOCH = "2026-11-01";

function daysSinceEpoch(todayStr) {
  return Math.floor(Date.parse(`${todayStr}T00:00:00Z`) / 86400000);
}
function dateOfDays(n) {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}
// 0〜(2^32-1)の決定的なハッシュ（FNV-1a）。型の並びを日ごとに混ぜるためだけに使う。
// FNV-1aだけだと末尾1文字違いの入力（日付が1日違い）で値が似て、並びが2種類の交互に
// 偏った（実測）。最後に攪拌（murmur3 の fmix）を掛けて散らす。
function hash32(s) {
  let h = 0x811c9dc5;
  for (const ch of s) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
// その日の型の並び（先頭ほど優先）。
function engageOrder(todayStr) {
  return [...ENGAGE_KINDS].sort((a, b) => hash32(`${todayStr}:${a}`) - hash32(`${todayStr}:${b}`) || (a < b ? -1 : 1));
}
// データの欠けを考えない「その日の型」。**直近3日に出た型を避けて**並びの先頭を取る
// （前日と違うだけだと2種類の交互に偏りうる。6種類のうち3種類は毎日候補に残るので、
// 並びは読めないまま、同じ型は最短でも4日に1回まで）。
const ENGAGE_AVOID_RECENT = 3;
const idealCache = new Map();
function idealEngageKind(todayStr) {
  if (idealCache.has(todayStr)) return idealCache.get(todayStr);
  const start = daysSinceEpoch(ENGAGE_EPOCH);
  const end = daysSinceEpoch(todayStr);
  const recent = [];
  for (let n = Math.min(start, end); n <= end; n++) {
    const d = dateOfDays(n);
    const kind = idealCache.get(d) ?? engageOrder(d).find((k) => !recent.includes(k));
    idealCache.set(d, kind);
    recent.push(kind);
    if (recent.length > ENGAGE_AVOID_RECENT) recent.shift();
  }
  return idealCache.get(todayStr);
}
// 実際に出す型。その型のデータが無い日（独占配信が0本など）は、並びの次の型へ落とす。
// 落とす先でも前日の型は避ける。どれも作れなければ null（＝2本目は出ない）。
function chooseEngageKind(todayStr, available, exclude = []) {
  const prevDay = dateOfDays(daysSinceEpoch(todayStr) - 1);
  const prev = daysSinceEpoch(prevDay) >= daysSinceEpoch(ENGAGE_EPOCH) ? idealEngageKind(prevDay) : null;
  const ideal = idealEngageKind(todayStr);
  const ok = (k) => available.includes(k) && !exclude.includes(k);
  if (ok(ideal)) return ideal;
  return engageOrder(todayStr).find((k) => ok(k) && k !== prev) ?? engageOrder(todayStr).find(ok) ?? null;
}

// 言い回しは型ごとに3つ以上用意し、登場回数で回す（毎回同じ文面にしない）。
function variant(list, todayStr, key) {
  return list[(daysSinceEpoch(todayStr) + hash32(key)) % list.length];
}

// 作品名1行。Xで長すぎる作品名は2行以内に省略する（build-digest.js の titleFor と同じ基準）。
// compact のときは1行に収める（行数を減らせない一覧＝TOP5で上限を超えたとき用）。
function titleLine(prefix, title, suffix = "", compact = false) {
  return `${prefix}${fitTitleForX(title, weightOf(prefix + suffix) + (compact ? X_LINE_WEIGHT : 0))}${suffix}`;
}

// 一覧の行を下から落として上限（Xの重み280）に収める。minRows まで落としても超えるときは
// 作品名を1行に縮める（build(rows, compact)）。末尾で切るとハッシュタグが千切れるので、
// truncateForX は最後の手段。
function fitRows(build, rows, minRows = 1) {
  for (const compact of [false, true]) {
    for (let n = rows.length; n >= minRows; n--) {
      const text = build(rows.slice(0, n), compact).join("\n");
      if (fitsX(text)) return text;
    }
  }
  return truncateForX(build(rows.slice(0, minRows), true).join("\n"));
}

const byWatchers = (a, b) => b.watchers - a.watchers;

// 放送開始前の作品は「見ている？」と聞けないので外す（放送開始1週間前ルールと同じ趣旨）。
function started(it, todayStr) {
  return !it.broadcastStartDate || it.broadcastStartDate <= todayStr;
}

// ① 今期何本見てる？
function buildAskCount(ctx) {
  const { data, year, label, seasonUrl, todayStr, tag } = ctx;
  const n = data.count;
  if (!n) return null;
  const lines = variant(
    [
      [`${year}年${label}アニメ、いま何本見ていますか？`, "", `このサイトで扱っている今期の作品は${n}本。`, "追いかけている作品があれば教えてください。"],
      [`今期アニメ、何本追いかけてますか？`, "", `${year}年${label}アニメは${n}作品を一覧にしています。`, "見ている作品をリプで教えてください。"],
      [`${label}アニメ、何から見てますか？`, "", `今期の作品は${n}本。`, "いま見ている作品があれば教えてください。"],
    ],
    todayStr,
    "ask-count"
  );
  return { kind: "ask-count", text: truncateForX([...lines, tag].join("\n")), replyUrl: seasonUrl };
}

// ② 注目作TOP5＋みんなの1位は？（注目人数はAnnictの「見たい/見てる」登録数＝事実）
function buildTop5Vote(ctx) {
  const { data, year, label, todayStr, tag, rankingUrl } = ctx;
  const top = data.items.filter((it) => started(it, todayStr)).sort(byWatchers).slice(0, 5);
  if (top.length < 3) return null;
  const head = variant(
    [`${year}年${label}アニメ 注目人数TOP${top.length}`, `今期アニメの注目人数ランキング（${label}）`, `【${label}アニメ】いま注目人数が多い${top.length}作品`],
    todayStr,
    "top5-vote:head"
  );
  const ask = variant(
    ["みんなの今期1位はどれですか？", "あなたの今期1位は？この中以外でもどうぞ。", "この中にあなたの1位はありますか？"],
    todayStr,
    "top5-vote:ask"
  );
  const build = (rows, compact) => [
    head,
    "",
    ...rows.map((it, i) => titleLine(`${i + 1}. `, it.title, `（${it.watchers.toLocaleString("ja-JP")}人）`, compact)),
    "",
    ask,
    tag,
  ];
  // TOP5と書いた以上、5本より減らさない（減らすなら見出しの数字と食い違う）。
  return { kind: "top5-vote", text: fitRows(build, top, top.length), replyUrl: rankingUrl };
}

// 配信サービスごとの今期の作品（注目人数順）。
function servicesByCount(items) {
  const m = new Map();
  for (const it of items) {
    for (const s of it.services || []) {
      const cur = m.get(s.key) || { key: s.key, name: s.name, short: s.short || s.name, items: [] };
      cur.items.push(it);
      m.set(s.key, cur);
    }
  }
  return [...m.values()].sort((a, b) => b.items.length - a.items.length);
}

// ③ ◯◯で見られる今期アニメ◯選＋どれ見てる？（サービスは上位6社を日替わりで）
function buildServicePick(ctx) {
  const { data, year, season, label, todayStr, tag } = ctx;
  const svcs = servicesByCount(data.items.filter((it) => started(it, todayStr))).filter((s) => s.items.length >= 3).slice(0, 6);
  if (svcs.length === 0) return null;
  const svc = svcs[(daysSinceEpoch(todayStr) + hash32("service-pick")) % svcs.length];
  const rows = [...svc.items].sort(byWatchers).slice(0, 5);
  const ask = variant(
    ["この中で見ている作品はありますか？", `${svc.short}で見ている今期アニメ、ほかにもあれば教えてください。`, "どれを見ていますか？"],
    todayStr,
    "service-pick:ask"
  );
  // 正式名は見出しの1回だけ。2回目以降は略称（Amazon Prime Video → Prime）にして一覧の行を残す。
  const build = (r, compact) => [
    `${svc.name}で見られる${year}年${label}アニメ${r.length}選（注目人数順）`,
    "",
    ...r.map((it) => titleLine("・", it.title, "", compact)),
    "",
    `今期は${svc.items.length}作品が${svc.short}の配信対象。`,
    ask,
    tag,
  ];
  return {
    kind: "service-pick",
    text: fitRows(build, rows, 3),
    replyUrl: `${SITE_URL}/service/${svc.key}/${year}/${season}`,
  };
}

// ④ ここでしか見られない今期アニメ◯選（配信サービスが1社だけの作品）
function buildExclusivePick(ctx) {
  const { data, year, label, todayStr, tag, exclusiveUrl } = ctx;
  const rows = data.items
    .filter((it) => started(it, todayStr) && (it.services || []).length === 1)
    .sort(byWatchers)
    .slice(0, 5);
  if (rows.length < 3) return null;
  // 見出しの本数は実際に載った行数から作る（上限で行を落としたとき「5選」に4本、を防ぐ）。
  const head = variant(
    [(n) => `配信が1社だけの${year}年${label}アニメ${n}選`, (n) => `【独占配信】${label}アニメ、ここでしか見られない${n}作品`, () => `${year}年${label}アニメの独占配信（注目人数順）`],
    todayStr,
    "exclusive-pick:head"
  );
  const ask = variant(
    ["この中で見ている作品はありますか？", "どれを見ていますか？", "独占配信で見ている今期アニメがあれば教えてください。"],
    todayStr,
    "exclusive-pick:ask"
  );
  const build = (r, compact) => [head(r.length), "", ...r.map((it) => titleLine("・", it.title, `（${it.services[0].short}）`, compact)), "", ask, tag];
  return { kind: "exclusive-pick", text: fitRows(build, rows, 3), replyUrl: exclusiveUrl };
}

// ⑤ 声優◯◯さんの今期出演作＋印象に残った役は？
// 声優ページ（/person/）が存在するのは今期2作品以上の人。一覧として成り立つよう3作品以上に絞る。
function buildCastPick(ctx) {
  const { data, year, season, label, todayStr, tag } = ctx;
  const works = new Map();
  for (const it of data.items.filter((x) => started(x, todayStr))) {
    for (const name of it.castNames || []) {
      const arr = works.get(name) || [];
      arr.push(it);
      works.set(name, arr);
    }
  }
  const weight = (arr) => arr.reduce((s, it) => s + it.watchers, 0);
  const eligible = [...works.entries()]
    .filter(([, arr]) => arr.length >= 3)
    .sort((a, b) => weight(b[1]) - weight(a[1]) || (a[0] < b[0] ? -1 : 1))
    .slice(0, 12);
  if (eligible.length === 0) return null;
  const [name, arr] = eligible[(daysSinceEpoch(todayStr) + hash32("cast-pick")) % eligible.length];
  const rows = [...arr].sort(byWatchers).slice(0, 5);
  const ask = variant(
    ["印象に残っている役はどれですか？", "この中で見ている作品はありますか？", "どの作品で声を聞きましたか？"],
    todayStr,
    "cast-pick:ask"
  );
  const build = (r, compact) => [
    `${name}さんの${year}年${label}アニメ出演作（${arr.length}作品）`,
    "",
    ...r.map((it) => titleLine("・", it.title, "", compact)),
    ...(arr.length > r.length ? [`ほか${arr.length - r.length}作品`] : []),
    "",
    ask,
    tag,
  ];
  return {
    kind: "cast-pick",
    text: fitRows(build, rows, 2),
    replyUrl: `${SITE_URL}/person/${encodeURIComponent(name)}/${year}/${season}`,
  };
}

// ⑥ 前期アニメ、一気見するならどれから？（prevData＝前のクールの /api/season）
// 放送が終わったクールなので「配信中」とは書かない（配信情報があることも本文では言わない）。
function buildBingePrev(ctx) {
  const { prev, todayStr, tag } = ctx;
  if (!prev || !prev.data || !Array.isArray(prev.data.items)) return null;
  const rows = prev.data.items
    .filter((it) => (it.services || []).length > 0 && it.media !== "MOVIE")
    .sort(byWatchers)
    .slice(0, 5);
  if (rows.length < 3) return null;
  const head = variant(
    [`前期（${prev.year}年${prev.label}）のアニメ、まとめて見るならどれから？`, `${prev.label}アニメを一気見するなら、どれから見ますか？`, `${prev.year}年${prev.label}アニメ、見逃した作品はありますか？`],
    todayStr,
    "binge-prev:head"
  );
  const build = (r, compact) => [
    head,
    "",
    `${prev.label}アニメの注目人数TOP${r.length}`,
    ...r.map((it, i) => titleLine(`${i + 1}. `, it.title, "", compact)),
    "",
    "まとめて見たい作品があれば教えてください。",
    tag,
  ];
  return { kind: "binge-prev", text: fitRows(build, rows, rows.length), replyUrl: prev.seasonUrl };
}

const BUILDERS = {
  "ask-count": buildAskCount,
  "top5-vote": buildTop5Vote,
  "service-pick": buildServicePick,
  "exclusive-pick": buildExclusivePick,
  "cast-pick": buildCastPick,
  "binge-prev": buildBingePrev,
};

// 前のクール（冬の前は前年の秋）。
function previousSeason(year, season) {
  const order = ["winter", "spring", "summer", "autumn"];
  const labels = { winter: "冬", spring: "春", summer: "夏", autumn: "秋" };
  const i = order.indexOf(season);
  const key = i === 0 ? "autumn" : order[i - 1];
  return { year: i === 0 ? year - 1 : year, key, label: labels[key] };
}

// その日の2本目を作る。exclude は1本目と同じ内容になる型（1本目がTOP5の日の top5-vote）。
// 純粋関数（ネットワークに出ない）。prev は呼び出し側が取ってきた前期のデータ（取れなければ null）。
function buildEngagePost({ data, year, season, label, todayStr, prev = null, exclude = [] }) {
  const ctx = {
    data,
    year,
    season,
    label,
    todayStr,
    prev,
    tag: `#${year}年${label}アニメ`,
    seasonUrl: `${SITE_URL}/season/${year}/${season}`,
    rankingUrl: `${SITE_URL}/rankings/${year}/${season}`,
    exclusiveUrl: `${SITE_URL}/exclusive/${year}/${season}`,
  };
  const built = {};
  for (const k of ENGAGE_KINDS) {
    if (!exclude.includes(k)) built[k] = BUILDERS[k](ctx);
  }
  const available = Object.keys(built).filter((k) => built[k]);
  const kind = chooseEngageKind(todayStr, available, exclude);
  return kind ? { ...built[kind], label: ENGAGE_LABEL[kind] } : null;
}

module.exports = {
  ENGAGE_KINDS,
  ENGAGE_LABEL,
  ENGAGE_EPOCH,
  idealEngageKind,
  chooseEngageKind,
  buildEngagePost,
  previousSeason,
  BUILDERS,
};
