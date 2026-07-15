// 週次「Xアカウント成長キット」を組み立てるロジック。
// フォロワー獲得のための "1週間ぶんの手動アクション" を1つのMarkdownにまとめる。
// x-growth.yml が週1でこれをGitHub Issueとして起票し、ユーザーが上から順に手動で
// 実行する（投稿・リプ・フォローはすべてXを開いて人が行う。自動投稿はしない）。
//
// 設計方針:
// - 全自動化はしない。XのAPIは従量課金（docs/sns-growth-research.md）で、自動フォロー/
//   大量DM/スクレイピングはToS違反。この仕組みは「手動実行の材料を毎週そろえる」だけ。
// - 数字・作品名・配信サービスはデプロイ済みサイトの /api/season（＝Annict実データ）から
//   取得し、推測・創作しない（CLAUDE.mdの方針）。
// - 既存の日次ダイジェスト（build-digest.js）とはネタの切り口を変える（独占/サービス別/
//   声優/データもの）。日次＝その日の放送作品、週次キット＝フォロー転換とリーチの動線。
const {
  SITE_URL,
  MAX_LEN,
  truncate,
  jstParts,
  currentSeasonByMonth,
  shortTitle,
} = require("./build-digest");

// 「配信予定含む」を安全に表現するための放送開始判定。
// broadcastStartDate が今日以前なら配信開始済み。未定(null)や未来は「予定」扱い。
// 断定的に「配信中」と書いて誤誘導しないための線引き（放送開始1週間前ルールと同じ思想）。
function hasStarted(item, todayStr) {
  return !!item.broadcastStartDate && item.broadcastStartDate <= todayStr;
}

// 作品の配信サービス表示名（先頭数件）。services は ServiceTag[]（.name/.short/.key）。
function serviceNames(item, limit = 3) {
  return item.services.slice(0, limit).map((s) => s.name);
}

// --- 各投稿ドラフトの組み立て（いずれも260字以内・末尾にサイトURL） ---

// ① 独占配信ピック: 見放題が1社だけの作品（独占）を注目度順に。需要◎◎（growth-ideas.md）。
function draftExclusive(items, year, label, exclusiveUrl) {
  const exclusives = items
    .filter((it) => it.services.length === 1)
    .sort((a, b) => b.watchers - a.watchers)
    .slice(0, 3);
  if (exclusives.length === 0) return null;
  const lines = [
    `【独占配信】${year}年${label}アニメで“ここでしか見られない”注目作`,
    "",
    ...exclusives.map((it) => `・${shortTitle(it.title, 20)}（${it.services[0].name}）`),
    "",
    "サービス別の独占一覧はこちら👇",
    exclusiveUrl,
    `#${year}年${label}アニメ`,
  ];
  return truncate(lines.join("\n"), MAX_LEN);
}

// ② 配信サービス別ピック: そのクールで最も多くの作品を配信しているサービスを取り上げる。
// 需要◎（「dアニメ 今期」等）。key/nameは実データのServiceTagから取る。
function draftServicePick(items, year, label, seasonKey) {
  const counts = new Map(); // key -> { name, key, count }
  for (const it of items) {
    for (const s of it.services) {
      const cur = counts.get(s.key) || { name: s.name, key: s.key, count: 0 };
      cur.count += 1;
      counts.set(s.key, cur);
    }
  }
  const top = [...counts.values()].sort((a, b) => b.count - a.count)[0];
  if (!top) return null;
  const serviceUrl = `${SITE_URL}/service/${top.key}/${year}/${seasonKey}`;
  const picks = items
    .filter((it) => it.services.some((s) => s.key === top.key))
    .sort((a, b) => b.watchers - a.watchers)
    .slice(0, 3);
  const lines = [
    `【${top.name}】${year}年${label}アニメは${top.count}作品が配信対象`,
    "",
    ...picks.map((it) => `・${shortTitle(it.title, 20)}`),
    "",
    `${top.name}で見られる今期作品の一覧👇`,
    serviceUrl,
    `#${year}年${label}アニメ`,
  ];
  return truncate(lines.join("\n"), MAX_LEN);
}

// ③ 声優ピック: そのクールで最も多くの作品に出ている声優を取り上げる。需要○。
// castNames（Annict由来の声優名）を集計。person ページは今期2作品以上で生成されるため、
// 2作品以上の声優のみをリンク対象にする（それ未満は404になるため出さない）。
function draftVoiceActor(items, year, label, seasonKey) {
  const counts = new Map(); // name -> count
  const worksByName = new Map(); // name -> [titles]
  for (const it of items) {
    for (const name of it.castNames || []) {
      counts.set(name, (counts.get(name) || 0) + it.watchers); // 注目度で重み付け
      const arr = worksByName.get(name) || [];
      arr.push(it);
      worksByName.set(name, arr);
    }
  }
  // 2作品以上（personページが存在する閾値）に絞り、注目度重み合計が最大の声優を選ぶ。
  const eligible = [...counts.entries()]
    .filter(([name]) => (worksByName.get(name) || []).length >= 2)
    .sort((a, b) => b[1] - a[1]);
  if (eligible.length === 0) return null;
  const [name] = eligible[0];
  const works = (worksByName.get(name) || [])
    .sort((a, b) => b.watchers - a.watchers)
    .slice(0, 3);
  const personUrl = `${SITE_URL}/person/${encodeURIComponent(name)}/${year}/${seasonKey}`;
  const lines = [
    `【今期の注目声優】${name}さんは${year}年${label}アニメで${(worksByName.get(name) || []).length}作品に出演`,
    "",
    ...works.map((it) => `・${shortTitle(it.title, 20)}`),
    "",
    "出演作と配信先はこちら👇",
    personUrl,
    `#${year}年${label}アニメ`,
  ];
  return truncate(lines.join("\n"), MAX_LEN);
}

// ④ データもの: 配信サービス別の対応本数ランキング。権利画像不要で拡散・被リンク源になる想定。
function draftDataViz(items, year, label, rankingUrl) {
  const counts = new Map();
  for (const it of items) {
    for (const s of it.services) {
      const cur = counts.get(s.key) || { name: s.name, count: 0 };
      cur.count += 1;
      counts.set(s.key, cur);
    }
  }
  const top = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  if (top.length === 0) return null;
  const lines = [
    `【データで見る${year}年${label}アニメ】配信サービス別・対応本数トップ5`,
    "",
    ...top.map((s, i) => `${i + 1}. ${s.name} … ${s.count}作品`),
    "",
    "全ランキングはこちら👇",
    rankingUrl,
    `#${year}年${label}アニメ`,
  ];
  return truncate(lines.join("\n"), MAX_LEN);
}

// --- リーチ用: 手動エンゲージのための検索クエリとリプ下書き ---

// Xで「見込み客」を見つけるための検索クエリ。ユーザーがXの検索窓にコピペして使う
// （X APIの有料化で自動検索はしないため、検索は人が行う）。注目作を1〜2本織り込む。
function searchQueries(items, year, label) {
  const top2 = [...items].sort((a, b) => b.watchers - a.watchers).slice(0, 2);
  const queries = [
    "今期アニメ 配信 どこで",
    "今期アニメ どこで見れる",
    `#${year}年${label}アニメ 配信`,
  ];
  for (const it of top2) {
    queries.push(`${shortTitle(it.title, 16)} 配信 どこ`);
  }
  return queries;
}

// リプ下書き（そのまま貼れる形）。配信サービスは実データから埋めるが、投稿直前に
// サイトで最新を確認する前提の注記を添える（配信情報は後から追加されうるため）。
// 断定的に「配信中」と書くのは放送開始済み（hasStarted）の作品だけにする。
function replyDrafts(items, year, label, seasonUrl, todayStr) {
  const withService = items
    .filter((it) => it.services.length > 0 && hasStarted(it, todayStr))
    .sort((a, b) => b.watchers - a.watchers)
    .slice(0, 3);
  const drafts = withService.map((it) => {
    const svc = serviceNames(it, 3).join("・");
    const workUrl = `${SITE_URL}/anime/${it.id}`;
    return `「${shortTitle(it.title, 20)}」は ${svc} で配信中ですよ。今期アニメの配信先はここで一覧にしてます👉 ${workUrl}`;
  });
  // 作品を特定しない汎用の下書き（「どこで見れる？」への一般返信）。
  drafts.push(
    `${year}年${label}アニメがどこで配信されているか、サービス別に一覧でまとめています。よかったら参考にどうぞ👉 ${seasonUrl}`
  );
  return drafts;
}

// --- 全体の組み立て ---
async function buildGrowthKit(now = new Date()) {
  const { year, month, day } = jstParts(now);
  const { key: season, label } = currentSeasonByMonth(month);
  const todayStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const res = await fetch(`${SITE_URL}/api/season?year=${year}&season=${season}`);
  if (!res.ok) {
    throw new Error(`サイトのAPI取得に失敗しました（${res.status}）`);
  }
  const data = await res.json();
  const items = data.items || [];

  const seasonUrl = `${SITE_URL}/?year=${year}&season=${season}`;
  const exclusiveUrl = `${SITE_URL}/exclusive/${year}/${season}`;
  const rankingUrl = `${SITE_URL}/rankings/${year}/${season}`;

  const drafts = [
    { label: "① 独占配信ピック", text: draftExclusive(items, year, label, exclusiveUrl) },
    { label: "② 配信サービス別ピック", text: draftServicePick(items, year, label, season) },
    { label: "③ 声優ピック", text: draftVoiceActor(items, year, label, season) },
    { label: "④ データもの（サービス別対応本数）", text: draftDataViz(items, year, label, rankingUrl) },
  ].filter((d) => d.text);

  return {
    year,
    season,
    label,
    todayStr,
    count: data.count,
    drafts,
    queries: searchQueries(items, year, label),
    replies: replyDrafts(items, year, label, seasonUrl, todayStr),
  };
}

// Issue本文（Markdown）に整形する。
function renderGrowthKit(kit) {
  const { year, label, todayStr, count, drafts, queries, replies } = kit;
  const out = [];
  out.push(`# 今週のX成長アクション（${year}年${label}アニメ / ${todayStr}〜）`);
  out.push("");
  out.push(
    "週1で自動起票されるチェックリストです。**投稿・リプ・フォローはすべて手動**（Xを自分で開いて操作）で行います。上から順にこなすだけでOK。"
  );
  out.push("");
  out.push(
    "> やらないこと: 自動フォロー/フォロー解除・大量DM・スクレイピングはXのToS違反なので使いません。フォロワーは「役立つ情報の発信」と「自然な会話」で増やします。"
  );
  out.push("");

  out.push("## 1. 今週の投稿ドラフト（コピペ用）");
  out.push("");
  out.push(
    `今期は${count}作品。日次ダイジェスト（毎日21時の別Issue）とは切り口を変えた週次ネタです。反応が良かった1本は固定ポスト候補にしておくと、プロフィール訪問者のフォロー率が上がります。`
  );
  out.push("");
  for (const d of drafts) {
    out.push(`### ${d.label}`);
    out.push("");
    out.push("```");
    out.push(d.text);
    out.push("```");
    out.push("");
  }

  out.push("## 2. リーチ（見込み客に絡んでフォロワーを増やす）");
  out.push("");
  out.push(
    "下の検索クエリを**Xの検索窓にコピペ**して、「配信どこ？」で困っている人や今期アニメの話をしている人を見つけ、リプ下書きを添えて自然に返します。いきなりURL直貼りはせず、まず会話→役立つ場面で1回だけ貼るのが定石です。"
  );
  out.push("");
  out.push("**検索クエリ:**");
  out.push("");
  for (const q of queries) {
    out.push("```");
    out.push(q);
    out.push("```");
  }
  out.push("");
  out.push("**リプ下書き（状況に合うものを選ぶ／投稿直前にサイトで最新の配信先を確認）:**");
  out.push("");
  for (const r of replies) {
    out.push("```");
    out.push(r);
    out.push("```");
  }
  out.push("");

  out.push("## 3. 投稿時刻・ハッシュタグ");
  out.push("");
  out.push(
    "- **時刻**: 放送直後の実況が集まる 21:00〜24:00、または昼の 12:00〜13:00 が届きやすい。"
  );
  out.push(
    `- **ハッシュタグ**: \`#${year}年${label}アニメ\` \`#今期アニメ\` ＋ 話題の作品固有タグ（例: 放送当日の作品名タグ）を1〜2個。付けすぎない。`
  );
  out.push("- **画像**: 投稿にサイトの実画面（カレンダー/TOP5パネル）のスクショを添えると伸びやすい（権利画像は使わない方針のまま）。");
  out.push("");

  out.push("## 4. 今週のチェック");
  out.push("");
  out.push("- [ ] 上の投稿ドラフトから 2〜3本 投稿した");
  out.push("- [ ] 検索クエリで見込み客に 3件以上 リプ/いいねした");
  out.push("- [ ] 今期アニメの話をしている関連アカウントを 2〜3件 フォロー/交流した");
  out.push("- [ ] 反応が良かった投稿を固定ポスト候補にメモした");
  out.push("");
  out.push(
    "運用の考え方の全体像は `docs/x-growth-playbook.md` を参照。"
  );
  return out.join("\n");
}

module.exports = { buildGrowthKit, renderGrowthKit };
