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
  bodyIncludesUrl,
} = require("./build-digest");
const { xPostUrl, xSearchUrl } = require("./x-intent");

// --- 各投稿ドラフトの組み立て ---
//
// 【2026-08-16変更】どのドラフトも `{ text, replyUrl }` を返す。
// 日次ダイジェスト（build-digest.js）と同じシャドウバン対応で、**Xの本文にはURLを入れず**
// 投稿後のリプライに回すため。URLは捨てずに replyUrl として対で持たせる
// （本文から消すだけだと流入経路が丸ごと消える）。判定は build-digest.js の
// bodyIncludesUrl を共有する＝方針を2箇所に持たない。
//
// この作り替えの経緯: 2026-08-06に日次側のリンク先を /season/ 形式へ直したとき、
// **この週次キットだけ直し漏れて気づかれなかった**（当時 check.ts が build-digest.js しか
// 見ていなかったため）。同じ取りこぼしを繰り返さないよう、今回は check.ts の
// 「Xの投稿方針」節が最初から両方のファイルを見るようにしてある。

// 本文の末尾に置くURL行。Xでは空配列になる（＝本文にURLが出ない）。
function urlLinesFor(url) {
  return bodyIncludesUrl("x") ? [url] : [];
}

// 本文にURLを載せない運用のとき、リプライで貼るURL。載せる運用なら null。
function replyUrlFor(url) {
  return bodyIncludesUrl("x") ? null : url;
}

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
    "サービス別の独占一覧はリプライのリンクから。",
    ...urlLinesFor(exclusiveUrl),
    `#${year}年${label}アニメ`,
  ];
  return { text: truncate(lines.join("\n"), MAX_LEN), replyUrl: replyUrlFor(exclusiveUrl) };
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
    `${top.name}で見られる今期作品の一覧はリプライのリンクから。`,
    ...urlLinesFor(serviceUrl),
    `#${year}年${label}アニメ`,
  ];
  return { text: truncate(lines.join("\n"), MAX_LEN), replyUrl: replyUrlFor(serviceUrl) };
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
    "出演作と配信先はリプライのリンクから。",
    ...urlLinesFor(personUrl),
    `#${year}年${label}アニメ`,
  ];
  return { text: truncate(lines.join("\n"), MAX_LEN), replyUrl: replyUrlFor(personUrl) };
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
    "全ランキングはリプライのリンクから。",
    ...urlLinesFor(rankingUrl),
    `#${year}年${label}アニメ`,
  ];
  return { text: truncate(lines.join("\n"), MAX_LEN), replyUrl: replyUrlFor(rankingUrl) };
}

// --- リサーチ用: 困りごとを読むための検索クエリ ---

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

// 【2026-08-16削除】replyDrafts（他ユーザーへのリプライ下書き）をここから外した。
//
// 2026-08-06に「他ユーザーへのリプライ・絡みは行わない」方針になった際、
// Issue本文からリプライの節は消したが**生成側の関数は残ったまま**で、
// buildGrowthKit が毎週 replies を組み立てては renderGrowthKit が一度も使わない、
// という死んだコードになっていた（2026-08-16の棚卸で発見）。
// 方針が変わった時は、出力だけでなく生成側も一緒に落とすこと。
// 依存していた hasStarted / serviceNames も同時に不要になったので削除済み。

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
    ...(bodyIncludesUrl("x") ? ["", seasonUrl] : []),
  ];
  return { text: truncate(lines.join("\n"), MAX_LEN), replyUrl: replyUrlFor(seasonUrl) };
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

  // 各 draft* は `{ text, replyUrl }` を返す（2026-08-16変更）。候補が無い週は null を返すので
  // そこで落とし、renderGrowthKit が扱いやすい平らな形に均す。
  const drafts = [
    { label: "① 独占配信ピック", draft: draftExclusive(items, year, label, exclusiveUrl) },
    { label: "② 配信サービス別ピック", draft: draftServicePick(items, year, label, season) },
    { label: "③ 声優ピック", draft: draftVoiceActor(items, year, label, season) },
    { label: "④ データもの（サービス別対応本数）", draft: draftDataViz(items, year, label, rankingUrl) },
  ]
    .filter((d) => d.draft)
    .map((d) => ({ label: d.label, text: d.draft.text, replyUrl: d.draft.replyUrl }));

  return {
    year,
    season,
    label,
    todayStr,
    count: data.count,
    drafts,
    pinnedDraft: draftPinned(year, label, data.count, seasonUrl),
    queries: searchQueries(items, year, label),
  };
}

// Issue本文（Markdown）に整形する。
function renderGrowthKit(kit) {
  const { year, label, todayStr, count, drafts, queries, pinnedDraft } = kit;
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
  // 【2026-08-16追加】シャドウバンの経緯を毎週のIssueに1行だけ残す。
  // 2026-08-07〜08-16の投稿停止期間を知らないと、この時期のインプレッションを
  // 「施策が効かなかった」と読み違える。数字の断絶に必ず説明を添える。
  out.push(
    "> 📌 **2026-08-07にSearch Ban（シャドウバン）が判明し、8/16に解除を確認**。この間はX投稿を止めていたので、**8月前半の数字とは比較できません**。解除後の初回計測を新しい基準にしてください。本文のリンクとタグの是正は2026-08-16に実装済み（下の4）。"
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
    // 本文からURLを外した運用のとき（＝X）は、リプライで貼るURLを対で出す。
    // ここを出し忘れると「リンクを消しただけ」になり流入経路が丸ごと消える。
    if (d.replyUrl) {
      out.push("投稿したら、**自分のポストにリプライでこのURLを貼る**:");
      out.push("");
      out.push("```");
      out.push(d.replyUrl);
      out.push("```");
      out.push("");
    }
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
  // 【2026-08-16修正】ここが挙げていた原因のうち「毎投稿に外部リンク」「タグの付けすぎ」は
  // 実装で解消済み。残っている原因だけを書く（直したものを原因として挙げ続けると、
  // 次に何を疑えばいいのかが分からなくなる）。
  out.push(
    "**インプレッションがほぼ0のままなら**、投稿文をいくら磨いても意味がありません。本文のリンクとタグは2026-08-16に実装で解消済みなので、次に疑うのは投稿の頻度・時刻・画像の有無です（下の「4」「5」）。**シャドウバンが再発していないかも併せて確認してください**（`shadowban.lami.zip` 等の判定サイト）。"
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
  out.push(`**[▶ このままXの投稿画面を開く](${xPostUrl(pinnedDraft.text)})**`);
  out.push("");
  out.push("```");
  out.push(pinnedDraft.text);
  out.push("```");
  out.push("");
  if (pinnedDraft.replyUrl) {
    out.push("固定したら、**その投稿へのリプライでこのURLを貼る**（固定ポストは1回きりなので、これも1回だけ）:");
    out.push("");
    out.push("```");
    out.push(pinnedDraft.replyUrl);
    out.push("```");
    out.push("");
  }

  out.push("## 4. 表示を増やす実験（会話をしない前提での打ち手）");
  out.push("");
  // 【2026-08-16に全面書き換え】この節は長らく「本文からURLを外す」「タグを1個にする」を
  // **利用者が手で試す実験**として並べていた。2026-08-16にその2つは日次・週次とも
  // 生成側に実装したので、人がやることではなくなった（下書きが最初からその形で出る）。
  // 実装済みのものをチェックリストに残すと、毎週「もうやってある」を確認するだけの
  // 空回りになり、本当に人しかできない項目（画像添付・単発ネタ）が埋もれる。
  out.push(
    "**下の2つは実装済みなので、もうやることはありません**（下書きが最初からその形で出ます）。"
  );
  out.push("");
  out.push("- ✅ **ハッシュタグは季節タグ1個だけ**（2026-08-16実装）");
  out.push("- ✅ **本文にURLを入れず、リプライで貼る**（2026-08-16実装。上のドラフトにリプライ用URLが付いています）");
  out.push("");
  out.push("残っているのは、人が手を動かさないとできない次の2つです。");
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
  out.push("- [ ] **サイトの画面キャプチャを1枚添える**（1手増える。画像付きは伸びやすいと言われる）");
  out.push("- [ ] **定型ネタ以外に、単発で「意外な数字」を1本投げる**（上の④のドラフトがそれ。番組表は誰もリポストしないが、通説を否定する一次データはされうる）");
  out.push("");
  out.push(
    "**2週間ずつ、片方だけ**試して2のインプレッションが変わるか見てください（同時に両方変えると何が効いたか分かりません）。変わらなければ元に戻します（手数が増えるだけなので）。"
  );
  out.push("");

  out.push("## 5. 投稿時刻・ハッシュタグ");
  out.push("");
  out.push(
    "- **時刻**: 放送直後の実況が集まる 21:00〜24:00、または昼の 12:00〜13:00 が届きやすい。"
  );
  // 【2026-08-16修正】以前はここが「1〜2個」で、生成されるドラフト（季節タグ1個）と
  // 食い違っていた。手で書き足すときにタグが増えると、せっかく減らした意味が無くなる。
  out.push(
    `- **ハッシュタグ**: \`#${year}年${label}アニメ\` の**1個だけ**にする（2026-08-16変更）。上のドラフトもその形で出る。手で投稿文を書くときも増やさないこと。`
  );
  out.push("- **画像**: 投稿にサイトの実画面（カレンダー/TOP5パネル）のスクショを添えると伸びやすい（権利画像は使わない方針のまま）。");
  out.push("");

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
  out.push(
    "運用の考え方の全体像は `docs/x-growth-playbook.md` を参照。"
  );
  return out.join("\n");
}

module.exports = { buildGrowthKit, renderGrowthKit };
