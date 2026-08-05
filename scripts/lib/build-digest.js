// SNS投稿下書きを組み立てる共通ロジック。曜日によって内容を出し分ける（毎日投稿ローテーション）。
//   日曜: 今期の注目作TOP5 ＋ その日に放送/配信があれば曜日紹介（2投稿になりうる）
//   月〜土: その曜日に放送/配信のある今期アニメ（broadcastWeekdayで抽出）
// さらに毎日「スポットライト（【どこで見れる？】）」が1本加わる。
// 1日分をまとめて連投せず、内容の種類ごとに時間をずらして出す（DIGEST_SLOT。下の SLOTS 参照）。
// デプロイ済みの本番サイトのAPI（/api/season）を叩くだけなので、
// ANNICT_TOKENの複製やAnnictへの直接アクセスは不要。
// DIGEST_SITE_URL を設定すると差し替えられる（ローカルの開発サーバーに向けた動作確認用）。
const SITE_URL = process.env.DIGEST_SITE_URL || "https://animedia-khaki.vercel.app";

// スポットライト枠（2026-07-27導入）の対象作品リスト。実測データの一次情報は
// content/sns/spotlight.js 側のコメントを参照。
const { SPOTLIGHT_WORKS } = require("../../content/sns/spotlight");

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

// ── 投稿の時間帯枠（2026-08-05導入）────────────────────────────────────
// 1日分の投稿を一度に連投せず、内容の種類ごとに時間帯を分けて出す。
//   9〜11時  … 注目作TOP5（top5）
//   12〜14時 … 【どこで見れる？】のスポットライト（spotlight）
//   18〜21時 … その曜日の放送・配信（airing）
//
// 【なぜ「時刻」ではなく「時間帯」なのか】GitHub Actions の schedule は予定通りに
// 発火しない。旧構成（0 12 * * * ＝21:00 JST）の実測では遅延が2.1〜6.4時間（中央値
// 約5時間）あり、cronに何時と書いても投稿時刻はまったく守れなかった。
// そこで「予定時刻に起動して投稿する」のをやめ、**1時間おきに起動して、いまが
// どの枠の時間帯かを自分で判定し、その枠がまだ未投稿ならそこで投稿する**方式にした
// （daily-digest.yml）。遅延しても、次の起動が時間帯の中に入れば投稿できる。
// 二重投稿は「枠＋JST日付」をキーにしたGitHub Actionsのキャッシュで防ぐ。
//
// daily-digest.yml は起動のたびに scripts/current-slot.js を呼んで枠を決め、
// DIGEST_SLOT として渡す。未設定（または "all"）なら従来どおり全部返す＝手動実行用。
// 時間帯の定義はこのファイルだけが持つ（ワークフロー側に時刻を書かない）。
const SLOTS = {
  morning: { fromHour: 9, toHour: 11, kinds: ["top5"] },
  noon: { fromHour: 12, toHour: 14, kinds: ["spotlight"] },
  evening: { fromHour: 18, toHour: 21, kinds: ["airing"] },
};

// 【Mastodonだけ従来方式・2026-08-05】Mastodonは時間帯で分けず、**1日1回21時台に
// その日の分をまとめて**投稿する（利用者の指定で従来の運用に戻した）。
// SLOTS と分けてあるのは、こちらは「内容を絞る枠」ではなく「まとめて出す時刻」だから。
// kinds を持たない＝絞り込みをしない（その日の全投稿を出す）。
// 時間帯の考え方（開始時刻＝fromHour で基準日を固定する／その日のうちなら遅れても出す）は
// SLOTS と同じものを使うので、21時台を逃しても日付が変わるまでは投稿できる。
const BATCH_SLOTS = {
  mastodon: { fromHour: 21, toHour: 23 },
};

// DIGEST_SLOT の値から設定を引く。SLOTS（Bluesky/Threads用）→ BATCH_SLOTS（Mastodon用）の順。
// どちらでもない（未設定・"all"・手動実行の指定など）なら null ＝ 絞り込みも日付固定もしない。
function slotConfig(name) {
  return SLOTS[name] || BATCH_SLOTS[name] || null;
}

function jstHourOf(now) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCHours();
}

// いまのJST時刻がどの枠の時間帯の「中」かを返す（どれにも入らなければ null）。
// daily-digest.yml が1時間おきの起動のたびにこれを呼ぶ。
function slotForNow(now = new Date()) {
  const jstHour = jstHourOf(now);
  const found = Object.entries(SLOTS).find(
    ([, s]) => jstHour >= s.fromHour && jstHour <= s.toHour
  );
  return found ? found[0] : null;
}

// Mastodonのまとめ投稿（21時台）の開始時刻を迎えているか。SLOTS の dueSlots と同じ考え方で、
// 21時台を逃してもJSTの同じ日のうちなら遅れて投げてよい、という判定に使う。
function isMastodonBatchDue(now = new Date()) {
  return jstHourOf(now) >= BATCH_SLOTS.mastodon.fromHour;
}

// 【遅れ投稿・2026-08-05追加】その日すでに開始時刻を迎えた枠を、時系列順に返す。
// 時間帯を過ぎていても、まだ投稿できていない枠は**その日のうちなら**投げる、という
// 取りこぼし対策に使う（daily-digest.yml が「投稿済みか」をキャッシュで見て判断する）。
//
// なぜ要るか: GitHub Actions は高負荷時に schedule を大量に間引く。このリポジトリの
// 実測（warm-cache.yml の */5 指定）では本来1,046回のうち実際の起動は30回だけで、
// 起動間隔の中央値2.5時間・最大13時間だった。1時間おきに起動を頼んでも、18〜21時の
// 4時間枠を丸ごと逃す確率がおよそ16%（約6日に1日）ある。
// 「狙った時間帯に出す」を第一希望としつつ、逃した日は遅れてでも出す方がよい、という
// 判断（2026-08-05）。JSTの日付が変わったら諦める（内容が前日のものになるため）。
function dueSlots(now = new Date()) {
  const jstHour = jstHourOf(now);
  return Object.entries(SLOTS)
    .filter(([, s]) => jstHour >= s.fromHour)
    .sort((a, b) => a[1].fromHour - b[1].fromHour)
    .map(([key]) => key);
}

// 【重要・2026-08-05導入】GitHub Actions の schedule は予定より数時間遅れて発火する
// （このリポジトリの実測で最大6.4時間）。従来の cron は 12:00 UTC = 21:00 JST で、
// JST の日付が変わるまで3時間しか余裕が無かったため、遅延した実行が翌日にずれ込み
// **2日続けて同じJST日付の内容を投稿する**事故が起きた（2026-08-04。Issue #31 が
// 8/4 03:27 JST に、#32 が 8/4 23:05 JST に発火し、どちらも【火曜】＋同じスポット
// ライト作品で本文が完全に一致した）。
// 実行が予定より「早く」始まることはないので、いまのJST時刻がその枠の予定時刻より
// 前なら、それは日付をまたいで遅延した実行＝前日の枠だと確定できる。
// 枠が分からないとき（手動実行など）は何もしない。
function anchorToSlotDate(now, slotHour) {
  if (slotHour == null) return now;
  const jstHour = new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCHours();
  return jstHour < slotHour ? new Date(now.getTime() - 24 * 60 * 60 * 1000) : now;
}

function truncate(text, max) {
  const chars = [...text];
  if (chars.length <= max) return text;
  return chars.slice(0, max - 1).join("") + "…";
}

// Threads専用: 末尾のハッシュタグ行を先頭の1つだけに削る。
//
// Threadsは1投稿につき「トピックタグ」を1つしか受け付けない（Meta公式の仕様。タグ乱用を
// 防ぐための意図的な制限）。2つ目以降の「#タグ」はリンクにならず地の文としてそのまま
// 残るため、複数タグを書くと投稿の末尾が中途半端に壊れて見える。
// 2026-07-27にスポットライト枠へ作品名タグを足して1投稿2タグになったため、Threadsだけ
// この関数を通す（X/Bluesky/Mastodonは複数タグが正常に機能するので本文は変えない）。
//
// なお、Threadsは採用したトピックタグを「#」記号なしで表示する（2023-12の仕様変更）。
// 投稿画面に「#」が出ないのは欠落ではなく仕様であり、タグ自体は機能している。
//
// 末尾行がハッシュタグだけで構成されている場合にのみ働き、それ以外の本文には触らない。
// 将来どの投稿種別にタグを増やしても自動的に効くように、タグ配列ではなく本文側で判定する。
const HASHTAG_ONLY_LINE = /^#\S+(?:[ 　]+#\S+)+$/;
function toSingleHashtagText(text) {
  const lines = text.split("\n");
  const lastIndex = lines.length - 1;
  if (!HASHTAG_ONLY_LINE.test(lines[lastIndex])) return text;
  lines[lastIndex] = lines[lastIndex].split(/[ 　]+/)[0];
  return lines.join("\n");
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

// Threads用の画像URL（2026-07-27追加）。
// Threads APIは画像のバイナリ投稿に対応しておらず、公開サーバー上の image_url を
// cURLで取りに来る仕様のため、Playwrightで撮ったPNG（公開URLを持たない）は添付できない。
// そこでサイト側に同等の内容を描く公開エンドポイント（app/api/sns-image）を用意し、
// そのURLを渡す。screenshot（Playwright用のページURL+セレクタ）とは別物なので分けて持つ。
function airingImage(weekdayLabel) {
  return `${SITE_URL}/api/sns-image?kind=airing&day=${encodeURIComponent(weekdayLabel)}`;
}
function rankingImage() {
  return `${SITE_URL}/api/sns-image?kind=ranking`;
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
  return { kind: "top5", text: truncate(lines.join("\n"), MAX_LEN), screenshot: rankingScreenshot(url), image: rankingImage() };
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

// スポットライト枠（2026-07-27導入）: GSC・Vercel Analyticsの実測で需要が確認できている
// 作品（content/sns/spotlight.js の SPOTLIGHT_WORKS）を、日替わりで1本だけ名指しで紹介し
// 作品ページへ直接送客する。従来の「その曜日の放送作品」「TOP5」は一覧型で、実際にアクセスが
// 来ている作品を個別に押し出す枠が無かったため追加。
// 該当作品が無ければ null（呼び出し側でスキップ）。
function buildSpotlight(data, year, label, todayStr) {
  const itemById = new Map(data.items.map((it) => [it.id, it]));

  const candidates = SPOTLIGHT_WORKS
    // APIの実データ（it）にSPOTLIGHT_WORKS側のhashtagを合流させる。単純にitemById.get()の
    // 結果だけを使うとAPI側のオブジェクトに置き換わり、元エントリのhashtagが消えてしまうため。
    .map((w) => {
      const it = itemById.get(w.annictId);
      return it ? { ...it, hashtag: w.hashtag } : null;
    })
    // 1) SPOTLIGHT_WORKS のうち、今見ているクールに存在しない作品は除外（過去クール混入対策）
    .filter((it) => it != null)
    // 2) 配信サービスが0件の作品は除外（「どこで見れる？」の答えが無いため）
    .filter((it) => it.services && it.services.length > 0)
    // 3) 放送開始1週間前ルール（CLAUDE.md準拠）と同じ趣旨で、broadcastStartDateが今日より
    //    後（＝まだ1話も配信されていない）作品は除外する。未放送作を「配信中」と紹介すると
    //    誤誘導になる。broadcastStartDateが無い（＝既に配信中で曜日枠が無い等）作品は対象にする。
    .filter((it) => !it.broadcastStartDate || it.broadcastStartDate <= todayStr);

  if (candidates.length === 0) return null;

  // 日替わりで1件をローテーション。Math.random()は使わず、1970-01-01からの経過日数を
  // 候補数で割った余りでインデックスを決める（同じ日なら何度実行しても同じ結果になる）。
  // 日付の数字の和ではなく経過日数を使うのは、和だと衝突が多く（7/27と7/30が同じ値になる）
  // 一部の作品ばかり選ばれてしまうため。経過日数なら候補を必ず1周ずつ均等に回る。
  const dayIndex = Math.floor(Date.parse(`${todayStr}T00:00:00Z`) / 86400000);
  const picked = candidates[dayIndex % candidates.length];

  const [, m, d] = todayStr.split("-");
  const dateLabel = `${Number(m)}/${Number(d)}`;

  const serviceNames = picked.services.map((s) => s.short);
  const serviceLine =
    serviceNames.length <= 3
      ? `${serviceNames.join("・")}で配信中（${dateLabel}時点）。`
      : `${serviceNames.slice(0, 3).join("・")}ほか計${serviceNames.length}サービスで配信中（${dateLabel}時点）。`;
  // 注目人数は「多い」と読めるときだけ出す。「35人が注目」のように小さい数字を載せると
  // 興味付けどころか不人気の印象になるため、100人未満は行ごと省く（数字を盛らない代わりに
  // 黙る、という扱い。CLAUDE.mdの「推測や創作で埋めない」方針と両立させる）。
  const WATCHERS_MIN = 100;
  const watchersLine =
    picked.watchers >= WATCHERS_MIN ? `${picked.watchers.toLocaleString("ja-JP")}人が注目。` : "";

  // リンクは必ず作品ページ（/anime/{annictId}）にする。従来のダイジェスト投稿はトップページ
  // URLだったが、GSC実測で検索表示が付いているのは作品ページのため、SNSからの導線もそこに
  // 集約する（トップページ経由だと再検索の手間が発生し離脱しやすい）。
  const seasonTag = `#${year}年${label}アニメ`;
  // 作品名タグ（hashtag、2026-07-27追加）は季節タグより先に置く。作品名の方が検索・通知に
  // 引っかかりやすく、埋もれさせたくないため（content/sns/spotlight.jsのコメント参照）。
  const workTag = picked.hashtag ? `#${picked.hashtag}` : null;
  // スポットライトは1作品を名指しする投稿なので、Threadsに添付する画像はその作品ページの
  // OGP画像（既存の app/anime/[id]/opengraph-image）をそのまま使う。専用の画像を
  // 作り足す必要がなく、リンク先と絵柄が一致する。
  const workImage = `${SITE_URL}/anime/${picked.id}/opengraph-image`;
  const buildLines = (tagLine) => [
    `【どこで見れる？】${picked.title}`,
    "",
    `${watchersLine}${serviceLine}`,
    "見放題で見られるサービスをまとめています。",
    "",
    `${SITE_URL}/anime/${picked.id}`,
    tagLine,
  ];

  if (workTag) {
    const withWorkTag = buildLines(`${workTag} ${seasonTag}`).join("\n");
    // 260字上限は必ず守る。ただし既存のtruncate()は末尾を「…」で機械的に切るため、
    // ハッシュタグの途中で千切れると検索に引っかからなくなる。それを避けるため、
    // 超過時は先にtruncateへ流さず、作品名タグごと落として季節タグだけに戻す
    // （通常の投稿文＝季節タグのみは元々260字に収まる想定のため、この段階で切り詰める
    // 必要はまず発生しない）。
    if ([...withWorkTag].length <= MAX_LEN) {
      return { kind: "spotlight", text: withWorkTag, screenshot: null, image: workImage };
    }
  }
  return { kind: "spotlight", text: truncate(buildLines(seasonTag).join("\n"), MAX_LEN), screenshot: null, image: workImage };
}

// 月〜土は1投稿（曜日紹介。放送作品が無ければTOP5にフォールバック）。
// 日曜は「TOP5」＋「その日の放送/配信があれば曜日紹介」の最大2投稿にする
// （2026-07-14: 日曜もアニメ紹介をする方針に変更）。
async function buildDigest(now = new Date()) {
  // どの時間帯枠の実行か（DIGEST_SLOT）。未設定/"all" なら枠で絞らず全部返す。
  const slot = slotConfig(process.env.DIGEST_SLOT);
  const { year, month, day, weekday } = jstParts(anchorToSlotDate(now, slot?.fromHour));
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
    ? {
        kind: "airing",
        text: airingText,
        screenshot: calendarScreenshot(url, WEEKDAY_LABEL[weekday]),
        image: airingImage(WEEKDAY_LABEL[weekday]),
      }
    : null;

  const posts =
    weekday === 0
      ? [buildTop5(data, year, label, url), ...(airingPost ? [airingPost] : [])]
      : [airingPost ?? buildTop5(data, year, label, url)];

  // スポットライト枠は曜日による出し分けをせず毎日追加する（候補が無ければ追加しない）。
  const spotlightPost = buildSpotlight(data, year, label, todayStr);
  if (spotlightPost) posts.push(spotlightPost);

  // 時間帯枠で絞る（2026-08-05導入）。その枠に出す内容が無い日は空配列になり、
  // 各post-*.jsは「投稿0件」として何もせず正常終了する。
  // 例: 月〜土は放送作品があるので morning(top5) が空、日曜は3枠とも埋まる。
  // kinds を持つ枠（SLOTS）だけ内容を絞る。Mastodonのまとめ投稿（BATCH_SLOTS）は
  // kinds を持たないので、その日の全投稿がそのまま出る。
  return {
    posts: slot?.kinds ? posts.filter((p) => slot.kinds.includes(p.kind)) : posts,
    year,
    season,
    label,
    count: data.count,
    weekday,
    todayStr,
  };
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
  toSingleHashtagText,
  MAX_LEN,
  SITE_URL,
  // 週次X成長キット（build-growth-kit.js）から再利用する小ヘルパー。
  jstParts,
  currentSeasonByMonth,
  shortTitle,
  // 時間帯枠（2026-08-05導入）。ワークフローの cron とテストから参照する。
  SLOTS,
  BATCH_SLOTS,
  slotConfig,
  slotForNow,
  dueSlots,
  isMastodonBatchDue,
  anchorToSlotDate,
};
