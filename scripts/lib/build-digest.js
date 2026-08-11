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

// ── 投稿先SNSごとの本文の出し分け（2026-08-06導入）──────────────────────────
//
// 【なぜ入れたか】3週間・約70投稿でフォロワーが3SNS合計4人だったときのレビュー結果
// （docs/handoff.md「SNS運用について」）で、次の3点が構造的な問題として挙がった:
//   (1) Bluesky / Mastodon / Threads が完全に同一の本文（Threadsのタグ数調整だけが差分）。
//       同じ文面を3か所へ配るのは単なるクロスポストで、どのSNSでも「よそで見た」扱いになる。
//   (2) 曜日固定の番組表なので、毎週ほぼ一字一句同じ投稿がリピーターのタイムラインに流れる。
//   (3) 告知型100%で、返信・引用を誘発する要素が無い。会話が起きないのでリーチが伸びない。
//
// 出し分けの軸は2つだけにしてある:
//   ・投稿先（platform）… Mastodonは5〜7時台に**その日の分をまとめて**出す枠（BATCH_SLOTS）
//     なので「おはようございます／今日は○本」と1日の全体像から入る。Bluesky/Threadsは
//     時間帯ごとに内容が絞られている（朝=注目作TOP5 / 昼=スポットライト / 夜=その曜日の
//     放送・配信）ので、その時間帯に合う短い導入にする。
//   ・週（weekIndex）… 同じ曜日・同じ作品でも週が変われば言い回しが変わる。
//
// 【乱数を使わない】Math.random() で毎回変えると、再実行やリトライのたびに本文が変わり
// 「これは二重投稿か／dry_runで見た本文と同じものが出たか」を判別できなくなる。
// GitHub Actions は間引き・遅れ投稿で同じ枠を複数回起動しうる（⑦-9）ので、
// バリエーションの入力は **JSTの日付だけ** に固定する（同じ日なら何度実行しても同じ本文）。
//
// 【書いてよいこと】埋め込む変数は事実だけ（曜日・本数・年・季節・作品名・配信サービス名・
// 注目人数）。作品の評価（面白い/つまらない/おすすめ）は書かない。このサイトの立場は
// 「どこで観られるかの案内」であって作品批評ではない（CLAUDE.mdの「創作しない」方針）。
const PLATFORMS = ["x", "bluesky", "mastodon", "threads"];

// 未指定は "x"（＝Xの手動投稿用の下書き。print-digest.js の既定でもある）。
// 綴り間違いは黙って既定に落とさず落とす。落ちれば動作確認で必ず気づけるが、
// 黙って落とすと「なぜかBluesky向けの文面にならない」という気づけない不具合になる。
function normalizePlatform(platform) {
  if (platform == null || platform === "") return "x";
  if (!PLATFORMS.includes(platform)) {
    throw new Error(`未知の投稿先です: ${platform}（${PLATFORMS.join(" / ")} のいずれか）`);
  }
  return platform;
}

// 本文の上限。既定（x）は280字のXと300字のBlueskyの双方に安全に収まる260字。
// Mastodon・Threadsは上限500字なので、朝のまとめ（Mastodon）で作品を多く載せられるよう
// 余裕を持たせる。Blueskyは300字上限なので既定と同じ260字のまま。
const PLATFORM_MAX_LEN = { x: MAX_LEN, bluesky: MAX_LEN, mastodon: 440, threads: 440 };
function maxLenFor(platform) {
  return PLATFORM_MAX_LEN[platform] || MAX_LEN;
}

// 1970-01-01からの経過日数。buildSpotlightの日替わりローテーションと同じ考え方。
function daysSinceEpoch(todayStr) {
  return Math.floor(Date.parse(`${todayStr}T00:00:00Z`) / 86400000);
}
// 通し週番号。曜日固定の投稿（毎週水曜の番組表など）でも週が変われば必ず別の値になるので、
// 「毎週まったく同じ本文」を避けられる。日付の数字の和のような衝突しやすい値は使わない。
function weekIndex(todayStr) {
  return Math.floor(daysSinceEpoch(todayStr) / 7);
}
// 文字列から0〜996の決定的な値を作る。バリエーションの位相をずらすためだけに使う
// （同じ週にBluesky・Threads・Mastodonが揃って同じ番号の言い回しを選ぶのを防ぐ）。
function saltOf(key) {
  let n = 0;
  for (const ch of key) n = (n * 31 + ch.codePointAt(0)) % 997;
  return n;
}
// platform 別の言い回し配列から、その週の1つを選ぶ。
// 専用の配列を持たない platform は x（既定）にフォールバックする。
function pickFor(table, platform, key, todayStr) {
  const list = table[platform] || table.x;
  return list[(weekIndex(todayStr) + saltOf(`${key}:${platform}`)) % list.length];
}

// その曜日の放送・配信（airing）の1行目。
// x は従来の文面のまま1つだけ持つ（Xは人が手を入れて投稿する下書きで、
// docs/sns-templates.md の見本との対応を崩したくないため）。
const AIRING_LEAD = {
  x: [(c) => `【${c.wl}曜】今日放送・配信の今期アニメ（${c.year}年${c.label}）`],
  bluesky: [
    (c) => `【${c.wl}曜】今日の放送・配信は${c.n}本です。`,
    (c) => `【${c.wl}曜】今夜からの放送・配信、${c.n}本ぶんの配信先をまとめました。`,
    (c) => `今日（${c.wl}曜）放送・配信がある今期アニメは${c.n}本。`,
    (c) => `【${c.wl}曜】${c.year}年${c.label}アニメ、今日の放送・配信は${c.n}本です。`,
  ],
  threads: [
    (c) => `${c.wl}曜のアニメ、今日は${c.n}本。どこで観られるかをまとめています。`,
    (c) => `【${c.wl}曜】今日放送・配信があるのは${c.n}本です。`,
    (c) => `今日は${c.wl}曜。放送・配信のある今期アニメ${c.n}本の配信先です。`,
    (c) => `【${c.wl}曜】今日の${c.n}本、配信サービス別に一覧にしています。`,
  ],
  mastodon: [
    (c) => `おはようございます。今日（${c.dateLabel}・${c.wl}）放送・配信がある今期アニメは${c.n}本です。`,
    (c) => `おはようございます。${c.dateLabel}（${c.wl}曜）の放送・配信は${c.n}本。今日観られる分をまとめました。`,
    (c) => `おはようございます。今日は${c.wl}曜、${c.year}年${c.label}アニメの放送・配信は${c.n}本です。`,
    (c) => `おはようございます。${c.dateLabel}（${c.wl}曜）に放送・配信がある${c.n}本の配信先です。`,
  ],
};

// 一覧の締め（カレンダー表示への誘導）。
const CALENDAR_CTA = {
  x: ["曜日別はカレンダー表示で。"],
  bluesky: ["曜日別はカレンダー表示で。", "曜日ごとの一覧はカレンダー表示から。", "ほかの曜日もカレンダー表示で見られます。"],
  threads: ["曜日別はカレンダー表示で。", "ほかの曜日はカレンダー表示から。", "曜日ごとの並びはカレンダー表示で。"],
  mastodon: ["今週ぶんの並びはカレンダー表示で。", "曜日別はカレンダー表示で。", "ほかの曜日もカレンダー表示から見られます。"],
};

// 注目作TOP5（top5）の1行目。
const TOP5_LEAD = {
  x: [(c) => `今週の「アニメ視聴ガイド」注目作TOP5（${c.year}年${c.label}アニメ）`],
  bluesky: [
    (c) => `今週の注目作TOP5（${c.year}年${c.label}アニメ）`,
    (c) => `【注目作TOP5】${c.year}年${c.label}アニメ、視聴者数の多い5作品です。`,
    (c) => `${c.year}年${c.label}アニメの注目作TOP5。配信サービスはリンク先にまとめています。`,
  ],
  threads: [
    (c) => `【注目作TOP5】${c.year}年${c.label}アニメ`,
    (c) => `${c.year}年${c.label}アニメで視聴者数の多い5作品です。`,
    (c) => `今週の注目作TOP5（${c.year}年${c.label}アニメ）。どこで観られるかも一覧に。`,
  ],
  mastodon: [
    (c) => `おはようございます。今週の注目作TOP5（${c.year}年${c.label}アニメ）です。`,
    (c) => `おはようございます。${c.year}年${c.label}アニメの注目作TOP5をお届けします。`,
    (c) => `おはようございます。今週も${c.year}年${c.label}アニメの注目作TOP5から。`,
  ],
};

// スポットライト（spotlight）の説明行。配信サービス名の行の直後に置く。
const SPOTLIGHT_BODY = {
  x: [() => "見放題で見られるサービスをまとめています。"],
  bluesky: [
    () => "見放題で見られるサービスをまとめています。",
    () => "どのサービスで見放題になっているかを一覧にしています。",
    () => "配信サービスの一覧はリンク先から。",
  ],
  threads: [
    () => "見放題で観られるサービスを一覧にしています。",
    () => "どこで見放題かはリンク先にまとめました。",
    () => "配信サービスの一覧はこちらです。",
  ],
  mastodon: [
    () => "見放題で見られるサービスをまとめています。",
    () => "朝のうちに配信先だけまとめておきます。",
    () => "どのサービスで見放題かをまとめています。",
  ],
};

// 返信・引用を誘発する一文（2026-08-06導入）。
// 作品の評価に踏み込む問い（面白い？つまらない？）は作らない。聞くのは
// 「どこで観ているか」「何を追いかけているか」「配信情報の抜け」＝サイトの守備範囲の中だけ。
const QUESTION = {
  airing: [
    "今日はどれから観ますか？",
    "配信サービスが抜けている作品があれば教えてください。反映できるか確認します。",
    "この曜日でいちばん楽しみにしている作品はどれですか？",
  ],
  spotlight: [
    "ほかに「どこで見れる？」を調べたい作品があれば教えてください。",
    "この作品、どのサービスで観ていますか？",
  ],
  top5: [
    "今期、いちばん追いかけている作品はどれですか？",
    "この5本以外で気になっている作品があれば教えてください。",
  ],
};

// 問いかけを入れる頻度。毎投稿に入れると押しつけがましく、告知としての読みやすさも落ちる。
// 種類ごとに「週に1〜2回」程度へ絞る。判定に使うのは曜日と通し週番号だけ＝決定的
// （同じ日に何度実行しても同じ結果）。
//   airing    … 水曜と土曜だけ（週2回）
//   spotlight … 隔週（通し週番号が偶数の週だけ）
//   top5      … 3週に1回
//
// due … その日に問いかけを入れるか。
// seq … 「何回目の登場か」の通し番号。言い回しの回転にはこれを使う。
//   【なぜ日付や週番号を直接使わないか】出す条件自体が週番号の余り（隔週・3週に1回）なので、
//   日付や週番号で回すと登場日の間隔と言い回しの周期が噛み合ってしまい、位相が固定されて
//   **毎回まったく同じ問いかけしか出ない**（実際、最初の実装で隔週スポットライトが
//   4回連続で同じ文になった）。登場回数を数えれば必ず1つずつ順に回る。
const QUESTION_RULE = {
  airing: {
    due: (w, weekday) => weekday === 3 || weekday === 6,
    // 通し週番号は1970-01-01（木）起点なので、1週＝木〜水。つまり同じ週の中では
    // 土曜が先・水曜が後に来る。この順で0,1と割り当てると登場回数の通し番号になる。
    seq: (w, weekday) => w * 2 + (weekday === 3 ? 1 : 0),
  },
  spotlight: { due: (w) => w % 2 === 0, seq: (w) => Math.floor(w / 2) },
  top5: { due: (w) => w % 3 === 0, seq: (w) => Math.floor(w / 3) },
};

// Xの下書き（x）には入れない。手動投稿で人が文面を整える前提のため。
function questionFor(name, platform, todayStr, weekday) {
  if (platform === "x") return null;
  const list = QUESTION[name];
  const rule = QUESTION_RULE[name];
  if (!list || !rule) return null;
  const w = weekIndex(todayStr);
  if (!rule.due(w, weekday)) return null;
  return list[(rule.seq(w, weekday) + saltOf(`${name}:${platform}`)) % list.length];
}

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
//   7〜10時  … 注目作TOP5（top5）
//   11〜12時 … 【どこで見れる？】のスポットライト（spotlight）
//   18〜21時 … その曜日の放送・配信（airing）
//
// 【なぜスポットライトが11〜12時なのか・2026-08-05】昼休みに見られる12時台に確実に
// 届かせたいため。12時開始にすると、GitHubの間引き（起動間隔の中央値2.5時間）で
// 13時台・14時台にずれ込み昼のピークを外すことが多い。1時間手前から窓を開けておけば
// 12時台までに投げ終わる可能性が高くなる。
// morning は noon と重ならない範囲でできるだけ広く取り、7〜10時としてある（枠同士は
// 重ねられない。重なると slotForNow の結果が定義順に依存して不安定になる）。
// 朝は窓が広いほど「間引きで丸ごと逃す」確率が下がる。
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
  morning: { fromHour: 7, toHour: 10, kinds: ["top5"] },
  noon: { fromHour: 11, toHour: 12, kinds: ["spotlight"] },
  evening: { fromHour: 18, toHour: 21, kinds: ["airing"] },
};

// 【Mastodonだけ従来方式・2026-08-05】Mastodonは時間帯で分けず、**1日1回・その日の分を
// まとめて**投稿する（利用者の指定で従来の運用に戻した）。
// SLOTS と分けてあるのは、こちらは「内容を絞る枠」ではなく「まとめて出す時刻」だから。
// kinds を持たない＝絞り込みをしない（その日の全投稿を出す）。
// 時間帯の考え方（開始時刻＝fromHour で基準日を固定する／その日のうちなら遅れても出す）は
// SLOTS と同じものを使うので、時間帯を逃しても日付が変わるまでは投稿できる。
//
// 【2026-08-06変更】21〜23時台 → **5〜7時台**（利用者の指定）。朝いちばんに「今日は
// 何が観られるか」を出す形になるので、内容（その日の放送・配信）とも噛み合う。
// 副次的な利点として、JSTの日付が変わるまでの余裕が3時間から19時間に延びる。
// GitHub Actions の schedule 遅延は実測で最大6.4時間あり、21時起点だと遅延がそのまま
// 日付またぎ＝前日分の投稿になりうる位置だった（`anchorToSlotDate` で事故は防いでいるが、
// その場合その日の投稿が丸ごと消える）。5時起点なら遅延しても同じJST日の中に収まる。
const BATCH_SLOTS = {
  mastodon: { fromHour: 5, toHour: 7 },
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

// Mastodonのまとめ投稿（5〜7時台）の開始時刻を迎えているか。SLOTS の dueSlots と同じ考え方で、
// 5〜7時台を逃してもJSTの同じ日のうちなら遅れて投げてよい、という判定に使う。
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
// url = 本文に貼るリンク（シーズンページ）、shotUrl = スクリーンショットの撮影先
// （撮影用クエリを解釈するトップページ）。既定では両方同じものを使う。
// todayStr/platform は1行目の言い回しと問いかけの出し分けに使う（2026-08-06追加）。
function buildTop5(data, year, label, url, shotUrl = url, todayStr, platform = "x") {
  const top5 = [...data.items].sort((a, b) => b.watchers - a.watchers).slice(0, 5);
  const lead = pickFor(TOP5_LEAD, platform, "top5", todayStr)({ year, label });
  // TOP5は日曜（weekday=0）に出る枠なので曜日条件は持たせず、週番号だけで頻度を決める。
  const question = questionFor("top5", platform, todayStr, 0);
  const lines = [
    lead,
    "",
    ...top5.map((it, i) => `${i + 1}. ${shortTitle(it.title)}（${it.watchers.toLocaleString("ja-JP")}人が注目）`),
    "",
    ...(question ? [question] : []),
    url,
    `#${year}年${label}アニメ`,
  ];
  return {
    kind: "top5",
    text: truncate(lines.join("\n"), maxLenFor(platform)),
    screenshot: rankingScreenshot(shotUrl),
    image: rankingImage(),
  };
}

// 月〜土: その曜日に放送/配信のある今期アニメ。注目度順に、字数上限まで詰める。
// 該当作品が無ければ null（呼び出し側でTOP5にフォールバック）。
// 基本ルール（2026-07-11）: broadcastWeekdayは「毎週その曜日」の推定でしかなく、
// 放送開始前の作品も曜日が一致するだけで拾ってしまう（実例: Re:ゼロ4期奪還編を
// 8月開始前の水曜に「今日放送」と誤案内しかける）。実際に放送開始日を迎えている
// 作品（broadcastStartDate <= 今日）だけに絞る。
function buildTodayAiring(data, weekday, year, label, url, todayStr, platform = "x") {
  const today = data.items
    .filter((it) => it.broadcastWeekday === weekday)
    .filter((it) => !it.broadcastStartDate || it.broadcastStartDate <= todayStr)
    .sort((a, b) => b.watchers - a.watchers);
  if (today.length === 0) return null;

  const wl = WEEKDAY_LABEL[weekday];
  const [, mm, dd] = todayStr.split("-");
  // 1行目・締め・問いかけは投稿先と週で変える（2026-08-06導入。上のコピー表を参照）。
  const header = pickFor(AIRING_LEAD, platform, "airing", todayStr)({
    wl,
    n: today.length,
    year,
    label,
    dateLabel: `${Number(mm)}/${Number(dd)}`,
  });
  const cta = pickFor(CALENDAR_CTA, platform, "airing-cta", todayStr);
  const question = questionFor("airing", platform, todayStr, weekday);
  const questionLines = question ? [question] : [];
  const tag = `#${year}年${label}アニメ`;
  const max = maxLenFor(platform);

  // タイトルを1本ずつ足していき、上限を超えない範囲で最大数を載せる。
  const picks = [];
  for (const it of today) {
    const line = it.broadcastTime ? `・${it.title}（${it.broadcastTime}〜）` : `・${it.title}`;
    const remain = today.length - (picks.length + 1);
    const tail = remain > 0 ? `ほか${remain}作品。${cta}` : cta;
    const candidate = [header, "", ...picks, line, "", tail, ...questionLines, url, tag].join("\n");
    if ([...candidate].length > max) break;
    picks.push(line);
  }
  // 1本も入らない極端なケースはヘッダーだけでも出す（通常は起きない）。
  if (picks.length === 0) {
    return truncate([header, "", url, tag].join("\n"), max);
  }
  const remain = today.length - picks.length;
  const tail = remain > 0 ? `ほか${remain}作品。${cta}` : cta;
  return truncate([header, "", ...picks, "", tail, ...questionLines, url, tag].join("\n"), max);
}

// スポットライト枠（2026-07-27導入）: GSC・Vercel Analyticsの実測で需要が確認できている
// 作品（content/sns/spotlight.js の SPOTLIGHT_WORKS）を、日替わりで1本だけ名指しで紹介し
// 作品ページへ直接送客する。従来の「その曜日の放送作品」「TOP5」は一覧型で、実際にアクセスが
// 来ている作品を個別に押し出す枠が無かったため追加。
// 該当作品が無ければ null（呼び出し側でスキップ）。
function buildSpotlight(data, year, label, todayStr, platform = "x") {
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
  // 説明行と問いかけは投稿先と週で変える（2026-08-06導入。上のコピー表を参照）。
  const body = pickFor(SPOTLIGHT_BODY, platform, "spotlight", todayStr)();
  // スポットライトは曜日で出し分けない枠なので、頻度の判定にも曜日は渡さない（週番号だけ）。
  const question = questionFor("spotlight", platform, todayStr, 0);
  const max = maxLenFor(platform);
  const buildLines = (tagLine) => [
    `【どこで見れる？】${picked.title}`,
    "",
    `${watchersLine}${serviceLine}`,
    body,
    ...(question ? ["", question] : []),
    "",
    `${SITE_URL}/anime/${picked.id}`,
    tagLine,
  ];

  if (workTag) {
    const withWorkTag = buildLines(`${workTag} ${seasonTag}`).join("\n");
    // 文字数上限は必ず守る。ただし既存のtruncate()は末尾を「…」で機械的に切るため、
    // ハッシュタグの途中で千切れると検索に引っかからなくなる。それを避けるため、
    // 超過時は先にtruncateへ流さず、作品名タグごと落として季節タグだけに戻す
    // （通常の投稿文＝季節タグのみは元々上限に収まる想定のため、この段階で切り詰める
    // 必要はまず発生しない）。
    if ([...withWorkTag].length <= max) {
      return { kind: "spotlight", text: withWorkTag, screenshot: null, image: workImage };
    }
  }
  return { kind: "spotlight", text: truncate(buildLines(seasonTag).join("\n"), max), screenshot: null, image: workImage };
}

// 月〜土は1投稿（曜日紹介。放送作品が無ければTOP5にフォールバック）。
// 日曜は「TOP5」＋「その日の放送/配信があれば曜日紹介」の最大2投稿にする
// （2026-07-14: 日曜もアニメ紹介をする方針に変更）。
async function buildDigest(now = new Date(), rawPlatform) {
  const platform = normalizePlatform(rawPlatform);
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
  // 投稿本文に載せるリンク（2026-08-05変更）。
  // 以前は `/?year=&season=` を貼っていたが、トップページの canonical は "/" なので
  // このURLは検索エンジンから見ると「/」の重複でしかなく、シーズンページには何の
  // 手掛かりも渡らない。中身は同じなのだから、そのクール専用のSSRページ
  // （/season/{year}/{season}。canonicalもそれ自身）を指す方がよい。
  const shareUrl = `${SITE_URL}/season/${year}/${season}`;
  // スクリーンショットの撮影先だけは従来どおりクエリ付きのトップを使う。
  // view=calendar / ranking=open といった撮影用のクエリを読むのはトップ側だけで、
  // /season/... は固定表示モードのためこれらを解釈しない。
  const shotUrl = `${SITE_URL}/?year=${year}&season=${season}`;

  const airingText = buildTodayAiring(data, weekday, year, label, shareUrl, todayStr, platform);
  const airingPost = airingText
    ? {
        kind: "airing",
        text: airingText,
        screenshot: calendarScreenshot(shotUrl, WEEKDAY_LABEL[weekday]),
        image: airingImage(WEEKDAY_LABEL[weekday]),
      }
    : null;

  const top5Post = () => buildTop5(data, year, label, shareUrl, shotUrl, todayStr, platform);
  const posts =
    weekday === 0 ? [top5Post(), ...(airingPost ? [airingPost] : [])] : [airingPost ?? top5Post()];

  // スポットライト枠は曜日による出し分けをせず毎日追加する（候補が無ければ追加しない）。
  const spotlightPost = buildSpotlight(data, year, label, todayStr, platform);
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
    platform,
  };
}

// 新シーズン開始の告知文。season-announce.yml が各クール初日に呼ぶ。
// クールに1回しか出ないので週替わりのローテーションは持たせず、投稿先ごとの
// 呼びかけ（Mastodonは朝のまとめ枠なので「おはようございます」から入る）だけ変える。
const SEASON_ANNOUNCE_LEAD = {
  x: (c) => `🎬 ${c.year}年${c.label}アニメ、始まりました！`,
  bluesky: (c) => `🎬 ${c.year}年${c.label}アニメ、始まりました！`,
  threads: (c) => `${c.year}年${c.label}アニメが始まりました。`,
  mastodon: (c) => `おはようございます。${c.year}年${c.label}アニメが始まりました。`,
};

async function buildSeasonAnnounce(now = new Date(), rawPlatform) {
  const platform = normalizePlatform(rawPlatform);
  const { year, month } = jstParts(now);
  const { key: season, label } = currentSeasonByMonth(month);

  const res = await fetch(`${SITE_URL}/api/season?year=${year}&season=${season}`);
  if (!res.ok) {
    throw new Error(`サイトのAPI取得に失敗しました（${res.status}）`);
  }
  const data = await res.json();
  // buildDigest と同じ理由でシーズンページを指す（トップの canonical は "/" のため、
  // `/?year=&season=` を貼っても検索エンジンには重複URLとしか見えない）。
  const url = `${SITE_URL}/season/${year}/${season}`;

  const lines = [
    (SEASON_ANNOUNCE_LEAD[platform] || SEASON_ANNOUNCE_LEAD.x)({ year, label }),
    "",
    `今期${data.count}作品の配信状況を「アニメ視聴ガイド」でまとめています。どのアニメがどこで見られるか、サービス別に一覧でチェックできます。`,
    "",
    url,
    `#${year}年${label}アニメ`,
  ];
  return {
    posts: [{ text: truncate(lines.join("\n"), maxLenFor(platform)), screenshot: null }],
    year,
    season,
    label,
    count: data.count,
    platform,
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
//
// 第2引数 platform（2026-08-06追加）で投稿先SNSごとに本文を変える。
// 各 post-*.js が自分の投稿先を渡す（post-bluesky.js → "bluesky" など）。
// 省略時は "x"（Xの手動投稿用の下書き＝従来どおりの文面）。DIGEST_PLATFORM env でも指定でき、
// これは print-digest.js やワークフローの dry_run から本文を確認するための入口。
async function buildPost(now = new Date(), platform = process.env.DIGEST_PLATFORM) {
  const kind = process.env.POST_KIND || "digest";
  if (kind === "season") return buildSeasonAnnounce(now, platform);
  if (kind === "digest") return buildDigest(now, platform);

  // coverage/feature は「今期の件数」という共通の実データが要るので、ここで一度だけ取得する。
  const { year, month } = jstParts(now);
  const { key: season, label } = currentSeasonByMonth(month);
  const res = await fetch(`${SITE_URL}/api/season?year=${year}&season=${season}`);
  if (!res.ok) {
    throw new Error(`サイトのAPI取得に失敗しました（${res.status}）`);
  }
  const data = await res.json();
  // buildDigest と同じ理由でシーズンページを指す（上のコメント参照）。
  const url = `${SITE_URL}/season/${year}/${season}`;

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
  // 投稿先ごとの本文生成（2026-08-06導入）。ネットワークに出ずに本文だけを
  // 確かめられるよう、純粋関数のまま公開しておく（動作確認・回帰テスト用）。
  PLATFORMS,
  normalizePlatform,
  maxLenFor,
  weekIndex,
  buildTop5,
  buildTodayAiring,
  buildSpotlight,
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
