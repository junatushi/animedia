// 「アニメ視聴ガイドを今まさに必要としている人」を見つけるリード発掘 CLI。
// demand-scan（需要の集計）とは出力単位が違い、こちらは "個別リード（この投稿・この作品）＋
// そのまま貼れる返信案" を出す。接触（投稿・リプ・回答）は手動で行う前提の材料づくり。
//
// 位置づけ: 週次X成長キット（scripts/lib/build-growth-kit.js）のリーチ枠は今は「検索クエリ」を
// 配るだけで、実在する困りごと投稿を見つけて相手の作品に合わせて返すところは手動。ここを埋める
// エンジン。まず知恵袋（ToSクリーン・WebSearch到達可）で検証し、良ければX向けに転用する。
//
// 収集/集計の分離（demand-scan と同じ思想。理由も同じ）:
//   - 収集は Claude(WebSearch) が行い content/demand/raw/<日付>.jsonl に保存。
//   - 「回答受付中か（開/閉）」は node からは確認できない（WebFetchはClaude側ツール）。収集時に
//     Claude が各スレを確認して生ヒットに status を書く。CLIは status で絞る/表示するだけ。
//
// 入力の生ヒット（demand-scan の raw と同形＋任意の status）:
//   { source, url, title, snippet, date, query, status?: "open"|"closed"|null }
//
// 使い方:
//   node scripts/lead-finder.js [rawFile ...]   … 省略時は content/demand/raw の最新1本
//   オプション:
//     --days N       直近N日でフィルタ（既定7。dateが分かるヒットのみ古いと除外）
//     --open-only    status が "closed" のものを除外（回答受付中だけに絞る）
//     --site URL     リンク先サイト（既定 https://animedia-khaki.vercel.app / env LEAD_SITE_URL）
//     --no-net       /api/search-index を叩かない（作品→/anime/{id}解決をしない）
//     --out PATH     Markdownの保存先（既定 docs/leads-<今日>.md）
//     --json PATH    リードJSONの保存先（既定 content/demand/out/leads-<今日>.json）
//     --now ISO      「現在時刻」を固定（再現・テスト用）
//     --titles PATH  作品タイトル辞書（引用符無しでも作品名を拾う。--no-net時の補助）
//
// リンクには ?ref=<source> を付ける（Vercel Analyticsの参照元で流入を実測するため）。
const { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } = require("node:fs");
const { join, dirname } = require("node:path");
const {
  normalize,
  matchAny,
  extractWorks,
  extractServices,
  ageInDays,
  WHERE_TO_WATCH,
  SERVICE_DEMAND,
  SOURCE_WEIGHT,
} = require("./lib/demand-analyze");

const ROOT = join(__dirname, "..");
const RAW_DIR = join(ROOT, "content", "demand", "raw");
const OUT_DIR = join(ROOT, "content", "demand", "out");
const DOCS_DIR = join(ROOT, "docs");
const DEFAULT_SITE = process.env.LEAD_SITE_URL || "https://animedia-khaki.vercel.app";

function parseArgs(argv) {
  const o = { files: [], days: undefined, openOnly: false, site: DEFAULT_SITE, noNet: false, out: undefined, json: undefined, now: undefined, titles: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--open-only") o.openOnly = true;
    else if (a === "--no-net") o.noNet = true;
    else if (a === "--days") o.days = Number(argv[++i]);
    else if (a === "--site") o.site = argv[++i];
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--json") o.json = argv[++i];
    else if (a === "--now") o.now = argv[++i];
    else if (a === "--titles") o.titles = argv[++i];
    else if (a.startsWith("--")) throw new Error(`未知のオプション: ${a}`);
    else o.files.push(a);
  }
  return o;
}

function jstDateStr(nowMs) {
  return new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function latestRawFile() {
  if (!existsSync(RAW_DIR)) return null;
  const files = readdirSync(RAW_DIR).filter((f) => f.endsWith(".jsonl")).sort();
  return files.length ? join(RAW_DIR, files[files.length - 1]) : null;
}

function readJsonl(path) {
  const out = [];
  readFileSync(path, "utf8").split("\n").forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    try {
      out.push(JSON.parse(t));
    } catch (e) {
      console.error(`  ! ${path}:${i + 1} をJSONとして読めずスキップ: ${e.message}`);
    }
  });
  return out;
}

function loadTitles(path) {
  if (!path || !existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8").trim();
  if (text.startsWith("[")) return JSON.parse(text);
  return text.split("\n").map((s) => s.trim()).filter(Boolean);
}

// /api/search-index を1回だけ叩き、作品名→{id,title} 解決用のインデックスを作る。
// 失敗しても致命的にはせず、解決なし（generic リンク）で続行する。
async function loadWorkIndex(site) {
  try {
    const res = await fetch(`${site}/api/search-index`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // 長いタイトル優先で当てるため、title長の降順に並べておく。
    return (data.entries || [])
      .filter((e) => e && e.title && e.id)
      .sort((a, b) => b.title.length - a.title.length);
  } catch (e) {
    console.error(`  ! search-index を取得できませんでした（${e.message}）。作品→ページ解決なしで続行します。`);
    return null;
  }
}

// インデックスのタイトルから照合キーを作る。フルタイトルに加え、季節マーカー（Ⅱ/2期/
// 第N期/シーズンN）や末尾の副題括弧を落とした「ベースタイトル」も作る。これで「幼女戦記2期」→
// 「幼女戦記Ⅱ」のような表記差を吸収する。逆に副題を落とし過ぎて別作品に誤爆しないよう、
// スペース前の“頭”だけの緩い一致（例:「名探偵コナン ○○」→「名探偵コナン」）はあえて採らない
// （広範な質問は個別ページより安全にトップへフォールバックさせる）。4文字未満のキーは誤爆防止で除外。
function indexKeys(title) {
  const keys = new Set([title]);
  const base = title
    .replace(/[ⅠⅡⅢⅣⅤ]+$/, "")
    .replace(/\s*[（(【\[].*$/, "")
    .replace(/(第[0-9０-９一二三四五六七八九十]+期|[0-9０-９]+期|シーズン\s*[0-9]+|season\s*[0-9]+)$/i, "")
    .trim();
  if (base && base.length >= 4) keys.add(base);
  return [...keys].filter((k) => k.length >= 4);
}

// rawText 中に含まれる既知作品を1件解決する（フル/ベースタイトル一致）。index は title 長の
// 降順で渡ってくるので、より具体的（長い）な作品を優先する。
function resolveWork(rawText, quotedWorks, index) {
  if (index) {
    for (const e of index) {
      for (const key of indexKeys(e.title)) {
        if (rawText.includes(key)) return { id: e.id, title: e.title };
      }
    }
    for (const w of quotedWorks) {
      const hit = index.find((e) => e.title === w || (w.length >= 4 && e.title.includes(w)));
      if (hit) return { id: hit.id, title: hit.title };
    }
  }
  // 解決できなくても、引用符から拾えた作品名があれば返信の主語に使う。
  return quotedWorks.length ? { id: null, title: quotedWorks[0] } : null;
}

// リード種別と、そのまま貼れる返信下書きを作る。
// 断定しない（「配信中です」ではなくページに誘導）＝放送開始前ルール/誤誘導回避の思想に準拠。
function buildReply(lead, site) {
  const ref = `?ref=${encodeURIComponent(lead.source)}`;
  const w = lead.work;
  if (w && w.id) {
    return `「${w.title}」がどこで配信されているかは、配信サービス別に一覧でまとめています。よければ参考にどうぞ👉 ${site}/anime/${w.id}${ref}`;
  }
  if (w && w.title) {
    return `「${w.title}」を含め、今期アニメがどこで見られるかを配信サービス別に一覧にしています。よければ参考に👉 ${site}/${ref}`;
  }
  if (lead.type === "サービス選び") {
    return `今期アニメを「どの配信サービスで見られるか」作品ごとに一覧で比較できるサイトを作っています。サービス選びの参考にどうぞ👉 ${site}/${ref}`;
  }
  return `今期アニメの配信先をサービス別に一覧にしています。よければ参考に👉 ${site}/${ref}`;
}

function classifyType(whereSignals, serviceSignals, works) {
  if (!whereSignals.length && !serviceSignals.length) return null; // リードでない
  // 作品名が取れて「どこで見れる」系がある → 作品配信先（最も行動につながる）。
  if (whereSignals.length && works.length) return "作品配信先";
  // 両シグナルが立つときは強い方で判定。サービス比較の語が優勢なら「サービス選び」、
  // 「どこで見れる」が同等以上なら特定作品を探している「作品配信先」とみなす。
  if (serviceSignals.length > whereSignals.length) return "サービス選び";
  if (whereSignals.length) return "作品配信先";
  return "サービス選び";
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const nowMs = opts.now ? Date.parse(opts.now) : Date.now();
  if (Number.isNaN(nowMs)) throw new Error(`--now が解釈できません: ${opts.now}`);
  const windowDays = opts.days ?? 7;

  const files = opts.files.length ? opts.files : [latestRawFile()].filter(Boolean);
  if (!files.length) {
    console.error("集計対象の生JSONLがありません。node scripts/demand-scan.js --print-queries の手順で");
    console.error(`${RAW_DIR} に <日付>.jsonl を用意してください（status フィールド任意）。`);
    process.exit(1);
  }

  const rawHits = files.flatMap((f) => (existsSync(f) ? readJsonl(f) : (console.error(`  ! 見つかりません: ${f}`), [])));
  const titlesDict = loadTitles(opts.titles);
  const index = opts.noNet ? null : await loadWorkIndex(opts.site);

  const seenUrl = new Set();
  const leads = [];
  let droppedOld = 0, droppedDup = 0, droppedClosed = 0, notLead = 0;

  for (const h of rawHits) {
    if (!h || !h.url) continue;
    if (seenUrl.has(h.url)) { droppedDup++; continue; }
    seenUrl.add(h.url);

    const age = ageInDays(h.date, nowMs);
    if (age !== null && age > windowDays) { droppedOld++; continue; }

    const status = h.status || null;
    if (opts.openOnly && status === "closed") { droppedClosed++; continue; }

    const rawText = `${h.title || ""} ${h.snippet || ""}`;
    const norm = normalize(rawText);
    const whereSignals = matchAny(WHERE_TO_WATCH, norm);
    const serviceSignals = matchAny(SERVICE_DEMAND, norm);
    const works = extractWorks(rawText, titlesDict);
    const services = extractServices(norm);

    const type = classifyType(whereSignals, serviceSignals, works);
    if (!type) { notLead++; continue; }

    const work = resolveWork(rawText, works, index);
    const lead = {
      type,
      source: h.source || "web",
      url: h.url,
      title: h.title || "",
      snippet: h.snippet || "",
      date: h.date || null,
      dateUnknown: age === null,
      status,
      work, // { id, title } | null
      services,
      intent: whereSignals.length + serviceSignals.length,
    };
    lead.reply = buildReply(lead, opts.site);
    // スコア: 出典重み ＋ 困りごとの強さ ＋ 作品ページに解決できた ＋ 回答受付中
    lead.score =
      (SOURCE_WEIGHT[lead.source] ?? 0.8) +
      lead.intent * 0.5 +
      (work && work.id ? 1 : 0) +
      (status === "open" ? 0.5 : 0);
    leads.push(lead);
  }

  leads.sort((a, b) => b.score - a.score || b.intent - a.intent || a.url.localeCompare(b.url));

  // --- 出力: JSON ---
  const jsonPath = opts.json || join(OUT_DIR, `leads-${jstDateStr(nowMs)}.json`);
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(
    jsonPath,
    JSON.stringify(
      { generatedAt: new Date(nowMs).toISOString(), site: opts.site, sourceFiles: files, windowDays, totalRawHits: rawHits.length, leadCount: leads.length, droppedDup, droppedOld, droppedClosed, notLead, leads },
      null,
      2
    ) + "\n",
    "utf8"
  );

  // --- 出力: Markdown（docs/leads-<日付>.md） ---
  const md = renderMarkdown(leads, { nowMs, windowDays, totalRawHits: rawHits.length, droppedDup, droppedOld, droppedClosed, notLead, site: opts.site, jsonPath });
  const mdPath = opts.out || join(DOCS_DIR, `leads-${jstDateStr(nowMs)}.md`);
  mkdirSync(dirname(mdPath), { recursive: true });
  writeFileSync(mdPath, md, "utf8");

  // --- 標準出力: サマリ ---
  console.log(`リード ${leads.length} 件（入力${rawHits.length} / 重複${droppedDup} / 期間外${droppedOld} / 解決済み除外${droppedClosed} / 非リード${notLead}）`);
  console.log(`  作品配信先: ${leads.filter((l) => l.type === "作品配信先").length} 件 / サービス選び: ${leads.filter((l) => l.type === "サービス選び").length} 件`);
  console.log(`  作品ページに解決できたリード: ${leads.filter((l) => l.work && l.work.id).length} 件`);
  console.log(`→ Markdown: ${mdPath}`);
  console.log(`→ JSON:     ${jsonPath}`);
}

function shortText(s, n) {
  const chars = [...(s || "")];
  return chars.length <= n ? s : chars.slice(0, n - 1).join("") + "…";
}

function renderMarkdown(leads, meta) {
  const dateStr = jstDateStr(meta.nowMs);
  const out = [];
  out.push(`# 流入リード候補（アニメ視聴ガイドを必要としている人）— ${dateStr}`);
  out.push("");
  out.push(
    `直近${meta.windowDays}日の公開投稿から、「アニメの配信先が分からない／どのサービスがいい」で困っている人を拾い、` +
      `相手の作品に合わせた**返信下書き**を添えた候補一覧です。接触（回答・リプ）は**手動**で行います。`
  );
  out.push("");
  out.push("> 使い方の注意:");
  out.push("> - **1スレッド＝自然な文脈でリンク1本まで**（宣伝的だと削除・凍結リスク）。まず役立つ回答→末尾に1回だけ。");
  out.push("> - 貼る直前に**サイトで最新の配信先を確認**（配信情報は後から追加されうる）。断定表現は避ける。");
  out.push("> - リンクの `?ref=<媒体>` は流入計測用。消さずに貼ると Vercel Analytics の参照元で効果が見える。");
  out.push("> - 自動投稿・自動フォロー・スクレイピングはしない（ToS遵守。`docs/x-growth-playbook.md` の方針）。");
  out.push("");
  out.push(
    `入力 ${meta.totalRawHits} 件 → リード ${leads.length} 件` +
      `（重複除外 ${meta.droppedDup} / 期間外 ${meta.droppedOld} / 解決済み除外 ${meta.droppedClosed} / 非リード ${meta.notLead}）`
  );
  out.push("");

  if (!leads.length) {
    out.push("（今回はリードが見つかりませんでした。収集クエリ・期間・status を見直してください。）");
    return out.join("\n") + "\n";
  }

  // 概要テーブル
  out.push("## 候補一覧");
  out.push("");
  out.push("| # | 種別 | 媒体 | 状態 | 作品 | 困りごと |");
  out.push("|---|---|---|---|---|---|");
  leads.forEach((l, i) => {
    const st = l.status || (l.dateUnknown ? "日付不明" : "");
    const work = l.work ? (l.work.id ? `${shortText(l.work.title, 14)}✅` : shortText(l.work.title, 14)) : "—";
    out.push(`| ${i + 1} | ${l.type} | [${l.source}](${l.url}) | ${st} | ${work} | ${shortText(l.title, 28)} |`);
  });
  out.push("");
  out.push("✅＝サイトの作品ページに解決済み（返信でその作品ページを直接案内できる）。");
  out.push("");

  // 個別リードと返信下書き
  out.push("## 返信下書き（コピペ用）");
  out.push("");
  leads.forEach((l, i) => {
    out.push(`### ${i + 1}. ${l.type}｜${l.source}${l.status ? `（${l.status}）` : ""}`);
    out.push(`- 元投稿: ${l.url}`);
    if (l.title) out.push(`- 内容: ${shortText(l.title, 60)}`);
    out.push("- [ ] 接触した");
    out.push("");
    out.push("```");
    out.push(l.reply);
    out.push("```");
    out.push("");
  });

  out.push("---");
  out.push(`生成JSON: \`${meta.jsonPath}\`｜ 再生成: \`node scripts/lead-finder.js\`｜ 手順: \`docs/demand-scan.md\``);
  return out.join("\n") + "\n";
}

main().catch((err) => {
  console.error("リード発掘に失敗しました:", err.message);
  process.exit(1);
});
