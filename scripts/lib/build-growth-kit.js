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
const { xPostUrl, xSearchUrl } = require("./x-intent");

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

// 固定ポスト（プロフィールにピン留めする1投稿）の下書き。
// 【なぜ要るか・2026-08-06】他ユーザーへのリプライ・絡みをしない方針にしたため、
// フォロワーを増やす経路は「表示を増やす」か「表示された人が押す率を上げる」の2つに絞られる。
// 後者で最も効くのが固定ポストで、投稿を見た人はフォロー前にほぼ必ずプロフィールを見る。
// 日次・週次の下書きと違って**一度貼れば当分やり直し不要**なので、毎週同じ内容でよい。
// 内容は実データの本数だけを使い、作品の評価は書かない（CLAUDE.mdの「創作しない」方針）。
function draftPinned(year, label, count, seasonUrl) {
  const lines = [
    "「このアニメ、どこで配信されてる？」を調べるサイトを作っています。",
    "",
    `・${year}年${label}アニメ${count}作品の配信サービスを一覧で確認できます`,
    "・曜日別のカレンダー表示、作品名・声優名での検索に対応",
    "・配信情報は毎日自動で最新に更新",
    "",
    seasonUrl,
  ];
  return truncate(lines.join("\n"), MAX_LEN);
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

  // 【2026-08-06修正】以前は `${SITE_URL}/?year=&season=` というクエリ付きトップだった。
  // トップページの canonical は "/" なので、検索エンジンから見ると単なる重複URLで、
  // 順位を取らせたいシーズンページには何のシグナルも渡らない。2026-08-05に
  // build-digest.js（日次投稿）側は /season/ 形式へ直したが、**この週次キット側は
  // 直し漏れていた**（check.ts のリンク検査が build-digest.js しか見ていなかったため
  // 気づけなかった。検査を build-growth-kit.js にも広げてある）。
  const seasonUrl = `${SITE_URL}/season/${year}/${season}`;
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
    pinnedDraft: draftPinned(year, label, data.count, seasonUrl),
    queries: searchQueries(items, year, label),
    replies: replyDrafts(items, year, label, seasonUrl, todayStr),
  };
}

// Issue本文（Markdown）に整形する。
function renderGrowthKit(kit) {
  const { year, label, todayStr, count, drafts, queries, replies, pinnedDraft } = kit;
  const out = [];
  out.push(`# 今週のX成長アクション（${year}年${label}アニメ / ${todayStr}〜）`);
  out.push("");
  out.push(
    "週1で自動起票されるチェックリストです。**投稿はすべて手動**（Xを自分で開いて操作）で行います。上から順にこなすだけでOK。最初の週は「2. まず数字を見る」と「3. プロフィールの点検」を先に済ませてください。"
  );
  out.push("");
  out.push(
    "> やらないこと: 自動フォロー/フォロー解除・大量DM・スクレイピングはXのToS違反なので使いません。**他ユーザーへのリプライ・絡みも行わない方針**（2026-08-06・利用者判断）。会話に頼らず「表示を増やす」「見た人が押す率を上げる」の2つでフォロワーを増やします。"
  );
  out.push("");

  out.push("## 1. 今週の投稿ドラフト（コピペ用）");
  out.push("");
  out.push(
    `今期は${count}作品。日次ダイジェスト（毎朝の枠で起票される別Issue）とは切り口を変えた週次ネタです。`
  );
  out.push("");
  // 下書きの直前に「タップ1回でXの投稿画面が本文入りで開く」リンクを置く。
  // コードブロックも残す（PCでのコピペ運用と、Web Intentが将来壊れたときの保険）。
  // 経緯は scripts/lib/x-intent.js のコメント参照。
  for (const d of drafts) {
    out.push(`### ${d.label}`);
    out.push("");
    out.push(`**[▶ このままXの投稿画面を開く](${xPostUrl(d.text)})**（本文は入った状態で開きます。投稿ボタンは自分で押してください）`);
    out.push("");
    out.push("```");
    out.push(d.text);
    out.push("```");
    out.push("");
  }

  // 【2026-08-06に構成を変更】以前はここが「リーチ（見込み客に絡む）」で、
  // キットの主役だった。しかし利用者の判断で**他ユーザーへのリプライ・絡みは行わない**
  // 方針になった（約70投稿して反応もフォローバックも無く、会話に入る運用は続けない）。
  // 会話をしない前提でフォロワーを増やす手段は「見られる回数を増やす」か
  // 「見た人が押す率を上げる」しかないので、そこに置き換える。
  out.push("## 2. まず数字を見る（毎週これだけは記録する）");
  out.push("");
  out.push(
    "リプライで会話を作らない方針なので、**伸びない原因が「見られていない」のか「見られているが押されない」のかを数字で切り分ける**ところから始めます。Xアナリティクス（`x.com/i/account_analytics`、スマホは投稿の「表示」の数字）を見て、下の3つをこのIssueにコメントで残してください。"
  );
  out.push("");
  out.push("| 見るもの | どこで | 意味 |");
  out.push("|---|---|---|");
  out.push("| 直近7日の**インプレッション合計** | Xアナリティクス | 0〜数十なら「そもそも表示されていない」。数百以上なら表示はされている |");
  out.push("| **プロフィールへのアクセス数** | 同上 | 投稿→プロフィールまでは来ているか |");
  out.push("| **フォロワー数** | プロフィール | 目標100人までの残り |");
  out.push("");
  out.push(
    "**インプレッションがほぼ0なら**、投稿文をいくら磨いても意味がありません。原因は表示側（新規アカウントの評価・毎投稿に外部リンクが入っていること・タグの付けすぎ）にあるので、下の「4. 表示を増やす実験」を回します。"
  );
  out.push("");
  out.push(
    "**インプレッションが出ているのにフォローが増えないなら**、原因はプロフィール側です。下の「3. プロフィールの点検」を先にやります。"
  );
  out.push("");

  out.push("## 3. プロフィールの点検（表示された人を逃さない）");
  out.push("");
  out.push(
    "投稿を見た人は、フォローする前に必ずプロフィールを見ます。ここが整っていないと表示が増えてもフォローには変わりません。**一度やれば当分やり直し不要**なので、最初の週に済ませてください。"
  );
  out.push("");
  out.push("- [ ] **固定ポスト**がある（このアカウントが何をくれるのかが1投稿で分かる。下に下書きあり）");
  out.push("- [ ] プロフィール文に「今期アニメがどこで配信されているか」が入っている");
  out.push("- [ ] アイコン・ヘッダー画像が既定のままになっていない");
  out.push("- [ ] プロフィールのリンクがサイトに向いている");
  out.push("");
  out.push("**固定ポストの下書き**（1回貼って固定するだけ。毎週やり直す必要はありません）:");
  out.push("");
  out.push(`**[▶ このままXの投稿画面を開く](${xPostUrl(pinnedDraft)})**`);
  out.push("");
  out.push("```");
  out.push(pinnedDraft);
  out.push("```");
  out.push("");

  out.push("## 4. 表示を増やす実験（会話をしない前提での打ち手）");
  out.push("");
  // 【2026-08-07に順番と根拠を書き換え】以前はこの節の筆頭が
  // 「本文からURLを外し、URLは自分の投稿への返信に貼る」だった。根拠は
  // 「Xは外部リンク入りの投稿の表示を抑える」という広く流布した説だが、
  // 再調査（docs/research-2026-08/research-H.md）で**この説は撤回されている疑いが強い**
  // と分かった: 2025年10月にリンクのデブーストが撤廃されたと複数媒体が報じ、
  // Xのプロダクト責任者も2026年に「リンクへのペナルティは1年以上前から無い」と発言している。
  // 日本語のSEO記事が今も「30〜50%減点」と書いているのは撤廃前の情報の複製とみられる。
  // 撤廃を裏付ける独立の実測は無いので断定はしないが、**毎日2手増やす実験を
  // 最優先で人にやらせる根拠としては弱い**ので、手数の増えない順に並べ替えた。
  out.push(
    "会話をしない前提だと、打てるのは「表示される回数を増やす」だけです。**手数が増えない順**に並べてあります。上から順に、**2週間ずつ**試して1のインプレッションが変わるか見てください（同時に複数変えると何が効いたか分からなくなります）。"
  );
  out.push("");
  out.push("- [ ] **ハッシュタグを1個だけにする**（手数ゼロ。2026年1月のアルゴリズム刷新でタグの加点はほぼ無くなったとされる。減点される実測は無いが、付ける利益も薄い）");
  out.push("- [ ] **定型3種以外に、単発で「意外な数字」を1本投げる**（下の1のドラフトがそれ。番組表は誰もリポストしないが、通説を否定する一次データはされうる）");
  out.push("- [ ] **サイトの画面キャプチャを1枚添える**（1手増える。画像付きは伸びやすいと言われる）");
  out.push("- [ ] **本文からURLを外し、URLは自分の投稿への返信に貼る**（2手増える。**優先度は最後**。根拠にしていた「リンクは表示が抑えられる」説は、2025年10月に撤廃されたと報じられており、いま成り立つか怪しい）");
  out.push("");
  out.push(
    "2週間後、変化があった項目だけ残します。**変わらなければ元に戻してください**（手数が増えるだけなので）。"
  );
  out.push("");

  out.push("## 5. 投稿時刻・ハッシュタグ");
  out.push("");
  out.push(
    "- **時刻**: 放送直後の実況が集まる 21:00〜24:00、または昼の 12:00〜13:00 が届きやすい。"
  );
  out.push(
    `- **ハッシュタグ**: \`#${year}年${label}アニメ\` \`#今期アニメ\` ＋ 話題の作品固有タグ（例: 放送当日の作品名タグ）を1〜2個。付けすぎない。`
  );
  out.push("- **画像**: 投稿にサイトの実画面（カレンダー/TOP5パネル）のスクショを添えると伸びやすい（権利画像は使わない方針のまま）。");
  out.push("");

  out.push("## 7. 今週のチェック");
  out.push("");
  // 【並び順の根拠・2026-08-06】以前は投稿ドラフトが先頭だったが、実測では
  // 7/20〜7/30に日次の投稿下書きIssueを毎日消化してもXフォロワーは0のままだった
  // （docs/operations.md「実測サマリ」2026-07-26）。フォロワーを増やすのは
  // 告知の連投ではなく会話への参加（docs/x-growth-playbook.md）なので、
  // 効く順＝リーチを先頭に置く。
  out.push("- [ ] **今週のインプレッション・プロフィールアクセス・フォロワー数をこのIssueにコメントした**（← これが無いと何が効いたか永久に分からない）");
  out.push("- [ ] プロフィールの点検（3）が済んでいる／固定ポストがある");
  out.push("- [ ] 上の投稿ドラフトから 2〜3本 投稿した");
  out.push("- [ ] 表示を増やす実験（4）を今週も同じ条件で続けた");
  out.push("");
  // 【残してある理由】利用者の判断で他ユーザーへのリプライ・絡みは行わない方針だが、
  // 「困っている人が実際にどう困っているか」を読むだけでも、投稿文や
  // content/sns/spotlight.js の見直しの材料になる。接触は求めない書き方にしてある。
  out.push("## 6. （任意）実際の困りごとを読む");
  out.push("");
  out.push(
    "返信はしない方針なので、これは**リサーチ用**です。「どこで見れる？」で困っている人が実際にどんな書き方をしているかを眺めると、投稿文やスポットライトで取り上げる作品を選ぶ材料になります。やらなくても構いません。"
  );
  out.push("");
  for (const q of queries) {
    out.push(`- [🔍 Xで検索する](${xSearchUrl(q)})`);
  }
  out.push("");

  out.push(
    "運用の考え方の全体像は `docs/x-growth-playbook.md` を参照。"
  );
  return out.join("\n");
}

module.exports = { buildGrowthKit, renderGrowthKit };
