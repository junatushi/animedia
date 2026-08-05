// いまのJST時刻がどの投稿枠の時間帯かを判定し、GitHub Actions の $GITHUB_OUTPUT 形式で
// 標準出力に出すだけのスクリプト（daily-digest.yml が起動のたびに呼ぶ）。
//
// 【なぜこれが要るのか】GitHub Actions の schedule は予定通りに発火しない。旧構成
// （0 12 * * * ＝21:00 JST）の実測では遅延が2.1〜6.4時間・中央値約5時間あり、
// 「cronに20時と書けば20時台に投稿される」という前提がそもそも成り立たなかった。
// そこで daily-digest.yml は1時間おきに起動し、起動のたびにこのスクリプトで
// 「いまがどの枠の時間帯か」を判定する。枠の中に入っていなければ何もせず終わる
// （＝重い npm ci / Playwright インストールにも進まない）。
//
// 時間帯の定義（SLOTS）を持つのは scripts/lib/build-digest.js だけにしてある。
// ワークフローのYAMLに時刻を書くと、build-digest.js 側の定義とズレたときに
// 「投稿されない」「違う日の内容が出る」という気づきにくい壊れ方をするため。
//
// 出力（$GITHUB_OUTPUT にリダイレクトして使う）:
//   slot=morning|noon|evening|none
//   date=YYYY-MM-DD   … JSTの日付。二重投稿を防ぐキャッシュキーに使う
const { slotForNow, jstParts } = require("./lib/build-digest");

const now = new Date();
const { year, month, day } = jstParts(now);
const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

process.stdout.write(`slot=${slotForNow(now) ?? "none"}\n`);
process.stdout.write(`date=${date}\n`);
