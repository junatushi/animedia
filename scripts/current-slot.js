// いまのJST時刻から「どの枠を投稿すべきか」の材料を、GitHub Actions の $GITHUB_OUTPUT
// 形式で標準出力に出すだけのスクリプト（daily-digest.yml が起動のたびに呼ぶ）。
//
// 【なぜこれが要るのか】GitHub Actions の schedule は予定通りに発火しない。旧構成
// （0 12 * * * ＝21:00 JST）の実測では遅延が2.1〜6.4時間・中央値約5時間あり、
// 「cronに20時と書けば20時台に投稿される」という前提がそもそも成り立たなかった。
// そこで daily-digest.yml は1時間おきに起動し、起動のたびにこのスクリプトで
// 「いまがどの枠の時間帯か」を判定する。どの時間帯でもなく、遅れ投稿の対象も無ければ
// 何もせず終わる（＝重い npm ci / Playwright インストールにも進まない）。
//
// 時間帯の定義（SLOTS）を持つのは scripts/lib/build-digest.js だけにしてある。
// ワークフローのYAMLに時刻を書くと、build-digest.js 側の定義とズレたときに
// 「投稿されない」「違う日の内容が出る」という気づきにくい壊れ方をするため。
//
// 出力（$GITHUB_OUTPUT にリダイレクトして使う）:
//   slot=morning|noon|evening|none  … いま時間帯の「中」にいる枠（第一希望）
//   due_morning / due_noon / due_evening = true|false
//       … 今日すでに開始時刻を迎えた枠。時間帯を過ぎていても未投稿なら遅れて投げる
//         （GitHubの間引きで時間帯を丸ごと逃す日が約6日に1日あるため。詳細は
//          build-digest.js の dueSlots のコメント）
//   due_mastodon=true|false
//       … Mastodonだけは時間帯で分けず1日1回21時台にまとめて投稿する（2026-08-05に
//         従来運用へ戻した）。21時を過ぎていればtrue（未投稿ならそのまま投げる）
//   date=YYYY-MM-DD … JSTの日付。二重投稿を防ぐキャッシュキーに使う
const { slotForNow, dueSlots, isMastodonBatchDue, SLOTS, jstParts } = require("./lib/build-digest");

const now = new Date();
const { year, month, day } = jstParts(now);
const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const due = new Set(dueSlots(now));

const lines = [`slot=${slotForNow(now) ?? "none"}`];
for (const key of Object.keys(SLOTS)) {
  lines.push(`due_${key}=${due.has(key)}`);
}
lines.push(`due_mastodon=${isMastodonBatchDue(now)}`);
lines.push(`date=${date}`);

process.stdout.write(lines.join("\n") + "\n");
