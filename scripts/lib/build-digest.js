// SNS投稿下書きを組み立てる共通ロジック。曜日によって内容を出し分ける（毎日投稿ローテーション）。
//   日曜: 今期の注目作TOP5 ＋ その日に放送/配信があれば曜日紹介（2投稿になりうる）
//   月〜土: その曜日に放送/配信のある今期アニメ（broadcastWeekdayで抽出）
// デプロイ済みの本番サイトのAPI（/api/season）を叩くだけなので、
// ANNICT_TOKENの複製やAnnictへの直接アクセスは不要。
// DIGEST_SITE_URL を設定すると差し替えられる（ローカルの開発サーバーに向けた動作確認用）。
const SITE_URL = process.env.DIGEST_SITE_URL || "https://animedia-khaki.vercel.app";

// X(280字)・Bluesky(300字)双方で安全に収まるよう、控えめな上限で統一する。
const MAX_LEN = 260;
const WEEKDAY_LABEL = ["日", "月", "火", "水", "木", "金", "土"];

function currentSeasonByMonth(m) {
  if (m <= 3) return { key: "winter", label: "冬" };
  if (m <= 6) return { key: "spring", label: "春" };
  if (m <= 9) return { key: "summer", label: "夏" };
  return { key: "autumn", label: "秋" };
}

// GitHub Actionsのランナーは常にUTC。JST（+9h）に直してから年・月・日・曜日を取る。
function jstParts(now) {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return {
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1,
    day: jst.getUTCDate(),
    weekday: jst.getUTCDay(), // 0=日 〜 6=土（JST基準）
  };
}

function truncate(text, max) {
  const chars = [...text];
  if (chars.length <= max) return text;
  return chars.slice(0, max - 1).join("") + "…";
}

// TOP5投稿は文字数制限があるため正式タイトルを短縮する。新しい呼び方を作るのではなく、
// サブタイトル区切り（～〈(－等）以降を落とすだけの機械的な短縮にとどめる
// （CLAUDE.mdの「創作しない」方針に準拠。既存の通称データ content/works/aliases.ts は
// このスクリプトが素のNodeで動く関係で読み込まず、単純カットで統一する）。
function shortTitle(title, max = 16) {
  const base = title.split(/[～〈(（\-―]/)[0].trim() || title;
  const chars = [...base];
  return chars.length <= max ? base : chars.slice(0, max).join("") + "…";
}

// カレンダー表示の該当曜日タブ、または「今期の注目作TOP5」パネルを開いた状態を
// 直接開けるURL（components/SeasonExplorer.tsx の ?view=calendar&day=.. / ?ranking=open
// 対応、2026-07-14導入）。投稿添付用のスクリーンショット撮影に使う。
function calendarScreenshot(url, weekdayLabel) {
  return { url: `${url}&view=calendar&day=${encodeURIComponent(weekdayLabel)}`, selector: ".calendar" };
}
function rankingScreenshot(url) {
  return { url: `${url}&ranking=open`, selector: ".ranking" };
}

// 日曜: 今期の注目作TOP5（人数付き）
function buildTop5(data, year, label, url) {
  const top5 = [...data.items].sort((a, b) => b.watchers - a.watchers).slice(0, 5);
  const lines = [
    `今週の「アニメ視聴ガイド」注目作TOP5（${year}年${label}アニメ）`,
    "",
    ...top5.map((it, i) => `${i + 1}. ${shortTitle(it.title)}（${it.watchers.toLocaleString("ja-JP")}人が注目）`),
    "",
    url,
    `#${year}年${label}アニメ`,
  ];
  return { text: truncate(lines.join("\n"), MAX_LEN), screenshot: rankingScreenshot(url) };
}

// 月〜土: その曜日に放送/配信のある今期アニメ。注目度順に、字数上限まで詰める。
// 該当作品が無ければ null（呼び出し側でTOP5にフォールバック）。
// 基本ルール（2026-07-11）: broadcastWeekdayは「毎週その曜日」の推定でしかなく、
// 放送開始前の作品も曜日が一致するだけで拾ってしまう（実例: Re:ゼロ4期奪還編を
// 8月開始前の水曜に「今日放送」と誤案内しかける）。実際に放送開始日を迎えている
// 作品（broadcastStartDate <= 今日）だけに絞る。
function buildTodayAiring(data, weekday, year, label, url, todayStr) {
  const today = data.items
    .filter((it) => it.broadcastWeekday === weekday)
    .filter((it) => !it.broadcastStartDate || it.broadcastStartDate <= todayStr)
    .sort((a, b) => b.watchers - a.watchers);
  if (today.length === 0) return null;

  const wl = WEEKDAY_LABEL[weekday];
  const header = `【${wl}曜】今日放送・配信の今期アニメ（${year}年${label}）`;
  const tag = `#${year}年${label}アニメ`;

  // タイトルを1本ずつ足していき、上限を超えない範囲で最大数を載せる。
  const picks = [];
  for (const it of today) {
    const line = it.broadcastTime ? `・${it.title}（${it.broadcastTime}〜）` : `・${it.title}`;
    const remain = today.length - (picks.length + 1);
    const tail = remain > 0 ? `ほか${remain}作品。曜日別はカレンダー表示で。` : "曜日別はカレンダー表示で。";
    const candidate = [header, "", ...picks, line, "", tail, url, tag].join("\n");
    if ([...candidate].length > MAX_LEN) break;
    picks.push(line);
  }
  // 1本も入らない極端なケースはヘッダーだけでも出す（通常は起きない）。
  if (picks.length === 0) {
    return truncate([header, "", url, tag].join("\n"), MAX_LEN);
  }
  const remain = today.length - picks.length;
  const tail = remain > 0 ? `ほか${remain}作品。曜日別はカレンダー表示で。` : "曜日別はカレンダー表示で。";
  return truncate([header, "", ...picks, "", tail, url, tag].join("\n"), MAX_LEN);
}

// 月〜土は1投稿（曜日紹介。放送作品が無ければTOP5にフォールバック）。
// 日曜は「TOP5」＋「その日の放送/配信があれば曜日紹介」の最大2投稿にする
// （2026-07-14: 日曜もアニメ紹介をする方針に変更）。
async function buildDigest(now = new Date()) {
  const { year, month, day, weekday } = jstParts(now);
  const { key: season, label } = currentSeasonByMonth(month);
  const todayStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const res = await fetch(`${SITE_URL}/api/season?year=${year}&season=${season}`);
  if (!res.ok) {
    throw new Error(`サイトのAPI取得に失敗しました（${res.status}）`);
  }
  const data = await res.json();
  const url = `${SITE_URL}/?year=${year}&season=${season}`;

  const airingText = buildTodayAiring(data, weekday, year, label, url, todayStr);
  const airingPost = airingText
    ? { text: airingText, screenshot: calendarScreenshot(url, WEEKDAY_LABEL[weekday]) }
    : null;

  const posts =
    weekday === 0
      ? [buildTop5(data, year, label, url), ...(airingPost ? [airingPost] : [])]
      : [airingPost ?? buildTop5(data, year, label, url)];

  return { posts, year, season, label, count: data.count, weekday };
}

// 新シーズン開始の告知文。season-announce.yml が各クール初日に呼ぶ。
async function buildSeasonAnnounce(now = new Date()) {
  const { year, month } = jstParts(now);
  const { key: season, label } = currentSeasonByMonth(month);

  const res = await fetch(`${SITE_URL}/api/season?year=${year}&season=${season}`);
  if (!res.ok) {
    throw new Error(`サイトのAPI取得に失敗しました（${res.status}）`);
  }
  const data = await res.json();
  const url = `${SITE_URL}/?year=${year}&season=${season}`;

  const lines = [
    `🎬 ${year}年${label}アニメ、始まりました！`,
    "",
    `今期${data.count}作品の配信状況を「アニメ視聴ガイド」でまとめています。どのアニメがどこで見られるか、サービス別に一覧でチェックできます。`,
    "",
    url,
    `#${year}年${label}アニメ`,
  ];
  return {
    posts: [{ text: truncate(lines.join("\n"), MAX_LEN), screenshot: null }],
    year,
    season,
    label,
    count: data.count,
  };
}

// 配信情報の充足率報告（sns-templates.md「2. 配信情報が埋まってきた報告」に対応）。
// シーズン開始2〜3週間後、「◯件中◯件で配信サービスが判明」を毎回手で数えず自動生成する。
// hasBroadcastData（TV放送含む番組データが1件でもあるか）ではなく、実際に見られる
// 配信サービスが1件でもあるかで「判明」を判定する（lib/services.tsのAnimeItem.services）。
function buildCoverageReport(data, year, label, url) {
  const total = data.count;
  const filled = data.items.filter((it) => it.services && it.services.length > 0).length;
  const lines = [
    `今期（${year}年${label}アニメ）の配信情報、現在${total}件中${filled}件で配信サービスが判明しています。`,
    "（残りは配信側の登録待ち。見つかり次第自動反映されます）",
    "",
    url,
    `#${year}年${label}アニメ`,
  ];
  return truncate(lines.join("\n"), MAX_LEN);
}

// 新機能・修正の告知（sns-templates.md「3. バグ修正の告知」「4. 新機能の告知」に対応）。
// featureName（機能名・一言タイトル）とfeatureDesc（説明。省略可）を埋め込むだけの
// シンプルなテンプレートで、文章そのものの創作はしない（事実を渡す側の責任にする）。
function buildFeatureAnnounce(featureName, featureDesc, year, label, url) {
  if (!featureName) {
    throw new Error("featureName が空です（FEATURE_NAME env か第2引数で渡してください）");
  }
  const lines = [
    "アニメ視聴ガイドに新機能を追加しました。",
    `▶ ${featureName}`,
    ...(featureDesc ? [featureDesc] : []),
    "",
    url,
  ];
  return truncate(lines.join("\n"), MAX_LEN);
}

// 投稿スクリプト共通の入口。環境変数 POST_KIND で内容を切り替える。
//   （未設定/"digest"）= 日次ダイジェスト（曜日で出し分け）
//   "season"          = 新シーズン開始の告知
//   "coverage"        = 配信情報の充足率報告（件数は実データから自動算出）
//   "feature"         = 新機能・修正の告知（FEATURE_NAME/FEATURE_DESC env が必要）
async function buildPost(now = new Date()) {
  const kind = process.env.POST_KIND || "digest";
  if (kind === "season") return buildSeasonAnnounce(now);
  if (kind === "digest") return buildDigest(now);

  // coverage/feature は「今期の件数」という共通の実データが要るので、ここで一度だけ取得する。
  const { year, month } = jstParts(now);
  const { key: season, label } = currentSeasonByMonth(month);
  const res = await fetch(`${SITE_URL}/api/season?year=${year}&season=${season}`);
  if (!res.ok) {
    throw new Error(`サイトのAPI取得に失敗しました（${res.status}）`);
  }
  const data = await res.json();
  const url = `${SITE_URL}/?year=${year}&season=${season}`;

  if (kind === "coverage") {
    const text = buildCoverageReport(data, year, label, url);
    return { posts: [{ text, screenshot: null }], year, season, label, count: data.count };
  }
  if (kind === "feature") {
    const text = buildFeatureAnnounce(process.env.FEATURE_NAME, process.env.FEATURE_DESC, year, label, url);
    return { posts: [{ text, screenshot: null }], year, season, label, count: data.count };
  }
  throw new Error(`未知の POST_KIND です: ${kind}`);
}

module.exports = {
  buildDigest,
  buildSeasonAnnounce,
  buildCoverageReport,
  buildFeatureAnnounce,
  buildPost,
  truncate,
  MAX_LEN,
  SITE_URL,
};
